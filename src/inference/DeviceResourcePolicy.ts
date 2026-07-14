// Spec 006 — one device-resource gate (FR-045, Constitution II/IV). Extends the
// existing cross-feature single-flight lock (`InferenceActivityLock`, vlm↔voice)
// into a single mutual-exclusion gate over every heavy on-device operation, so
// only one of them is ever active at a time on a 6–8GB device.
//
// `tryAcquire` is non-blocking (returns null when busy) for user-facing paths
// that must fail fast with a clear status (e.g. "recording is unavailable while
// generating"). `acquire` queues FIFO and resolves when the gate frees, for
// background jobs (embedding/compaction) that should wait their turn. Every
// lease releases cleanly on success, cancellation, or failure and is idempotent.

import {
  inferenceActivityLock,
  type ActivityLock,
  type ActivityOwner,
} from './InferenceActivityLock';

export type ProtectedOperation =
  | 'qwen-answer'
  | 'qwen-compaction'
  | 'embedding'
  | 'record'
  | 'transcribe';

export interface ResourceLease {
  readonly operation: ProtectedOperation;
  /** Frees the gate. Idempotent; a no-op if this lease is no longer the holder. */
  release(): void;
}

export interface DeviceResourcePolicy {
  /** Waits (FIFO) until the gate is free, then resolves with a held lease. */
  acquire(operation: ProtectedOperation): Promise<ResourceLease>;
  /** Non-blocking: returns a held lease, or null if another operation holds the gate. */
  tryAcquire(operation: ProtectedOperation): ResourceLease | null;
  isBusy(): boolean;
  current(): ProtectedOperation | null;
}

/** Maps a protected operation onto the legacy vlm/voice cross-feature owner. */
export function activityOwnerFor(operation: ProtectedOperation): ActivityOwner {
  return operation === 'record' || operation === 'transcribe' ? 'voice' : 'vlm';
}

interface Held {
  readonly operation: ProtectedOperation;
  readonly lease: ResourceLease;
}

interface Waiter {
  readonly operation: ProtectedOperation;
  readonly resolve: (lease: ResourceLease) => void;
}

export class SingleFlightResourcePolicy implements DeviceResourcePolicy {
  private held: Held | null = null;
  private readonly waiters: Waiter[] = [];

  /** `activityLock` bridges to the legacy vlm/voice coordinator (default: shared). */
  constructor(private readonly activityLock: ActivityLock = inferenceActivityLock) {}

  tryAcquire(operation: ProtectedOperation): ResourceLease | null {
    if (this.held !== null) {
      return null;
    }
    return this.grant(operation);
  }

  acquire(operation: ProtectedOperation): Promise<ResourceLease> {
    if (this.held === null) {
      return Promise.resolve(this.grant(operation));
    }
    return new Promise<ResourceLease>((resolve) => {
      this.waiters.push({ operation, resolve });
    });
  }

  isBusy(): boolean {
    return this.held !== null;
  }

  current(): ProtectedOperation | null {
    return this.held?.operation ?? null;
  }

  private grant(operation: ProtectedOperation): ResourceLease {
    // Reflect the hold into the legacy cross-feature lock so existing consumers
    // (the VLM queue's 'vlm', the voice path's 'voice') observe the gate as busy.
    this.activityLock.tryAcquire(activityOwnerFor(operation));

    let released = false;
    const lease: ResourceLease = {
      operation,
      release: (): void => {
        if (released || this.held?.lease !== lease) {
          return;
        }
        released = true;
        this.releaseHeld(operation);
      },
    };
    this.held = { operation, lease };
    return lease;
  }

  private releaseHeld(operation: ProtectedOperation): void {
    this.held = null;
    this.activityLock.release(activityOwnerFor(operation));

    const next = this.waiters.shift();
    if (next !== undefined) {
      next.resolve(this.grant(next.operation));
    }
  }
}

/** Process-wide device resource policy shared by every heavy-operation caller. */
export const deviceResourcePolicy: DeviceResourcePolicy = new SingleFlightResourcePolicy();
