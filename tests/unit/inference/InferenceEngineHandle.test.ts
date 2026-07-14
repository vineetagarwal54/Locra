import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import type {
  InferenceEngineAdapter,
  InferenceEngineHandle,
} from '../../../src/inference/InferenceEngineHandle';
import {
  inferenceEngineAdapter,
  registerInferenceEngine,
} from '../../../src/inference/InferenceEngineRegistry';

function makeHandle(overrides: Partial<InferenceEngineHandle>): InferenceEngineHandle {
  return {
    generate: jest.fn(async (): Promise<string> => 'done'),
    cancel: jest.fn(),
    getResponse: (): string => '',
    isGenerating: (): boolean => false,
    isReady: (): boolean => true,
    getGeneratedTokenCount: (): number => 0,
    getPromptTokenCount: (): number => 0,
    getTotalTokenCount: (): number => 0,
    getMessageHistoryLength: (): number => 0,
    clearHistory: jest.fn(),
    getError: (): string | null => null,
    subscribe: (): (() => void) => jest.fn(),
    ...overrides,
  };
}

describe('inference engine adapter loadModel', () => {
  afterEach(() => registerInferenceEngine(null));

  it('loads a ready runtime even when a prior generation left an error (e.g. a cancel)', async () => {
    // Regression: after a user cancel the handle reports "Generation was cancelled."
    // but the runtime is still ready — the next loadModel must resolve, not reject,
    // so the following answer is not spuriously marked failed.
    registerInferenceEngine(
      makeHandle({ isReady: (): boolean => true, getError: (): string | null => 'Generation was cancelled.' }),
    );

    await expect(inferenceEngineAdapter.loadModel()).resolves.toBeUndefined();
  });

  it('rejects only when the runtime is not ready and reports an error', async () => {
    registerInferenceEngine(
      makeHandle({ isReady: (): boolean => false, getError: (): string | null => 'Model failed to load.' }),
    );

    await expect(inferenceEngineAdapter.loadModel()).rejects.toThrow(/failed to load/i);
  });
});

describe('runtime-neutral inference contracts', () => {
  it('supports idempotent loading, normalized messages, cumulative streaming, cancellation, and metrics', async () => {
    const streamed: string[] = [];
    const controller = new AbortController();
    const messages: ModelRequestMessage[] = [{ role: 'user', content: 'Hello' }];
    const adapter: InferenceEngineAdapter = {
      loadModel: jest.fn(async (): Promise<void> => undefined),
      generate: jest.fn(async (request, onToken, signal) => {
        expect(request.messages).toBe(messages);
        expect(signal).toBe(controller.signal);
        onToken('Hel', 1);
        onToken('Hello', 2);
        return {
          response: 'Hello',
          tokenCount: 2,
          promptTokenCount: 1,
          totalTokenCount: 3,
        };
      }),
    };

    await adapter.loadModel();
    await adapter.loadModel();
    const result = await adapter.generate(
      { messages, kind: 'chat', responseMode: 'Medium' },
      (text) => streamed.push(text),
      controller.signal,
    );

    expect(adapter.loadModel).toHaveBeenCalledTimes(2);
    expect(streamed).toEqual(['Hel', 'Hello']);
    expect(result).toEqual({
      response: 'Hello',
      tokenCount: 2,
      promptTokenCount: 1,
      totalTokenCount: 3,
    });
  });

  it('exposes cancellation and request-state clearing without runtime-specific types', () => {
    const cancel = jest.fn();
    const clearHistory = jest.fn();
    const handle: InferenceEngineHandle = {
      generate: jest.fn(async (): Promise<string> => 'done'),
      cancel,
      getResponse: (): string => '',
      isGenerating: (): boolean => false,
      isReady: (): boolean => true,
      getGeneratedTokenCount: (): number => 0,
      getPromptTokenCount: (): number => 0,
      getTotalTokenCount: (): number => 0,
      getMessageHistoryLength: (): number => 0,
      clearHistory,
      getError: (): string | null => null,
      subscribe: (): (() => void) => jest.fn(),
    };

    handle.cancel();
    handle.clearHistory();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });
});
