import { readFileSync } from 'fs';
import { join } from 'path';

import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';
import type {
  EngineGenerateRequest,
  EngineGenerateResult,
  InferenceEngineAdapter,
} from '../../../src/inference/InferenceEngineHandle';
import { InferenceQueue } from '../../../src/inference/InferenceQueue';
import type { InferenceRequest } from '../../../src/types/models';

jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

// The queue must drive ANY runtime through the runtime-neutral engine adapter —
// no ExecuTorch- or llama.rn-specific coupling. A plain spy adapter (standing in
// for either runtime) proves load/normalized-messages/streaming/cancellation/
// metrics all flow through the neutral boundary.

const TEXT_REQUEST: InferenceRequest = { imagePath: null, question: 'Say hi.' };

function makePreprocess(): (imagePath: string) => Promise<PreprocessedImage> {
  return (imagePath) =>
    Promise.resolve({ path: `${imagePath}.pre`, width: 512, height: 384 });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('InferenceQueue runtime neutrality', () => {
  it('imports no runtime-specific engine module', () => {
    const source = readFileSync(join(process.cwd(), 'src/inference/InferenceQueue.ts'), 'utf8');
    // The queue may only depend on the neutral adapter contract.
    expect(source).not.toMatch(/from '.*executorch/);
    expect(source).not.toMatch(/from '.*llamaRn/);
    expect(source).not.toMatch(/llama\.rn/);
  });

  it('loads once via the neutral adapter and streams cumulative tokens into queue state', async () => {
    const loadModel = jest.fn(() => Promise.resolve());
    const seen: EngineGenerateRequest[] = [];
    const generate = jest.fn(
      (request: EngineGenerateRequest, onToken: (t: string, n?: number) => void) => {
        seen.push(request);
        onToken('Hel', 1);
        onToken('Hello', 2);
        return Promise.resolve<EngineGenerateResult>({ response: 'Hello', tokenCount: 2 });
      }
    );
    const engine: InferenceEngineAdapter = { loadModel, generate };
    const queue = new InferenceQueue({
      preprocess: makePreprocess(),
      isReadyForInference: () => true,
      engine,
    });

    const streamed: string[] = [];
    queue.subscribe((state) => {
      if (state.status === 'streaming') streamed.push(state.response);
    });

    await queue.submit(TEXT_REQUEST);

    expect(loadModel).toHaveBeenCalledTimes(1);
    // Normalized messages, not runtime-specific payloads.
    expect(Array.isArray(seen[0].messages)).toBe(true);
    expect(seen[0].messages.every((m) => typeof m.role === 'string' && typeof m.content === 'string')).toBe(true);
    expect(streamed).toContain('Hello');
    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe('Hello');
    expect(state.metrics).not.toBeNull();
  });

  it('forwards cancellation to the neutral adapter via the abort signal', async () => {
    const generateDeferred = defer<EngineGenerateResult>();
    let receivedSignal: AbortSignal | null = null;
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_request, _onToken, signal) => {
        receivedSignal = signal;
        return generateDeferred.promise;
      },
    };
    const queue = new InferenceQueue({
      preprocess: makePreprocess(),
      isReadyForInference: () => true,
      engine,
    });

    const submitPromise = queue.submit(TEXT_REQUEST);
    await Promise.resolve();
    await Promise.resolve();

    queue.cancel();
    expect((receivedSignal as AbortSignal | null)?.aborted).toBe(true);
    // Race-safe cancellation: the queue stays in-flight ('cancelling') until the
    // native call settles and its resource lease is released — it does not flip to
    // 'idle' the instant stop is pressed.
    expect(queue.getState().status).toBe('cancelling');

    generateDeferred.resolve({ response: '', tokenCount: 0 });
    await submitPromise;
    expect(queue.getState().status).toBe('idle');
  });

  it('surfaces a neutral-adapter failure as an errored queue state', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('runtime failure')),
    };
    const queue = new InferenceQueue({
      preprocess: makePreprocess(),
      isReadyForInference: () => true,
      engine,
    });

    await queue.submit(TEXT_REQUEST);

    expect(queue.getState().status).toBe('errored');
    expect(queue.getState().error).toContain('runtime failure');
  });
});
