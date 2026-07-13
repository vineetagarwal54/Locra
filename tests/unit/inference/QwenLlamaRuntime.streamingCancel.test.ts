import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  QwenGenerationCancelledError,
  QwenGenerationError,
  QwenLlamaRuntime,
  type LlamaBinding,
  type LlamaContextLike,
  type QwenCompletionParams,
  type QwenNativeCompletionResult,
  type QwenNativeTokenData,
} from '../../../src/inference/llamaRn/QwenLlamaRuntime';

const MODEL_PATH = '/models/qwen.gguf';
const PROJECTOR_PATH = '/models/mmproj.gguf';
const load = { modelPath: MODEL_PATH, projectorPath: PROJECTOR_PATH };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRuntime(completion: LlamaContextLike['completion']) {
  const context = {
    initMultimodal: jest.fn(async () => true),
    isMultimodalEnabled: jest.fn(async () => true),
    getMultimodalSupport: jest.fn(async () => ({ vision: true, audio: false })),
    completion,
    stopCompletion: jest.fn(async () => {}),
    releaseMultimodal: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  };
  const llama: LlamaBinding = {
    initLlama: jest.fn(async () => context as unknown as LlamaContextLike),
    releaseAllLlama: jest.fn(async () => {}),
  };
  const runtime = new QwenLlamaRuntime({ llama, isReadableFile: () => true });
  return { runtime, context, llama };
}

const MESSAGES: ModelRequestMessage[] = [{ role: 'user', content: 'Describe this.' }];

describe('QwenLlamaRuntime streaming and cancellation', () => {
  it.each([
    ['Low', 192],
    ['Medium', 384],
    ['High', 768],
  ] as const)('passes the %s response budget to llama.rn', async (responseMode, expected) => {
    const completion = jest.fn(
      async (): Promise<QwenNativeCompletionResult> => ({ content: 'done' }),
    );
    const { runtime } = makeRuntime(completion);
    await runtime.loadModel(load);

    await runtime.generate({
      messages: MESSAGES,
      responseMode,
      signal: new AbortController().signal,
      onToken: () => {},
    });

    expect(completion).toHaveBeenCalledWith(
      expect.objectContaining({ n_predict: expected }),
      expect.any(Function),
    );
  });

  it('streams cumulative text and returns metrics from native timings', async () => {
    const completion = jest.fn(
      async (
        _params: QwenCompletionParams,
        onToken?: (data: QwenNativeTokenData) => void
      ): Promise<QwenNativeCompletionResult> => {
        onToken?.({ token: 'Hello' });
        onToken?.({ token: ', ' });
        onToken?.({ token: 'world' });
        return {
          content: 'Hello, world',
          tokens_predicted: 3,
          tokens_evaluated: 7,
          timings: { predicted_per_second: 35.7 },
        };
      }
    );
    const { runtime } = makeRuntime(completion);
    await runtime.loadModel(load);

    const cumulative: string[] = [];
    const result = await runtime.generate({
      messages: MESSAGES,
      responseMode: 'Medium',
      signal: new AbortController().signal,
      onToken: (text) => cumulative.push(text),
    });

    expect(cumulative).toEqual(['Hello', 'Hello, ', 'Hello, world']);
    expect(result.text).toBe('Hello, world');
    expect(result.generatedTokens).toBe(3);
    expect(result.promptTokens).toBe(7);
    expect(result.totalTokens).toBe(10);
    expect(result.tokensPerSecond).toBe(35.7);
    expect(runtime.getStatus()).toBe('loaded');
  });

  it('strips accidental <think> control tags without hiding the content', async () => {
    const completion = jest.fn(
      async (): Promise<QwenNativeCompletionResult> => ({ content: '<think>hmm</think>Answer' })
    );
    const { runtime } = makeRuntime(completion);
    await runtime.loadModel(load);

    const result = await runtime.generate({
      messages: MESSAGES,
      responseMode: 'Medium',
      signal: new AbortController().signal,
      onToken: () => {},
    });

    expect(result.text).toBe('hmmAnswer');
    expect(result.text).not.toContain('<think>');
  });

  it('cancels a running generation cleanly and stays usable', async () => {
    const deferred = defer<QwenNativeCompletionResult>();
    const completion = jest.fn(async () => deferred.promise);
    const { runtime, context } = makeRuntime(completion);
    await runtime.loadModel(load);

    const controller = new AbortController();
    const generatePromise = runtime.generate({
      messages: MESSAGES,
      responseMode: 'Medium',
      signal: controller.signal,
      onToken: () => {},
    });
    await Promise.resolve();

    controller.abort();
    expect(context.stopCompletion).toHaveBeenCalled();
    deferred.resolve({ content: 'partial' });

    await expect(generatePromise).rejects.toBeInstanceOf(QwenGenerationCancelledError);
    expect(runtime.getStatus()).toBe('loaded');
  });

  it('surfaces a native completion failure as a typed error without leaking the context', async () => {
    const completion = jest.fn(async () => {
      throw new Error('native OOM');
    });
    const { runtime } = makeRuntime(completion);
    await runtime.loadModel(load);

    await expect(
      runtime.generate({
        messages: MESSAGES,
        responseMode: 'Medium',
        signal: new AbortController().signal,
        onToken: () => {},
      })
    ).rejects.toBeInstanceOf(QwenGenerationError);
    expect(runtime.getStatus()).toBe('errored');
  });

  it('releases the projector before the context and ends unloaded', async () => {
    const order: string[] = [];
    const completion = jest.fn(async (): Promise<QwenNativeCompletionResult> => ({ content: 'x' }));
    const { runtime, context, llama } = makeRuntime(completion);
    context.releaseMultimodal.mockImplementation(async () => {
      order.push('projector');
    });
    context.release.mockImplementation(async () => {
      order.push('context');
    });
    await runtime.loadModel(load);

    await runtime.release();

    expect(order).toEqual(['projector', 'context']);
    expect(llama.releaseAllLlama).toHaveBeenCalled();
    expect(runtime.getStatus()).toBe('unloaded');
  });
});
