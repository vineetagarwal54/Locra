import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  QwenLlamaRuntime,
  QwenProjectorInitError,
  QwenNotLoadedError,
  type LlamaBinding,
  type LlamaContextLike,
  type QwenCompletionParams,
  type QwenNativeCompletionResult,
} from '../../../src/inference/llamaRn/QwenLlamaRuntime';

const MODEL_PATH = '/models/Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const PROJECTOR_PATH = '/models/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf';

function makeContext(overrides: Partial<LlamaContextLike> = {}) {
  const completion = jest.fn(
    async (): Promise<QwenNativeCompletionResult> => ({
      content: 'ok',
      tokens_predicted: 1,
      tokens_evaluated: 3,
      timings: { predicted_per_second: 30 },
    })
  );
  const context = {
    initMultimodal: jest.fn(async () => true),
    isMultimodalEnabled: jest.fn(async () => true),
    getMultimodalSupport: jest.fn(async () => ({ vision: true, audio: false })),
    getFormattedChat: jest.fn(async () => ({ prompt: 'formatted prompt' })),
    tokenize: jest.fn(async () => ({ tokens: [1, 2, 3], has_media: false })),
    completion,
    stopCompletion: jest.fn(async () => {}),
    releaseMultimodal: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
    ...overrides,
  };
  return context;
}

function makeRuntime(context = makeContext()) {
  const initLlama = jest.fn(async () => context as unknown as LlamaContextLike);
  const releaseAllLlama = jest.fn(async () => {});
  const llama: LlamaBinding = { initLlama, releaseAllLlama };
  const runtime = new QwenLlamaRuntime({ llama, isReadableFile: () => true });
  return { runtime, context, initLlama, releaseAllLlama };
}

const load = { modelPath: MODEL_PATH, projectorPath: PROJECTOR_PATH };

function generateRequest(
  messages: ModelRequestMessage[]
): Parameters<QwenLlamaRuntime['generate']>[0] {
  return { messages, responseMode: 'Medium', signal: new AbortController().signal, onToken: () => {} };
}

