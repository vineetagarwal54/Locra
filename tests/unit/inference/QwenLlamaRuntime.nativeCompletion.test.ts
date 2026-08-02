import type { ModelRequestMessage } from '../../../src/inference/ContextBuilder';
import {
  QwenLlamaRuntime,
  type LlamaBinding,
  type LlamaContextLike,
  type QwenNativeCompletionResult,
} from '../../../src/inference/llamaRn/QwenLlamaRuntime';

const MODEL_PATH = '/models/Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const PROJECTOR_PATH = '/models/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf';

function makeRuntime(result: QwenNativeCompletionResult) {
  const context: LlamaContextLike = {
    initMultimodal: jest.fn(async () => true),
    isMultimodalEnabled: jest.fn(async () => true),
    getMultimodalSupport: jest.fn(async () => ({ vision: true, audio: false })),
    completion: jest.fn(async () => result),
    stopCompletion: jest.fn(async () => {}),
    releaseMultimodal: jest.fn(async () => {}),
    release: jest.fn(async () => {}),
  };
  const llama: LlamaBinding = {
    initLlama: jest.fn(async () => context),
    releaseAllLlama: jest.fn(async () => {}),
  };
  return new QwenLlamaRuntime({ llama, isReadableFile: () => true });
}

function textRequest(): Parameters<QwenLlamaRuntime['generate']>[0] {
  const messages: ModelRequestMessage[] = [{ role: 'user', content: 'hi' }];
  return { messages, responseMode: 'Medium', signal: new AbortController().signal, onToken: () => {} };
}

describe('QwenLlamaRuntime native completion diagnostics', () => {
  it('records the raw native stop flags, generated token count, and generation limit', async () => {
    const runtime = makeRuntime({
      content: 'done',
      tokens_predicted: 42,
      stopped_eos: true,
      stopped_word: false,
      stopped_limit: false,
      truncated: false,
    });
    await runtime.loadModel({ modelPath: MODEL_PATH, projectorPath: PROJECTOR_PATH });

    const result = await runtime.generate(textRequest());

    expect(result.nativeCompletion).toEqual({
      stoppedEos: true,
      stoppedWord: false,
      stoppedLimit: false,
      truncated: false,
      generatedTokenCount: 42,
      generationLimit: expect.any(Number),
    });
    expect(result.nativeCompletion.generationLimit).toBeGreaterThan(0);
  });

  it('reports null for stop flags the native runtime did not expose', async () => {
    const runtime = makeRuntime({ content: 'done', tokens_predicted: 7 });
    await runtime.loadModel({ modelPath: MODEL_PATH, projectorPath: PROJECTOR_PATH });

    const result = await runtime.generate(textRequest());

    expect(result.nativeCompletion).toEqual(
      expect.objectContaining({
        stoppedEos: null,
        stoppedWord: null,
        stoppedLimit: null,
        truncated: null,
        generatedTokenCount: 7,
      }),
    );
  });
});
