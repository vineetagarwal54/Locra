import { create } from 'zustand';

import {
  createInferenceQueue,
  type InferenceEngineAdapter,
  type InferenceSubmitOptions,
} from '../inference/InferenceQueue';
import type { InferenceEngineHandle } from '../inference/useInferenceEngine';
import type { IInferenceQueue } from '../types/interfaces';
import type { InferenceRequest, InferenceState, QASession } from '../types/models';

import { useHistoryStore } from './historyStore';
import { useModelStore } from './modelStore';

// ─────────────────────────────────────────────────────────────────────────────
// Screen-facing state for the ask flow. Screens read from THIS store only — never
// from src/inference/ directly (constitution Principle X). The store owns the
// single-flight InferenceQueue and bridges ExecuTorch's hook-shaped handle
// (registered by the host that calls `useInferenceEngine`) into the queue's plain
// engine interface.
// ─────────────────────────────────────────────────────────────────────────────

// The live engine handle, set by the host component via `registerEngine`. Held
// at module scope (not in React state) so the queue's bridge can read it
// synchronously from outside the render cycle.
let engineHandle: InferenceEngineHandle | null = null;

// The turn currently being served, captured so a completed InferenceState
// (which carries no imagePath/question) can be turned into a QASession update.
let activeTurn: PendingTurn | null = null;

interface PendingTurn {
  readonly request: InferenceRequest;
  readonly baseSession: QASession | null;
}

function requireEngine(): InferenceEngineHandle {
  if (engineHandle === null) {
    throw new Error('The inference engine is not mounted yet.');
  }
  return engineHandle;
}

// Adapts the hook handle to the queue's engine interface. `loadModel` resolves
// once the model reports ready; `generate` runs the request, forwarding each
// streamed update as an onToken call and honouring cancellation via the signal.
const bridgeEngine: InferenceEngineAdapter = {
  loadModel: (): Promise<void> => {
    const handle = requireEngine();
    return new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | null = null;
      const settle = (): boolean => {
        const error = handle.getError();
        if (error !== null) {
          unsubscribe?.();
          reject(new Error(error));
          return true;
        }
        if (handle.isReady()) {
          unsubscribe?.();
          resolve();
          return true;
        }
        return false;
      };
      if (settle()) return;
      unsubscribe = handle.subscribe(settle);
    });
  },

  generate: async (
    request,
    onToken,
    signal
  ): Promise<{
    response: string;
    tokenCount: number;
    promptTokenCount?: number;
    totalTokenCount?: number;
  }> => {
    const handle = requireEngine();
    if (request.imagePath === undefined) {
      await waitForMessageHistory(handle, signal);
    }
    const unsubscribe = handle.subscribe(() => onToken(handle.getResponse()));
    const onAbort = (): void => handle.cancel();
    if (signal.aborted) {
      handle.cancel();
    } else {
      signal.addEventListener('abort', onAbort);
    }
    try {
      const response = await handle.submit(request.imagePath ?? null, request.question);
      const error = handle.getError();
      if (error !== null) {
        throw new Error(error);
      }
      return {
        response,
        tokenCount: handle.getGeneratedTokenCount(),
        promptTokenCount: handle.getPromptTokenCount(),
        totalTokenCount: handle.getTotalTokenCount(),
      };
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
    }
  },
};

// One single-flight queue for the whole app. T027: the model-readiness gate is
// now the real `modelStore.isReadyForInference()` — the queue refuses to reach
// 'loading_model' unless the model is downloaded AND integrity-verified. This
// wiring lives here (the composition root) rather than inside InferenceQueue.ts
// so the inference module stays store-free and its unit tests need no native mocks.
const queue = createInferenceQueue(bridgeEngine, {
  isReadyForInference: () => useModelStore.getState().isReadyForInference(),
});

export interface InferenceStoreState extends InferenceState {
  /** Registers (or clears) the live engine handle from the host component. */
  registerEngine: (handle: InferenceEngineHandle | null) => void;
  /** Rejects if a request is already in-flight (single-flight, FR-006). */
  submit: (request: InferenceRequest) => Promise<void>;
  cancel: () => void;
  /** Flags the most recently completed session as a bad answer (US4, FR-016). */
  flagCurrentSession: (note?: string) => void;
}

export const useInferenceStore = create<InferenceStoreState>(() => ({
  ...queue.getState(),
  registerEngine: (handle: InferenceEngineHandle | null): void => {
    engineHandle = handle;
  },
  submit: async (request: InferenceRequest): Promise<void> => {
    const turn = createPendingTurn(request);
    activeTurn = turn;
    const options: InferenceSubmitOptions =
      turn.baseSession === null ? { turn: 'first' } : { turn: 'followUp' };
    try {
      await queue.submit(request, options);
    } catch (error) {
      if (activeTurn === turn) {
        activeTurn = null;
      }
      throw error;
    }
  },
  cancel: (): void => queue.cancel(),
  flagCurrentSession: (note?: string): void => flagLastSavedSession(note),
}));

