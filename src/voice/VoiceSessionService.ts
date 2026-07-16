import type {
  DeviceResourcePolicy,
  ResourceLease,
} from '../inference/DeviceResourcePolicy';

import type { VoiceSession, VoiceSessionRuntime } from './VoiceSession';

/**
 * Coordinates one offline voice session under a SINGLE exclusive `voice-input`
 * resource lease that spans model initialization, recording, streaming
 * recognition, and finalization (FR-A09/A10). The lease and the underlying
 * recognizer/recorder are always released together — on stop, cancel, or failure
 * — so voice can never overlap Qwen work and never leaks native resources.
 */
export class VoiceSessionService {
  private lease: ResourceLease | null = null;
  private session: VoiceSession | null = null;

  constructor(
    private readonly runtime: VoiceSessionRuntime,
    private readonly resourcePolicy: DeviceResourcePolicy,
  ) {}

  isActive(): boolean {
    return this.session !== null;
  }

  /**
   * Acquires the exclusive lease and starts a live session. Fails fast (throwing)
   * when another protected operation holds the gate, so the UI can show a clear
   * "unavailable while …" message rather than blocking.
   */
  async start(onPartial: (partialText: string) => void): Promise<void> {
    if (this.session !== null) {
      return;
    }
    const lease = this.resourcePolicy.tryAcquire('voice-input');
    if (lease === null) {
      throw new Error('Voice input is unavailable while another on-device operation is running.');
    }
    this.lease = lease;
    try {
      const session = await this.runtime.start();
      session.onPartial(onPartial);
      this.session = session;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  /** Stops recording, finalizes, and returns the trimmed transcript. */
  async stop(): Promise<string> {
    const session = this.session;
    if (session === null) {
      throw new Error('Voice recording has not started.');
    }
    try {
      const transcript = await session.stop();
      return transcript.trim();
    } finally {
      await this.cleanup();
    }
  }

  /** Cancels an in-flight session (while recording OR while finalizing). */
  async cancel(): Promise<void> {
    const session = this.session;
    if (session === null) {
      return;
    }
    try {
      await session.cancel();
    } finally {
      await this.cleanup();
    }
  }

  /** Releases the recognizer/recorder + temp audio and frees the lease. Idempotent. */
  private async cleanup(): Promise<void> {
    const session = this.session;
    this.session = null;
    try {
      await session?.release();
    } finally {
      this.lease?.release();
      this.lease = null;
    }
  }
}
