import type { DeviceResourcePolicy } from '../inference/DeviceResourcePolicy';

export interface NativeVoiceTranscriber {
  transcribe(audioPath: string, signal: AbortSignal): Promise<string>;
  release(): Promise<void> | void;
}

export class VoiceTranscriptionService {
  private controller: AbortController | null = null;

  constructor(
    private readonly transcriber: NativeVoiceTranscriber,
    private readonly resourcePolicy: DeviceResourcePolicy,
  ) {}

  async transcribe(audioPath: string): Promise<string> {
    const lease = await this.resourcePolicy.acquire('transcribe');
    const controller = new AbortController();
    this.controller = controller;
    try {
      return (await this.transcriber.transcribe(audioPath, controller.signal)).trim();
    } finally {
      this.controller = null;
      try {
        await this.transcriber.release();
      } finally {
        lease.release();
      }
    }
  }

  cancel(): void {
    this.controller?.abort();
  }
}

