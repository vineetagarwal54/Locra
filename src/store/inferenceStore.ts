import { create } from 'zustand';

import { createInferenceQueue, type InferenceEngineAdapter } from '../inference/InferenceQueue';
import type { InferenceEngineHandle } from '../inference/useInferenceEngine';
import type { IInferenceQueue } from '../types/interfaces';
import type { InferenceRequest, InferenceState, QASession } from '../types/models';

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

// The request currently being served, captured so a completed InferenceState
// (which carries no imagePath/question) can be turned into a QASession.
let lastRequest: InferenceRequest | null = null;

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

  generate: async (request, onToken, signal): Promise<{ response: string; tokenCount: number }> => {
    const handle = requireEngine();
    const unsubscribe = handle.subscribe(() => onToken(handle.getResponse()));
    const onAbort = (): void => handle.cancel();
    if (signal.aborted) {
      handle.cancel();
    } else {
      signal.addEventListener('abort', onAbort);
    }
    try {
      await handle.submit(request.imagePath, request.question);
      const error = handle.getError();
      if (error !== null) {
        throw new Error(error);
      }
      return { response: handle.getResponse(), tokenCount: handle.getGeneratedTokenCount() };
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
  submit: (request: InferenceRequest): Promise<void> => {
    lastRequest = request;
    return queue.submit(request);
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
  });
  if (state.status === 'completed' && state.metrics !== null && lastRequest !== null) {
    saveCompletedSession(lastRequest, state);
  }
});

// The imperative IInferenceQueue surface, for non-React consumers. `submit`
// routes through the store action (so `lastRequest` is captured); `subscribe`
// and `getState` read straight from the queue — the source of truth.
export const inferenceQueue: IInferenceQueue = {
  submit: (request: InferenceRequest): Promise<void> => useInferenceStore.getState().submit(request),
  cancel: (): void => useInferenceStore.getState().cancel(),
  subscribe: (listener: (state: InferenceState) => void): (() => void) => queue.subscribe(listener),
  getState: (): InferenceState => queue.getState(),
};

// ── History persistence (stub) ──────────────────────────────────────────────
// FR-015 says every completed session is saved. The MMKV-backed HistoryStore and
// its Zustand wrapper arrive in US3 (T029-T031); until then this in-memory stub
// stands in so the completion→save wiring is exercised and ready to swap.

let lastSavedSession: QASession | null = null;

function historyStoreSaveStub(session: QASession): void {
  // TODO(T031): replace with `useHistoryStore.getState().save(session)`.
  lastSavedSession = session;
}

/** Dev/inspection hook for the stubbed save sink; removed when T031 wires real history. */
export function __getLastSavedSession(): QASession | null {
  return lastSavedSession;
}

function flagLastSavedSession(note?: string): void {
  // TODO(T033): replace with `useHistoryStore.getState().setFlag(id, true, note)`
  // once the real MMKV-backed history store exists. For now flag the in-memory
  // stub in place so the Answer screen's report action is fully wired.
  if (lastSavedSession !== null) {
    lastSavedSession = { ...lastSavedSession, flagged: true, flagNote: note ?? null };
  }
}

function saveCompletedSession(request: InferenceRequest, state: InferenceState): void {
  historyStoreSaveStub({
    id: generateSessionId(),
    createdAt: Date.now(),
    imagePath: request.imagePath,
    question: request.question,
    answer: state.response,
    status: 'completed',
    errorMessage: null,
    metrics: state.metrics,
    flagged: false,
    flagNote: null,
  });
}

function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