// Mirror every queue transition into the store so screens re-render, and persist
// each completed session (FR-015).
queue.subscribe((state: InferenceState) => {
  useInferenceStore.setState({
    status: state.status,
    response: state.response,
    metrics: state.metrics,
    error: state.error,
    limitWarning: state.limitWarning,
  });
  if (state.status === 'completed' && state.metrics !== null && activeTurn !== null) {
    saveCompletedTurn(activeTurn, state);
    activeTurn = null;
  } else if (state.status === 'cancelled' || state.status === 'errored') {
    activeTurn = null;
  }
});

// The imperative IInferenceQueue surface, for non-React consumers. `submit`
// routes through the store action (so `lastRequest` is captured); `subscribe`
// and `getState` read straight from the queue — the source of truth.
export const inferenceQueue: IInferenceQueue = {
  submit: (request: InferenceRequest): Promise<void> =>
    useInferenceStore.getState().submit(request),
  cancel: (): void => useInferenceStore.getState().cancel(),
  subscribe: (listener: (state: InferenceState) => void): (() => void) => queue.subscribe(listener),
  getState: (): InferenceState => queue.getState(),
};

// ── History persistence ─────────────────────────────────────────────────────
// FR-015 says every completed session is saved locally. Cancelled/errored
// sessions are intentionally not persisted in Phase 1 history.

let lastSavedSession: QASession | null = null;

function saveToHistoryStore(session: QASession): void {
  lastSavedSession = session;
  useHistoryStore.getState().save(session);
}

/** Dev/inspection hook for tests and local debugging. */
export function __getLastSavedSession(): QASession | null {
  return lastSavedSession;
}

function flagLastSavedSession(note?: string): void {
  if (lastSavedSession !== null) {
    lastSavedSession = { ...lastSavedSession, flagged: true, flagNote: note ?? null };
    useHistoryStore.getState().setFlag(lastSavedSession.id, true, note);
  }
}

function createPendingTurn(request: InferenceRequest): PendingTurn {
  return {
    request,
    baseSession: getFollowUpBaseSession(request),
  };
}

function getFollowUpBaseSession(request: InferenceRequest): QASession | null {
  if (
    lastSavedSession === null ||
    lastSavedSession.status !== 'completed' ||
    lastSavedSession.imagePath !== request.imagePath
  ) {
    return null;
  }
  return lastSavedSession;
}

function saveCompletedTurn(turn: PendingTurn, state: InferenceState): void {
  if (turn.baseSession === null) {
    saveFirstTurnSession(turn.request, state);
    return;
  }

  saveFollowUpTurnSession(turn.baseSession, turn.request, state);
}

function saveFirstTurnSession(request: InferenceRequest, state: InferenceState): void {
  saveToHistoryStore({
    id: generateSessionId(),
    createdAt: Date.now(),
    imagePath: request.imagePath,
    question: request.question,
    answer: state.response,
    turns: [{ question: request.question, answer: state.response }],
    status: 'completed',
    errorMessage: null,
    metrics: state.metrics,
    flagged: false,
    flagNote: null,
  });
}

function saveFollowUpTurnSession(
  baseSession: QASession,
  request: InferenceRequest,
  state: InferenceState
): void {
  saveToHistoryStore({
    ...baseSession,
    status: 'completed',
    errorMessage: null,
    metrics: baseSession.metrics ?? state.metrics,
    turns: [
      ...normalizedTurns(baseSession),
      { question: request.question, answer: state.response },
    ],
  });
}

function normalizedTurns(session: QASession): Array<{ question: string; answer: string }> {
  if (session.turns.length > 0) {
    return session.turns;
  }
  return [{ question: session.question, answer: session.answer }];
}

function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function waitForMessageHistory(handle: InferenceEngineHandle, signal: AbortSignal): Promise<void> {
  if (handle.getMessageHistoryLength() > 0) {
    return Promise.resolve();
  }
  if (signal.aborted) {
    return Promise.reject(new Error('Follow-up cancelled before conversation context was ready.'));
  }

  return new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      signal.removeEventListener('abort', onAbort);
      reject(new Error('The previous answer is not available for follow-up context yet.'));
    }, 250);
    const settle = (): void => {
      if (handle.getMessageHistoryLength() === 0) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe?.();
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timeout);
      unsubscribe?.();
      reject(new Error('Follow-up cancelled before conversation context was ready.'));
    };

    signal.addEventListener('abort', onAbort);
    unsubscribe = handle.subscribe(settle);
    settle();
  });
}
