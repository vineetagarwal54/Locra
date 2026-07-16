// Pure collector for the internal voice device-validation screen. It timestamps
// the lifecycle events of one live session and derives the metrics the physical
// device gate (T092) requires. No native/UI dependencies so it is unit tested.

import type { VoiceModelDescriptor } from './VoiceModelDescriptor';

export interface VoiceValidationReport {
  /** ms from session start to the FIRST partial transcript. */
  readonly firstPartialLatencyMs: number | null;
  /** mean ms between consecutive partial updates (null with < 2 partials). */
  readonly meanPartialIntervalMs: number | null;
  readonly partialUpdateCount: number;
  /** ms from stop request to the final transcript. */
  readonly finalTranscriptLatencyMs: number | null;
  /** ms to initialize the recognizer + recorder. */
  readonly initMs: number | null;
  /** ms to release the recognizer + recorder. */
  readonly releaseMs: number | null;
  /** Peak JS heap bytes observed, when the platform reports it. */
  readonly peakMemoryBytes: number | null;
  readonly cancelled: boolean;
  readonly airplaneModeResult: 'not-tested' | 'succeeded' | 'failed';
  readonly model: {
    readonly id: string;
    readonly displayName: string;
    readonly approxSizeBytes: number;
  };
}

/**
 * Accumulates timing/behavior samples for a single validation run. Inject `now`
 * for deterministic tests; defaults to a monotonic clock.
 */
export class VoiceValidationRun {
  private startedAt: number | null = null;
  private initDoneAt: number | null = null;
  private firstPartialAt: number | null = null;
  private lastPartialAt: number | null = null;
  private partialCount = 0;
  private partialIntervalTotal = 0;
  private stopRequestedAt: number | null = null;
  private finalAt: number | null = null;
  private releaseStartedAt: number | null = null;
  private releaseDoneAt: number | null = null;
  private peakMemoryBytes: number | null = null;
  private wasCancelled = false;
  private airplaneModeResult: VoiceValidationReport['airplaneModeResult'] = 'not-tested';

  constructor(
    private readonly descriptor: VoiceModelDescriptor,
    private readonly now: () => number = () => Date.now(),
  ) {}

  markStart(): void {
    this.startedAt = this.now();
  }

  markInitialized(): void {
    this.initDoneAt = this.now();
  }

  markPartial(): void {
    const at = this.now();
    if (this.firstPartialAt === null) {
      this.firstPartialAt = at;
    } else if (this.lastPartialAt !== null) {
      this.partialIntervalTotal += at - this.lastPartialAt;
    }
    this.lastPartialAt = at;
    this.partialCount += 1;
  }

  markStopRequested(): void {
    this.stopRequestedAt = this.now();
  }

  markFinal(): void {
    this.finalAt = this.now();
  }

  markReleaseStart(): void {
    this.releaseStartedAt = this.now();
  }

  markReleaseDone(): void {
    this.releaseDoneAt = this.now();
  }

  markCancelled(): void {
    this.wasCancelled = true;
  }

  sampleMemory(bytes: number | null): void {
    if (bytes !== null && (this.peakMemoryBytes === null || bytes > this.peakMemoryBytes)) {
      this.peakMemoryBytes = bytes;
    }
  }

  setAirplaneModeResult(result: 'succeeded' | 'failed'): void {
    this.airplaneModeResult = result;
  }

  build(): VoiceValidationReport {
    return {
      firstPartialLatencyMs: diff(this.startedAt, this.firstPartialAt),
      meanPartialIntervalMs:
        this.partialCount >= 2 ? this.partialIntervalTotal / (this.partialCount - 1) : null,
      partialUpdateCount: this.partialCount,
      finalTranscriptLatencyMs: diff(this.stopRequestedAt, this.finalAt),
      initMs: diff(this.startedAt, this.initDoneAt),
      releaseMs: diff(this.releaseStartedAt, this.releaseDoneAt),
      peakMemoryBytes: this.peakMemoryBytes,
      cancelled: this.wasCancelled,
      airplaneModeResult: this.airplaneModeResult,
      model: {
        id: this.descriptor.id,
        displayName: this.descriptor.displayName,
        approxSizeBytes: this.descriptor.approxSizeBytes,
      },
    };
  }
}

function diff(from: number | null, to: number | null): number | null {
  return from !== null && to !== null ? to - from : null;
}