describe('QwenLlamaRuntime lifecycle', () => {
  it('loads exactly one context and initializes the projector once', async () => {
    const { runtime, context, initLlama } = makeRuntime();

    await runtime.loadModel(load);

    expect(initLlama).toHaveBeenCalledTimes(1);
    expect(context.initMultimodal).toHaveBeenCalledWith({
      path: PROJECTOR_PATH,
      use_gpu: false,
    });
    expect(context.initMultimodal).toHaveBeenCalledTimes(1);
    expect(runtime.getStatus()).toBe('loaded');
    expect(runtime.isMultimodalVisionReady()).toBe(true);
  });

  it('is idempotent: a repeat load of the same artifacts does not reload or re-init the projector', async () => {
    const { runtime, context, initLlama } = makeRuntime();

    await runtime.loadModel(load);
    await runtime.loadModel(load);

    expect(initLlama).toHaveBeenCalledTimes(1);
    expect(context.initMultimodal).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent loads into a single in-flight load', async () => {
    const { runtime, initLlama } = makeRuntime();

    await Promise.all([runtime.loadModel(load), runtime.loadModel(load)]);

    expect(initLlama).toHaveBeenCalledTimes(1);
  });

  it('keeps text inference available when projector initialization fails', async () => {
    const context = makeContext({
      initMultimodal: jest.fn(async () => {
        throw new Error('projector mismatch');
      }),
    });
    const { runtime } = makeRuntime(context);

    await runtime.loadModel(load);
    expect(context.releaseMultimodal).toHaveBeenCalled();
    expect(context.release).not.toHaveBeenCalled();
    expect(runtime.getStatus()).toBe('loaded');
    expect(runtime.isMultimodalVisionReady()).toBe(false);
    await expect(runtime.generate(generateRequest([{ role: 'user', content: 'hi' }]))).resolves.toEqual(
      expect.objectContaining({ text: 'ok' }),
    );
  });

  it('rejects only image generation when vision support is not confirmed', async () => {
    const context = makeContext({
      getMultimodalSupport: jest.fn(async () => ({ vision: false, audio: false })),
    });
    const { runtime } = makeRuntime(context);

    await runtime.loadModel(load);
    await expect(runtime.generate(generateRequest([
      { role: 'user', content: 'describe', mediaPath: '/image.jpg' },
    ]))).rejects.toBeInstanceOf(QwenProjectorInitError);
  });

  it('rejects generate() before load (follow-up status is never proof of residency)', async () => {
    const { runtime } = makeRuntime();

    await expect(runtime.generate(generateRequest([{ role: 'user', content: 'hi' }]))).rejects.toBeInstanceOf(
      QwenNotLoadedError
    );
  });

  it('sends the full supplied context on every generation with no retained native history', async () => {
    const { runtime, context } = makeRuntime();
    await runtime.loadModel(load);

    await runtime.generate(generateRequest([{ role: 'user', content: 'First question' }]));

    const followUp: ModelRequestMessage[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ];
    await runtime.generate(generateRequest(followUp));

    // Second call carries the entire supplied list; nothing is appended to a
    // hidden native conversation between calls.
    const completionMock = context.completion as jest.Mock;
    const firstCallMessages = (completionMock.mock.calls[0][0] as QwenCompletionParams).messages;
    const secondCallMessages = (completionMock.mock.calls[1][0] as QwenCompletionParams).messages;
    expect(firstCallMessages).toHaveLength(1);
    expect(secondCallMessages).toHaveLength(3);
    expect(secondCallMessages.map((message) => message.content)).toEqual([
      'First question',
      'First answer',
      'Second question',
    ]);
    expect(runtime.getStatus()).toBe('loaded');
  });

  it('performs exactly one native tokenization check before completion', async () => {
    const { runtime, context } = makeRuntime();
    await runtime.loadModel(load);

    await runtime.generate(generateRequest([{ role: 'user', content: 'Count this prompt.' }]));

    expect(context.getFormattedChat).toHaveBeenCalledTimes(1);
    expect(context.tokenize).toHaveBeenCalledTimes(1);
    expect(context.completion).toHaveBeenCalledTimes(1);
    const tokenizeMock = context.tokenize as jest.Mock;
    const completionMock = context.completion as jest.Mock;
    expect(tokenizeMock.mock.invocationCallOrder[0])
      .toBeLessThan(completionMock.mock.invocationCallOrder[0] as number);
  });

  it('passes the effective generation-plan hard limit to native n_predict', async () => {
    const { runtime, context } = makeRuntime();
    await runtime.loadModel(load);

    const result = await runtime.generate({
      ...generateRequest([{ role: 'user', content: 'Brief answer.' }]),
      softTargetTokens: 128,
      hardSafetyLimitTokens: 640,
      generationPlanId: 'concise-prose-v2',
      generationTaskKind: 'concise-prose',
    });

    expect(context.completion).toHaveBeenCalledWith(
      expect.objectContaining({ n_predict: 640 }),
      expect.any(Function),
    );
    expect(result.generationDiagnostics).toEqual({
      responseModeHardMaximum: 640,
      effectiveNativeGenerationLimit: 640,
      softTargetTokens: 128,
      generationPlanId: 'concise-prose-v2',
      taskKind: 'concise-prose',
    });
  });

  it('formats and tokenizes again after removing history before completion', async () => {
    const tokenize = jest.fn()
      .mockResolvedValueOnce({
        tokens: Array.from({ length: 5_000 }, (_, index) => index),
        has_media: false,
      })
      .mockResolvedValueOnce({
        tokens: Array.from({ length: 1_000 }, (_, index) => index),
        has_media: false,
      });
    const context = makeContext({ tokenize });
    const { runtime } = makeRuntime(context);
    await runtime.loadModel(load);

    const result = await runtime.generate(generateRequest([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'current question' },
    ]));

    expect(context.getFormattedChat).toHaveBeenCalledTimes(2);
    expect(tokenize).toHaveBeenCalledTimes(2);
    const completionMessages =
      ((context.completion as jest.Mock).mock.calls[0][0] as QwenCompletionParams).messages;
    expect(completionMessages.map((message) => message.content)).toEqual([
      'system',
      'current question',
    ]);
    expect(result.finalNativePromptTokens).toBe(1_000);
    expect(result.estimatedPromptTokens).toBeGreaterThan(0);
  });

  it('passes image media paths to every native tokenization pass', async () => {
    const getFormattedChat = jest.fn()
      .mockResolvedValueOnce({ prompt: 'large image prompt', media_paths: ['/image.jpg'] })
      .mockResolvedValueOnce({ prompt: 'reduced image prompt', media_paths: ['/image.jpg'] });
    const tokenize = jest.fn()
      .mockResolvedValueOnce({
        tokens: Array.from({ length: 5_000 }, (_, index) => index),
        has_media: true,
      })
      .mockResolvedValueOnce({
        tokens: Array.from({ length: 1_000 }, (_, index) => index),
        has_media: true,
      });
    const context = makeContext({ getFormattedChat, tokenize });
    const { runtime } = makeRuntime(context);
    await runtime.loadModel(load);

    await runtime.generate(generateRequest([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'read this', mediaPath: '/image.jpg' },
    ]));

    expect(tokenize).toHaveBeenNthCalledWith(1, 'large image prompt', {
      media_paths: ['/image.jpg'],
    });
    expect(tokenize).toHaveBeenNthCalledWith(2, 'reduced image prompt', {
      media_paths: ['/image.jpg'],
    });
    const completionMessages =
      ((context.completion as jest.Mock).mock.calls[0][0] as QwenCompletionParams).messages;
    expect(completionMessages.at(-1)?.content).toEqual(expect.arrayContaining([
      { type: 'image_url', image_url: { url: 'file:///image.jpg' } },
    ]));
  });
});
