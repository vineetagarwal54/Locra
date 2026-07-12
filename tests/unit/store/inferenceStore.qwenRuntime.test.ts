jest.mock('../../../src/inference/StartupRuntimeSelection', () => ({
  getStartupRuntimeSelection: () => ({
    selectedHost: 'qwen-llamarn',
    source: 'internal_startup_config',
    processLocked: true,
  }),
}));
jest.mock('../../../src/store/historyStore', () => {
  const sessions = new Map<string, unknown>();
  return {
    mockSessions: sessions,
    mockSave: jest.fn((session: { id: string }): void => {
      sessions.set(session.id, session);
    }),
    useHistoryStore: Object.assign(jest.fn(), {
      getState: () => {
        const self = jest.requireMock('../../../src/store/historyStore') as {
          mockSessions: Map<string, unknown>;
          mockSave: jest.Mock;
        };
        return { save: self.mockSave, get: (id: string) => self.mockSessions.get(id) ?? null };
      },
    }),
  };
});
jest.mock('../../../src/store/modelStore', () => ({
  // Qwen V1 has no normal-user model selection: selectedModelId stays null.
  useModelStore: Object.assign(jest.fn(), {
    getState: () => ({ selectedModelId: null, isReadyForInference: () => true }),
  }),
}));
jest.mock('react-native-nitro-image', () => ({
  loadImage: jest.fn(() => Promise.resolve({ width: 512, height: 384 })),
}));

import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import type { InferenceEngineHandle } from '../../../src/inference/InferenceEngineHandle';
import { useInferenceStore } from '../../../src/store/inferenceStore';
import type { InferenceRequest, QASession } from '../../../src/types/models';

interface HistoryMock {
  mockSessions: Map<string, QASession>;
  mockSave: jest.Mock;
}
const historyMock = jest.requireMock('../../../src/store/historyStore') as HistoryMock;

// A fake registered handle that behaves like the Qwen host's handle: streaming is
// driven through subscribe()/getResponse(), matching the runtime-neutral bridge.
function makeQwenLikeHandle(finalText: string) {
  const listeners = new Set<() => void>();
  let response = '';
  let generatedTokens = 0;
  let cancelled = false;
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const handle: InferenceEngineHandle & { lastMessages: ModelRequestMessage[] | null } = {
    lastMessages: null,
    generate: async (messages) => {
      handle.lastMessages = messages;
      cancelled = false;
      response = '';
      generatedTokens = 0;
      for (const chunk of finalText.split(' ')) {
        if (cancelled) break;
        response = response === '' ? chunk : `${response} ${chunk}`;
        generatedTokens += 1;
        notify();
      }
      return response;
    },
    cancel: () => {
      cancelled = true;
    },
    getResponse: () => response,
    isGenerating: () => false,
    isReady: () => true,
    getGeneratedTokenCount: () => generatedTokens,
    getPromptTokenCount: () => 5,
    getTotalTokenCount: () => generatedTokens + 5,
    getMessageHistoryLength: () => 0,
    clearHistory: () => {},
    getError: () => null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return handle;
}

const TEXT_REQUEST: InferenceRequest = { imagePath: null, question: 'Give me a greeting.' };

describe('inferenceStore with the Qwen runtime', () => {
  beforeEach(() => {
    historyMock.mockSave.mockClear();
    historyMock.mockSessions.clear();
    useInferenceStore.getState().resetActiveChat();
  });

  it('streams, completes, persists to history, and attributes to the Qwen descriptor', async () => {
    const handle = makeQwenLikeHandle('Hello there friend');
    useInferenceStore.getState().registerEngine(handle);

    await useInferenceStore.getState().submit(TEXT_REQUEST);

    const state = useInferenceStore.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe('Hello there friend');
    // The supplied normalized messages reached the runtime-neutral handle.
    expect(handle.lastMessages?.every((m) => typeof m.content === 'string')).toBe(true);
    // History is preserved through the existing store shape.
    expect(historyMock.mockSave).toHaveBeenCalledTimes(1);
    // Diagnostics attribution used the safe aggregate Qwen id, never throwing on
    // the null LFM selection.
    expect(state.currentObjectiveResult?.modelId).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
    expect(state.currentObjectiveResult?.generationConfigId).toBe('qwen3-vl-2b-instruct-llamarn-v1');
  });

  it('cancels an in-flight Qwen generation and returns to idle', async () => {
    const listeners = new Set<() => void>();
    let resolveGenerate: ((value: string) => void) | null = null;
    const handle: InferenceEngineHandle = {
      generate: () =>
        new Promise<string>((resolve) => {
          resolveGenerate = resolve;
        }),
      cancel: jest.fn(),
      getResponse: () => '',
      isGenerating: () => true,
      isReady: () => true,
      getGeneratedTokenCount: () => 0,
      getPromptTokenCount: () => 0,
      getTotalTokenCount: () => 0,
      getMessageHistoryLength: () => 0,
      clearHistory: () => {},
      getError: () => null,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    useInferenceStore.getState().registerEngine(handle);

    const submitPromise = useInferenceStore.getState().submit(TEXT_REQUEST);
    await Promise.resolve();
    await Promise.resolve();

    useInferenceStore.getState().cancel();
    expect(handle.cancel).toHaveBeenCalled();
    expect(useInferenceStore.getState().status).toBe('idle');

    (resolveGenerate as ((value: string) => void) | null)?.('');
    await submitPromise;
  });
});
