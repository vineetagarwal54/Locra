// InferenceQueue transitively imports ImagePreprocessor, which pulls in the
// native react-native-nitro-image module at require time. Stub it out — this
// suite injects its own preprocess and never touches the real backend.
jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';
import {
  InferenceQueue,
  type InferenceEngineAdapter,
  type InferenceQueueDeps,
} from '../../../src/inference/InferenceQueue';
import type { InferenceRequest, InferenceState } from '../../../src/types/models';

// Let all pending microtasks (the awaited preprocess/loadModel steps) settle.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const request: InferenceRequest = { imagePath: '/tmp/capture.jpg', question: 'What is this?' };

function passthroughPreprocess(imagePath: string): Promise<PreprocessedImage> {
  return Promise.resolve({ path: imagePath, width: 512, height: 512 });
}

function makeQueue(overrides: Partial<InferenceQueueDeps> = {}): InferenceQueue {
  const deps: InferenceQueueDeps = {
    preprocess: passthroughPreprocess,
    isReadyForInference: () => true,
    engine: overrides.engine ?? instantEngine('answer', 3),
    ...overrides,
  };
  return new InferenceQueue(deps);
}

function instantEngine(response: string, tokenCount: number): InferenceEngineAdapter {
  return {
    loadModel: () => Promise.resolve(),
    generate: (_req, onToken) => {
      onToken(response);
      return Promise.resolve({ response, tokenCount });
    },
  };
}

describe('InferenceQueue', () => {
  it('completes a request and populates all five metrics', async () => {
    const queue = makeQueue();
    await queue.submit(request);

    const state = queue.getState();
    expect(state.status).toBe('completed');
    expect(state.response).toBe('answer');
    expect(state.metrics).not.toBeNull();
    expect(Object.keys(state.metrics ?? {})).toEqual(
      expect.arrayContaining([
        'modelLoadTimeMs',
        'preprocessingTimeMs',
        'firstTokenLatencyMs',
        'tokensPerSecond',
        'totalWallTimeMs',
      ]),
    );
  });

  it('rejects submit() while a request is in-flight without acquiring the lock (FR-006)', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('do'); // a first token streams, then generation stays in flight
        return gate.promise;
      },
    };
    const queue = makeQueue({ engine });

    const first = queue.submit(request);
    await flush(); // drive the first request into 'streaming'
    expect(queue.getState().status).toBe('streaming');

    const before = queue.getState();
    await expect(queue.submit(request)).rejects.toThrow();
    // The rejected second call must not have disturbed the in-flight state.
    expect(queue.getState()).toEqual(before);

    gate.resolve({ response: 'done', tokenCount: 1 });
    await first;
    expect(queue.getState().status).toBe('completed');
  });

  it('cancel() discards the partial response, returns to idle, and leaves no residual output (FR-007)', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('partial ans');
        return gate.promise;
      },
    };
    const seen: InferenceState[] = [];
    const queue = makeQueue({ engine });
    queue.subscribe((s) => seen.push({ ...s }));

    const inFlight = queue.submit(request);
    await flush();
    expect(queue.getState().response).toBe('partial ans');

    queue.cancel();

    // Subscribers observe the terminal 'cancelled' notification (contract)...
    expect(seen.some((s) => s.status === 'cancelled')).toBe(true);
    // ...and the queue returns to idle with no residual output.
    const state = queue.getState();
    expect(state.status).toBe('idle');
    expect(state.response).toBe('');
    expect(state.metrics).toBeNull();

    // A late resolution of the cancelled generation must not resurrect output.
    gate.resolve({ response: 'partial ans and more', tokenCount: 9 });
    await inFlight;
    expect(queue.getState().response).toBe('');
    expect(queue.getState().status).toBe('idle');
  });

  it('resolves an injected OOM error during streaming to status errored, never an unhandled throw (FR-023)', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('Cannot allocate tensor: out of memory')),
    };
    const queue = makeQueue({ engine });

    await expect(queue.submit(request)).resolves.toBeUndefined();

    const state = queue.getState();
    expect(state.status).toBe('errored');
    expect(state.error).toMatch(/out of memory/i);
  });

  it('releases the lock on the completed exit path', async () => {
    const queue = makeQueue();
    await queue.submit(request);
    expect(queue.getState().status).toBe('completed');
    // Lock released → a fresh submit is accepted, not rejected by single-flight.
    await expect(queue.submit(request)).resolves.toBeUndefined();
    expect(queue.getState().status).toBe('completed');
  });

  it('releases the lock on the cancelled exit path', async () => {
    const gate = deferred<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => gate.promise,
    };
    const queue = makeQueue({ engine });

    const inFlight = queue.submit(request);
    await flush();
    queue.cancel();
    gate.resolve({ response: 'x', tokenCount: 1 });
    await inFlight;

    await expect(queue.submit(request)).resolves.toBeUndefined();
  });

  it('releases the lock on the errored exit path', async () => {
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('out of memory')),
    };
    const queue = makeQueue({ engine });

    await queue.submit(request);
    expect(queue.getState().status).toBe('errored');
    await expect(queue.submit(request)).resolves.toBeUndefined();
  });
});
