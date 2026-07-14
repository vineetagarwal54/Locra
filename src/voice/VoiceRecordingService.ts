import type {
  DeviceResourcePolicy,
  ResourceLease,
} from '../inference/DeviceResourcePolicy';

export interface NativeVoiceRecorder {
  start(): Promise<void>;
  stop(): Promise<string>;
  cancel(): Promise<void> | void;
}

export class VoiceRecordingService {
  private lease: ResourceLease | null = null;

  constructor(
    private readonly recorder: NativeVoiceRecorder,
    private readonly resourcePolicy: DeviceResourcePolicy,
  ) {}

  async startRecording(): Promise<void> {
    if (this.lease !== null) {
      return;
    }
    const lease = this.resourcePolicy.tryAcquire('record');
    if (lease === null) {
      throw new Error('Voice recording is unavailable while another on-device operation is running.');
    }
    this.lease = lease;
    try {
      await this.recorder.start();
    } catch (error) {
      this.release();
      throw error;
    }
  }

  async stopRecording(): Promise<string> {
    if (this.lease === null) {
      throw new Error('Voice recording has not started.');
    }
    try {
      return await this.recorder.stop();
    } finally {
      this.release();
    }
  }

  cancel(): void {
    if (this.lease === null) {
      return;
    }
    try {
      void this.recorder.cancel();
    } finally {
      this.release();
    }
  }

  private release(): void {
    this.lease?.release();
    this.lease = null;
  }
}

