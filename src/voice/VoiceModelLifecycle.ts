export type VoiceModelStatus =
  | 'disabled'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error';

export interface VoiceModelState {
  readonly enabled: boolean;
  readonly status: VoiceModelStatus;
  readonly downloadProgress: number;
  readonly permissionGranted: boolean;
  readonly error: string | null;
}

export interface VoiceArtifactAdapter {
  readonly storageBytes: number | null;
  isReady(): Promise<boolean>;
  download(onProgress: (progress: number) => void): Promise<void>;
  verify(): Promise<boolean>;
}

export interface MicrophonePermissionAdapter {
  request(): Promise<boolean>;
}

export class VoiceModelLifecycle {
  private state: VoiceModelState = {
    enabled: false,
    status: 'disabled',
    downloadProgress: 0,
    permissionGranted: false,
    error: null,
  };
  private readonly listeners = new Set<(state: VoiceModelState) => void>();

  constructor(
    private readonly artifact: VoiceArtifactAdapter,
    private readonly permission: MicrophonePermissionAdapter,
  ) {}

  get storageBytes(): number | null {
    return this.artifact.storageBytes;
  }

  getState(): VoiceModelState {
    return { ...this.state };
  }

  subscribe(listener: (state: VoiceModelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async enable(): Promise<void> {
    this.setState({ enabled: true, error: null });
    try {
      if (!await this.artifact.isReady()) {
        this.setState({ status: 'downloading', downloadProgress: 0 });
        await this.artifact.download((downloadProgress) => {
          this.setState({ downloadProgress: Math.min(1, Math.max(0, downloadProgress)) });
        });
        this.setState({ status: 'verifying' });
        if (!await this.artifact.verify()) {
          throw new Error('The offline voice model failed integrity verification.');
        }
      }
      this.setState({ status: 'ready', downloadProgress: 1 });
    } catch (error) {
      this.setState({ status: 'error', error: toMessage(error) });
      throw error;
    }
  }

  async requestMicPermission(): Promise<boolean> {
    const permissionGranted = await this.permission.request();
    this.setState({ permissionGranted });
    return permissionGranted;
  }

  private setState(patch: Partial<VoiceModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Offline voice setup failed.';
}

