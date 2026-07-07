// FR-033: on-device voice transcription and VLM inference share the device's
// compute and must never run concurrently. This is one shared single-flight
// lock both features consult — the VLM InferenceQueue acquires 'vlm' before it
// runs, and the voice transcription path acquires 'voice' before it records.
// Whichever holds it blocks the other until release.
//
// This is intentionally separate from InferenceQueue's own internal in-flight
// guard (which prevents vlm↔vlm concurrency): this lock is the cross-feature
// coordinator, so neither module needs to know the other's internals.

export type ActivityOwner = 'vlm' | 'voice';

export interface ActivityLock {
  /** Acquires for `owner`. Returns false if a different owner already holds it. */
  tryAcquire(owner: ActivityOwner): boolean;
  /** Releases only if `owner` is the current holder; otherwise a no-op. */
  release(owner: ActivityOwner): void;
  isBusy(): boolean;
  heldBy(): ActivityOwner | null;
}

export class InferenceActivityLock implements ActivityLock {
  private owner: ActivityOwner | null = null;

  tryAcquire(owner: ActivityOwner): boolean {
    if (this.owner !== null && this.owner !== owner) {
      return false;
    }
    this.owner = owner;
    return true;
  }

  release(owner: ActivityOwner): void {
    if (this.owner === owner) {
      this.owner = null;
    }
  }

  isBusy(): boolean {
    return this.owner !== null;
  }

  heldBy(): ActivityOwner | null {
    return this.owner;
  }
}

/** Process-wide shared instance both the VLM queue and voice path coordinate on. */
export const inferenceActivityLock: ActivityLock = new InferenceActivityLock();
