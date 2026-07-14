jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));

import { readFileSync } from 'fs';
import { join } from 'path';

import { SingleFlightResourcePolicy } from '../../src/inference/DeviceResourcePolicy';
import type { PreprocessedImage } from '../../src/inference/ImagePreprocessor';
import {
  InferenceQueue,
  type InferenceEngineAdapter,
  type InferenceQueueDeps,
} from '../../src/inference/InferenceQueue';
import type { InferenceRequest, InferenceState } from '../../src/types/models';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const request: InferenceRequest = {
  imagePath: '/camera/capture.jpg',
  question: 'What is in this photo?',
};

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function preprocess(imagePath: string): Promise<PreprocessedImage> {
  return Promise.resolve({ path: `${imagePath}.512`, width: 512, height: 384 });
}

function instantEngine(response = 'A ceramic mug.'): InferenceEngineAdapter {
  return {
    loadModel: () => Promise.resolve(),
    generate: (_req, onToken) => {
      onToken(response);
      return Promise.resolve({ response, tokenCount: 4 });
    },
  };
}

function makeQueue(overrides: Partial<InferenceQueueDeps> = {}): InferenceQueue {
  return new InferenceQueue({
    preprocess,
    isReadyForInference: () => true,
    engine: instantEngine(),
    ...overrides,
  });
}

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('Inference pipeline contract', () => {
  it('rejects a concurrent submit without disturbing the in-flight request', async () => {
    const gate = defer<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('partial');
        return gate.promise;
      },
    };
    const queue = makeQueue({ engine });

    const first = queue.submit(request);
    await flush();
    expect(queue.getState().status).toBe('streaming');
    const inFlightState = queue.getState();

    await expect(queue.submit(request)).rejects.toThrow(/already in progress/i);
    expect(queue.getState()).toEqual(inFlightState);

    gate.resolve({ response: 'done', tokenCount: 1 });
    await first;
  });

  it('preprocesses before model readiness/load and refuses unverified models', async () => {
    const order: string[] = [];
    const loadModel = jest.fn(async () => {
      order.push('loadModel');
    });
    const queue = makeQueue({
      preprocess: async (imagePath) => {
        order.push('preprocess');
        return preprocess(imagePath);
      },
      isReadyForInference: () => {
        order.push('readiness');
        return false;
      },
      engine: {
        loadModel,
        generate: instantEngine().generate,
      },
    });

    await queue.submit(request);

    expect(order).toEqual(['preprocess', 'readiness']);
    expect(loadModel).not.toHaveBeenCalled();
    expect(queue.getState().status).toBe('errored');
    expect(queue.getState().error).toMatch(/not downloaded and verified/i);
  });

  it('notifies cancellation, discards partial output, and releases the queue lock', async () => {
    const gate = defer<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('partial answer');
        return gate.promise;
      },
    };
    const seen: InferenceState[] = [];
    const queue = makeQueue({ engine });
    queue.subscribe((state) => seen.push({ ...state }));

    const inFlight = queue.submit(request);
    await flush();

    queue.cancel();
    gate.resolve({ response: 'late answer', tokenCount: 2 });
    await inFlight;

    expect(seen.some((state) => state.status === 'cancelled')).toBe(true);
    expect(queue.getState().status).toBe('idle');
    expect(queue.getState().response).toBe('');
    await expect(queue.submit(request)).resolves.toBeUndefined();
  });

  it('holds the device resource lease through cancellation until the native call settles', async () => {
    const gate = defer<{ response: string; tokenCount: number }>();
    const engine: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: (_req, onToken) => {
        onToken('partial');
        return gate.promise;
      },
    };
    const resourcePolicy = new SingleFlightResourcePolicy();
    const queue = makeQueue({ engine, resourcePolicy });

    const inFlight = queue.submit(request);
    await flush();
    expect(resourcePolicy.isBusy()).toBe(true);

    queue.cancel();
    // Still settling: the lease is held, status stays 'cancelling', and a new
    // generation is refused rather than racing the lease release.
    expect(queue.getState().status).toBe('cancelling');
    expect(resourcePolicy.isBusy()).toBe(true);
    await expect(queue.submit(request)).rejects.toThrow(/already in progress/i);

    // Native call settles -> lease released -> idle -> the next request succeeds.
    gate.resolve({ response: 'late answer', tokenCount: 2 });
    await inFlight;
    expect(queue.getState().status).toBe('idle');
    expect(resourcePolicy.isBusy()).toBe(false);
    await expect(queue.submit(request)).resolves.toBeUndefined();
  });

  it('completes with all five metrics populated', async () => {
    const queue = makeQueue();

    await queue.submit(request);

    expect(queue.getState().status).toBe('completed');
    expect(queue.getState().metrics).toEqual(
      expect.objectContaining({
        modelLoadTimeMs: expect.any(Number),
        preprocessingTimeMs: expect.any(Number),
        firstTokenLatencyMs: expect.any(Number),
        tokensPerSecond: expect.any(Number),
        totalWallTimeMs: expect.any(Number),
      })
    );
  });

  it('maps model/runtime failures to a clean errored state instead of throwing', async () => {
    const queue = makeQueue({
      engine: {
        loadModel: () => Promise.resolve(),
        generate: () => Promise.reject(new Error('Cannot allocate tensor: out of memory')),
      },
    });

    await expect(queue.submit(request)).resolves.toBeUndefined();

    expect(queue.getState().status).toBe('errored');
    expect(queue.getState().error).toMatch(/out of memory/i);
    await expect(queue.submit(request)).resolves.toBeUndefined();
  });

  it('keeps inference structurally free of screen and network primitives', () => {
    const queueSource = readSource('src/inference/InferenceQueue.ts');

    expect(queueSource).not.toMatch(/['"].*screens/);
    expect(queueSource).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket)\b/);
  });
});
