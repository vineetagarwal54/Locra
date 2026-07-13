// T013 — failing-first tests for the device resource policy (FR-045).

import {
  activityOwnerFor,
  SingleFlightResourcePolicy,
  type ProtectedOperation,
} from '../../../src/inference/DeviceResourcePolicy';
import { InferenceActivityLock } from '../../../src/inference/InferenceActivityLock';

function freshPolicy(): { policy: SingleFlightResourcePolicy; lock: InferenceActivityLock } {
  const lock = new InferenceActivityLock();
  return { policy: new SingleFlightResourcePolicy(lock), lock };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('SingleFlightResourcePolicy', () => {
  it('allows only one protected operation to hold the gate at a time', () => {
    const { policy } = freshPolicy();

    const answer = policy.tryAcquire('qwen-answer');
    expect(answer).not.toBeNull();
    expect(policy.isBusy()).toBe(true);
    expect(policy.current()).toBe('qwen-answer');

    // A second, different operation cannot acquire while the first is held.
    expect(policy.tryAcquire('embedding')).toBeNull();
    expect(policy.tryAcquire('record')).toBeNull();
  });

  it('frees the gate on release and lets the next operation acquire', () => {
    const { policy } = freshPolicy();

    const answer = policy.tryAcquire('qwen-answer');
    answer?.release();

    expect(policy.isBusy()).toBe(false);
    expect(policy.current()).toBeNull();

    const embedding = policy.tryAcquire('embedding');
    expect(embedding).not.toBeNull();
    expect(policy.current()).toBe('embedding');
  });

  it('acquire() waits until the gate is released, then resolves', async () => {
    const { policy } = freshPolicy();

    const recording = policy.tryAcquire('record');
    expect(recording).not.toBeNull();

    let resolved = false;
    const pending = policy.acquire('qwen-answer').then((lease) => {
      resolved = true;
      return lease;
    });

    await flush();
    expect(resolved).toBe(false); // still blocked

    recording?.release();
    const lease = await pending;
    expect(resolved).toBe(true);
    expect(lease.operation).toBe('qwen-answer');
    expect(policy.current()).toBe('qwen-answer');
  });

  it('serves waiters in FIFO order', async () => {
    const { policy } = freshPolicy();
    const held = policy.tryAcquire('qwen-answer');

    const order: ProtectedOperation[] = [];
    const first = policy.acquire('embedding').then((l) => {
      order.push(l.operation);
      return l;
    });
    const second = policy.acquire('qwen-compaction').then((l) => {
      order.push(l.operation);
      return l;
    });

    held?.release();
    (await first).release();
    (await second).release();

    expect(order).toEqual(['embedding', 'qwen-compaction']);
  });

  it('release is idempotent and a stale lease never frees a newer holder', () => {
    const { policy } = freshPolicy();

    const first = policy.tryAcquire('qwen-answer');
    first?.release();
    first?.release(); // double release — no throw, no effect
    expect(policy.isBusy()).toBe(false);

    const second = policy.tryAcquire('embedding');
    first?.release(); // stale lease must NOT release the new holder
    expect(policy.isBusy()).toBe(true);
    expect(policy.current()).toBe('embedding');
    second?.release();
  });

  it('reflects the hold into the legacy vlm/voice activity lock', () => {
    const { policy, lock } = freshPolicy();

    const recording = policy.tryAcquire('record');
    expect(lock.heldBy()).toBe('voice');
    recording?.release();
    expect(lock.isBusy()).toBe(false);

    const embedding = policy.tryAcquire('embedding');
    expect(lock.heldBy()).toBe('vlm');
    embedding?.release();
    expect(lock.isBusy()).toBe(false);
  });

  it('maps operations to the correct legacy owner', () => {
    expect(activityOwnerFor('qwen-answer')).toBe('vlm');
    expect(activityOwnerFor('qwen-compaction')).toBe('vlm');
    expect(activityOwnerFor('embedding')).toBe('vlm');
    expect(activityOwnerFor('record')).toBe('voice');
    expect(activityOwnerFor('transcribe')).toBe('voice');
  });
});
