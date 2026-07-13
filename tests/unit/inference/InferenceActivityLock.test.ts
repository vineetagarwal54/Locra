jest.mock('react-native-nitro-image', () => ({ loadImage: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';
import {
  InferenceActivityLock,
  inferenceActivityLock,
} from '../../../src/inference/InferenceActivityLock';
import {
  InferenceQueue,
  type InferenceEngineAdapter,
} from '../../../src/inference/InferenceQueue';
import type { InferenceRequest } from '../../../src/types/models';

// FR-033: a voice transcription and a VLM inference MUST NOT run concurrently.
// Both features consult one shared single-flight lock.

describe('InferenceActivityLock (FR-033)', () => {
  it('lets one owner hold at a time; the other cannot acquire until release', () => {
    const lock = new InferenceActivityLock();

    expect(lock.tryAcquire('voice')).toBe(true);
    expect(lock.isBusy()).toBe(true);
    expect(lock.heldBy()).toBe('voice');

    // VLM cannot start while voice holds it.
    expect(lock.tryAcquire('vlm')).toBe(false);

    lock.release('voice');
    expect(lock.isBusy()).toBe(false);
    // Now VLM can acquire.
    expect(lock.tryAcquire('vlm')).toBe(true);
    // ...and voice is now blocked.
    expect(lock.tryAcquire('voice')).toBe(false);
  });

  it('re-acquire by the current holder is a no-op success (idempotent)', () => {
    const lock = new InferenceActivityLock();
    expect(lock.tryAcquire('voice')).toBe(true);
    expect(lock.tryAcquire('voice')).toBe(true);
    expect(lock.heldBy()).toBe('voice');
  });

  it('release by a non-holder does not free the lock', () => {
    const lock = new InferenceActivityLock();
    lock.tryAcquire('vlm');
    lock.release('voice'); // wrong owner
    expect(lock.isBusy()).toBe(true);
    expect(lock.heldBy()).toBe('vlm');
  });

  it('exports a shared singleton for cross-feature coordination', () => {
    expect(inferenceActivityLock.isBusy()).toBe(false);
    expect(inferenceActivityLock.tryAcquire('vlm')).toBe(true);
    inferenceActivityLock.release('vlm');
  });
});

describe('InferenceQueue ⇄ voice mutual exclusion (FR-033)', () => {
  const request: InferenceRequest = { imagePath: '/tmp/x.jpg', question: 'What is this?' };
  const preprocess = (p: string): Promise<PreprocessedImage> =>
    Promise.resolve({ path: p, width: 512, height: 512 });
  const engine: InferenceEngineAdapter = {
    loadModel: () => Promise.resolve(),
    generate: (_r, onToken) => {
      onToken('ok', 1);
      return Promise.resolve({ response: 'ok', tokenCount: 1 });
    },
  };

  it('rejects a VLM submit while voice holds the lock, then succeeds after release', async () => {
    const lock = new InferenceActivityLock();
    const queue = new InferenceQueue({
      preprocess,
      isReadyForInference: () => true,
      engine,
      activityLock: lock,
    });

    lock.tryAcquire('voice');
    await expect(queue.submit(request)).rejects.toThrow(/voice/i);
    expect(queue.getState().status).toBe('idle');

    lock.release('voice');
    await queue.submit(request);
    expect(queue.getState().status).toBe('completed');
  });

  it('releases the VLM lock after completion so voice can then acquire', async () => {
    const lock = new InferenceActivityLock();
    const queue = new InferenceQueue({
      preprocess,
      isReadyForInference: () => true,
      engine,
      activityLock: lock,
    });

    await queue.submit(request);

    expect(lock.isBusy()).toBe(false);
    expect(lock.tryAcquire('voice')).toBe(true);
  });

  it('releases the VLM lock on the errored path too', async () => {
    const lock = new InferenceActivityLock();
    const failing: InferenceEngineAdapter = {
      loadModel: () => Promise.resolve(),
      generate: () => Promise.reject(new Error('out of memory')),
    };
    const queue = new InferenceQueue({
      preprocess,
      isReadyForInference: () => true,
      engine: failing,
      activityLock: lock,
    });

    await queue.submit(request);
    expect(queue.getState().status).toBe('errored');
    expect(lock.isBusy()).toBe(false);
  });
});
