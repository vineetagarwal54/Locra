import { create } from 'zustand';

import { buildPinnedContextPrompt } from '../inference/ContextBuilder';
import {
  createInferenceQueue,
  type InferenceEngineAdapter,
  type InferenceSubmitOptions,
} from '../inference/InferenceQueue';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
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

// Turns served by THIS engine instance in THIS process. A hydrated thread
// (reopened from history after a restart) has zero in-process engine history,
// so waiting for messageHistory before its first follow-up would deadlock —
// the pinned-context prompt is self-contained and needs no engine history.
let engineTurnsServed = 0;

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
    pinnedExtraction?: string | null;
  }> => {
    const handle = requireEngine();
    if (request.imagePath === undefined && engineTurnsServed > 0) {
      await waitForMessageHistoryAtLeast(handle, signal, 1);
    }
    const unsubscribe = handle.subscribe(() =>
      onToken(handle.getResponse(), handle.getGeneratedTokenCount())
    );
    const onAbort = (): void => handle.cancel();
    if (signal.aborted) {
      handle.cancel();
    } else {
      signal.addEventListener('abort', onAbort);
    }
    try {
      const rawResponse = await submitAndWaitForMessageHistory(
        handle,
        request.imagePath ?? null,
        request.question,
        signal
      );
      // An aborted signal here is either a user cancel (result discarded by
      // the queue) or the FR-052 budget stop (partial answer kept) — in both
      // cases resolve with what we have rather than failing the turn.
      if (signal.aborted) {
        return {
          response: rawResponse,
          tokenCount: handle.getGeneratedTokenCount(),
          promptTokenCount: handle.getPromptTokenCount(),
          totalTokenCount: handle.getTotalTokenCount(),
          pinnedExtraction: null,
        };
      }
      const error = handle.getError();
      if (error !== null) {
        throw new Error(error);
      }
      if (request.kind === 'extraction' || request.kind === 'extractionRetry') {
        handle.clearHistory();
        engineTurnsServed = 0;
      }
      return {
        response: rawResponse,
        tokenCount: handle.getGeneratedTokenCount(),
        promptTokenCount: handle.getPromptTokenCount(),
        totalTokenCount: handle.getTotalTokenCount(),
        pinnedExtraction: null,
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
  /** The persisted session id the current chat thread belongs to (FR-046). */
  activeSessionId: string | null;
  /** Latest completed production-owned objective result for dev-only consumers. */
  currentObjectiveResult: ObjectiveInferenceResultRecord | null;
  /** Registers (or clears) the live engine handle from the host component. */
  registerEngine: (handle: InferenceEngineHandle | null) => void;
  /** Rejects if a request is already in-flight (single-flight, FR-006). */
  submit: (request: InferenceRequest) => Promise<void>;
  cancel: () => void;
  /** Flags the most recently completed session as a bad answer (US4, FR-016). */
  flagCurrentSession: (note?: string) => void;
  /**
   * Reopens a persisted thread from history (FR-046): loads its full turn
   * list and pinned extraction so follow-ups continue the same session.
   * Returns the hydrated session, or null when it no longer exists.
   */
  hydrateSession: (sessionId: string) => QASession | null;
  /**
   * FR-047: commits nothing new (completed turns are already persisted),
   * cancels any in-flight turn, clears the engine's conversation history, and
   * returns the store to a clean slate so a fresh capture starts context-free.
   */
  resetActiveChat: () => void;
}

export const useInferenceStore = create<InferenceStoreState>(() => ({
  ...queue.getState(),
  activeSessionId: null,
  currentObjectiveResult: null,
  registerEngine: (handle: InferenceEngineHandle | null): void => {
    if (handle !== engineHandle) {
      engineTurnsServed = 0;
    }
    engineHandle = handle;
  },
  submit: async (request: InferenceRequest): Promise<void> => {
    const turn = createPendingTurn(request);
    activeTurn = turn;
    const options: InferenceSubmitOptions =
      turn.baseSession === null ? { turn: 'first' } : { turn: 'followUp' };
    const queuedRequest = createQueuedRequest(turn);
    try {
      await queue.submit(queuedRequest, options);
    } catch (error) {
      if (activeTurn === turn) {
        activeTurn = null;
      }
      throw error;
    }
  },
  cancel: (): void => queue.cancel(),
  flagCurrentSession: (note?: string): void => flagLastSavedSession(note),
  hydrateSession: (sessionId: string): QASession | null => {
    const session = useHistoryStore.getState().get(sessionId);
    if (session === null || session.status !== 'completed') {
      return null;
    }

    if (isInFlightStatus(queue.getState().status)) {
      queue.cancel();
    }
    activeTurn = null;
    // The hydrated session becomes the follow-up base: submits against its
    // imagePath route through the pinned-context follow-up path (FR-042).
    lastSavedSession = session;
    useInferenceStore.setState({
      activeSessionId: session.id,
      status: 'idle',
      response: '',
      metrics: session.metrics,
      error: null,
      limitWarning: null,
      pinnedExtraction: session.pinnedExtraction,
      hiddenEvidence: session.hiddenEvidence ?? null,
      objectiveResult: null,
      currentObjectiveResult: null,
    });
    return session;
  },
  resetActiveChat: (): void => {
    if (isInFlightStatus(queue.getState().status)) {
      queue.cancel();
    }
    activeTurn = null;
    lastSavedSession = null;
    // FR-047: a fresh capture must carry zero context from the prior thread —
    // wipe the engine's managed conversation history, not just app state.
    engineHandle?.clearHistory();
    engineTurnsServed = 0;
    useInferenceStore.setState({
      activeSessionId: null,
      status: 'idle',
      response: '',
      metrics: null,
      error: null,
      limitWarning: null,
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
      currentObjectiveResult: null,
    });
  },
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
    pinnedExtraction: state.pinnedExtraction,
    hiddenEvidence: state.hiddenEvidence ?? null,
    objectiveResult: state.objectiveResult ?? null,
    currentObjectiveResult:
      state.status === 'completed'
        ? state.objectiveResult ?? null
        : useInferenceStore.getState().currentObjectiveResult,
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
  // The saved session is the active thread — new first turns acquire their id
  // here, so History can immediately reopen/continue it (FR-046).
  useInferenceStore.setState({ activeSessionId: session.id });
}

function isInFlightStatus(status: InferenceState['status']): boolean {
  return status === 'preprocessing' || status === 'loading_model' || status === 'streaming';
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
  const pinnedExtraction = state.pinnedExtraction ?? null;
  saveToHistoryStore({
    id: generateSessionId(),
    createdAt: Date.now(),
    imagePath: request.imagePath,
    question: request.question,
    answer: state.response,
    turns: [{ question: request.question, answer: state.response }],
    pinnedExtraction,
    hiddenEvidence: state.hiddenEvidence ?? null,
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
    pinnedExtraction: baseSession.pinnedExtraction,
    hiddenEvidence: baseSession.hiddenEvidence ?? null,
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

function createQueuedRequest(turn: PendingTurn): InferenceRequest {
  if (turn.baseSession === null) {
    return turn.request;
  }

  return {
    ...turn.request,
    question: buildPinnedContextPrompt({
      pinnedExtraction: getPinnedExtraction(turn.baseSession),
      turns: normalizedTurns(turn.baseSession),
      question: turn.request.question,
    }),
  };
}

function getPinnedExtraction(session: QASession): string {
  const normalized = normalizedTurns(session);
  return session.pinnedExtraction ?? normalized[0]?.answer ?? session.answer;
}

async function submitAndWaitForMessageHistory(
  handle: InferenceEngineHandle,
  imagePath: string | null,
  prompt: string,
  signal: AbortSignal
): Promise<string> {
  if (signal.aborted) {
    throw new Error('Follow-up cancelled before conversation context was ready.');
  }
  const historyLengthBeforeSubmit = handle.getMessageHistoryLength();
  const response = await handle.submit(imagePath, prompt);
  engineTurnsServed += 1;
  // After an interrupt (cancel or budget stop) the engine may never append
  // this turn to messageHistory — don't wait on it; the response is in hand.
  if (!signal.aborted) {
    await waitForMessageHistoryGrowth(handle, signal, historyLengthBeforeSubmit);
  }
  return response;
}

function waitForMessageHistoryAtLeast(
  handle: InferenceEngineHandle,
  signal: AbortSignal,
  minimumLength: number
): Promise<void> {
  return waitForMessageHistory(
    handle,
    signal,
    () => handle.getMessageHistoryLength() >= minimumLength
  );
}

function waitForMessageHistoryGrowth(
  handle: InferenceEngineHandle,
  signal: AbortSignal,
  previousLength: number
): Promise<void> {
  // Post-submit wait: the response is already in hand, so an abort mid-wait
  // resolves (letting the partial answer through) instead of failing the turn.
  return waitForMessageHistory(
    handle,
    signal,
    () => handle.getMessageHistoryLength() > previousLength,
    'resolve'
  );
}

function waitForMessageHistory(
  handle: InferenceEngineHandle,
  signal: AbortSignal,
  isReady: () => boolean,
  onAbortBehavior: 'reject' | 'resolve' = 'reject'
): Promise<void> {
  if (isReady()) {
    return Promise.resolve();
  }
  if (signal.aborted) {
    return onAbortBehavior === 'resolve'
      ? Promise.resolve()
      : Promise.reject(new Error('Follow-up cancelled before conversation context was ready.'));
  }

  return new Promise<void>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const cleanup = (): void => {
      unsubscribe?.();
      signal.removeEventListener('abort', onAbort);
    };
    const settle = (): void => {
      // A surfaced engine error means history will never grow — stop waiting
      // and let the caller's error check own it, rather than hanging forever.
      if (!isReady() && handle.getError() === null) {
        return;
      }
      cleanup();
      resolve();
    };
    const onAbort = (): void => {
      cleanup();
      if (onAbortBehavior === 'resolve') {
        resolve();
        return;
      }
      reject(new Error('Follow-up cancelled before conversation context was ready.'));
    };

    signal.addEventListener('abort', onAbort);
    unsubscribe = handle.subscribe(settle);
    settle();
  });
}
