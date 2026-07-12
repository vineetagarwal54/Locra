import { create } from 'zustand';

import { getCurrentDeviceBuildMetadata } from '../diagnostics/DeviceBuildMetadataProvider';
import { createCanonicalConversationContext } from '../inference/ContextBuilder';
import type {
  InferenceEngineAdapter,
  InferenceEngineHandle,
} from '../inference/InferenceEngineHandle';
import {
  createInferenceQueue,
  type InferenceSubmitOptions,
} from '../inference/InferenceQueue';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import { QWEN_V1_DESCRIPTOR } from '../model/ActiveModel';
import type { IInferenceQueue } from '../types/interfaces';
import type { InferenceRequest, InferenceState, QASession } from '../types/models';

import { useHistoryStore } from './historyStore';
import { useModelStore } from './modelStore';
import { useSettingsStore } from './settingsStore';

let engineHandle: InferenceEngineHandle | null = null;
let activeTurn: PendingTurn | null = null;

interface PendingTurn {
  readonly request: InferenceRequest;
  readonly conversationId: string;
  readonly baseSession: QASession | null;
}

function requireEngine(): InferenceEngineHandle {
  if (engineHandle === null) {
    throw new Error('The inference engine is not mounted yet.');
  }
  return engineHandle;
}

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
      if (signal.aborted) {
        throw new Error('Inference cancelled before model request was sent.');
      }

      const rawResponse = await handle.generate(request);
      if (!signal.aborted) {
        const error = handle.getError();
        if (error !== null) {
          throw new Error(error);
        }
      }
      handle.clearHistory();
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

const queue = createInferenceQueue(bridgeEngine, {
  isReadyForInference: (requiresVision) => requiresVision
    ? useModelStore.getState().isReadyForInference()
    : useModelStore.getState().isReadyForTextInference?.()
      ?? useModelStore.getState().isReadyForInference(),
  getResponseMode: () => useSettingsStore.getState().responseMode,
  getDeviceBuildMetadata: getCurrentDeviceBuildMetadata,
  getModelAttribution: () => {
    return {
      modelId: QWEN_V1_DESCRIPTOR.id,
      generationConfigId: QWEN_V1_DESCRIPTOR.generationConfigId,
    };
  },
});

export interface InferenceStoreState extends InferenceState {
  activeSessionId: string | null;
  currentObjectiveResult: ObjectiveInferenceResultRecord | null;
  registerEngine: (handle: InferenceEngineHandle | null) => void;
  submit: (request: InferenceRequest) => Promise<void>;
  cancel: () => void;
  flagCurrentSession: (note?: string) => void;
  hydrateSession: (sessionId: string) => QASession | null;
  resetActiveChat: () => void;
}

export const useInferenceStore = create<InferenceStoreState>(() => ({
  ...queue.getState(),
  activeSessionId: null,
  currentObjectiveResult: null,
  registerEngine: (handle: InferenceEngineHandle | null): void => {
    engineHandle = handle;
    engineHandle?.clearHistory();
  },
  submit: async (request: InferenceRequest): Promise<void> => {
    const turn = createPendingTurn(request);
    activeTurn = turn;
    const options: InferenceSubmitOptions = turn.baseSession === null
      ? { turn: 'first' }
      : {
          turn: 'followUp',
          conversationContext: createCanonicalConversationContext(
            normalizedTurns(turn.baseSession),
          ),
        };

    try {
      await queue.submit(turn.request, options);
    } catch (error) {
      if (activeTurn === turn) {
        activeTurn = null;
      }
      throw error;
    }
  },
  cancel: (): void => queue.cancel(),
  flagCurrentSession: (note?: string): void => flagActiveSession(note),
  hydrateSession: (sessionId: string): QASession | null => {
    const session = useHistoryStore.getState().get(sessionId);
    if (session === null || session.status !== 'completed') {
      return null;
    }

    if (isInFlightStatus(queue.getState().status)) {
      queue.cancel();
    }
    activeTurn = null;
    engineHandle?.clearHistory();
    useInferenceStore.setState({
      activeSessionId: session.id,
      status: 'idle',
      response: '',
      metrics: session.metrics,
      error: null,
      limitWarning: null,
      pinnedExtraction: null,
      hiddenEvidence: null,
      objectiveResult: null,
      inferenceTrace: null,
      currentObjectiveResult: null,
    });
    return session;
  },
  resetActiveChat: (): void => {
    if (isInFlightStatus(queue.getState().status)) {
      queue.cancel();
    }
    activeTurn = null;
    engineHandle?.clearHistory();
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
      inferenceTrace: null,
      currentObjectiveResult: null,
    });
  },
}));

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
    inferenceTrace: state.inferenceTrace ?? null,
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

export const inferenceQueue: IInferenceQueue = {
  submit: (request: InferenceRequest, options?: InferenceSubmitOptions): Promise<void> =>
    queue.submit(request, options),
  cancel: (): void => queue.cancel(),
  subscribe: (listener: (state: InferenceState) => void): (() => void) => queue.subscribe(listener),
  getState: (): InferenceState => queue.getState(),
};

function createPendingTurn(request: InferenceRequest): PendingTurn {
  const conversationId = request.conversationId
    ?? useInferenceStore.getState().activeSessionId
    ?? generateSessionId();
  return {
    request: { ...request, conversationId },
    conversationId,
    baseSession: useHistoryStore.getState().get(conversationId),
  };
}

function saveCompletedTurn(turn: PendingTurn, state: InferenceState): void {
  if (turn.baseSession === null) {
    saveFirstTurnSession(turn.conversationId, turn.request, state);
    return;
  }

  saveFollowUpTurnSession(turn.baseSession, turn.request, state);
}

function saveFirstTurnSession(
  conversationId: string,
  request: InferenceRequest,
  state: InferenceState,
): void {
  saveToHistoryStore({
    id: conversationId,
    createdAt: Date.now(),
    imagePath: request.imagePath ?? '',
    question: request.question,
    answer: state.response,
    turns: [{ question: request.question, answer: state.response }],
    pinnedExtraction: null,
    hiddenEvidence: null,
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
    pinnedExtraction: null,
    hiddenEvidence: null,
    turns: [
      ...normalizedTurns(baseSession),
      { question: request.question, answer: state.response },
    ],
  });
}

function saveToHistoryStore(session: QASession): void {
  useHistoryStore.getState().save(session);
  useInferenceStore.setState({ activeSessionId: session.id });
}

function flagActiveSession(note?: string): void {
  const id = useInferenceStore.getState().activeSessionId;
  if (id !== null) {
    useHistoryStore.getState().setFlag(id, true, note);
  }
}

function normalizedTurns(session: QASession): Array<{ question: string; answer: string }> {
  if (session.turns.length > 0) {
    return session.turns;
  }
  return [{ question: session.question, answer: session.answer }];
}

function isInFlightStatus(status: InferenceState['status']): boolean {
  return status === 'preprocessing' || status === 'loading_model' || status === 'streaming';
}

function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
