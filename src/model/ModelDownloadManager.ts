import type { ModelState } from '../types/models';

// Wraps a resource fetcher's download lifecycle and runs a SHA-256 integrity
// check after every fetch. Constitution Principle X: self-contained model
// lifecycle — no imports from inference or screens. Dependencies (the fetcher
// and the integrity verifier) are INJECTED so this module never loads a native
// package at import time; the real ExpoResourceFetcher + verifyModelIntegrity
// are wired at the composition root (modelStore, T025).

// Mirrors ExpoResourceFetcher's `ResourceSource` (string | number | object)
// without importing the native package.
export type ResourceSource = string | number | object;

export interface ResourceFetcherLike {
  fetch(
    callback?: (progress: number) => void,
    ...sources: ResourceSource[]
  ): Promise<{ paths: string[]; wasDownloaded: boolean[] }>;
  pauseFetching(...sources: ResourceSource[]): Promise<void>;
  resumeFetching(...sources: ResourceSource[]): Promise<void>;
  cancelFetching(...sources: ResourceSource[]): Promise<void>;
  deleteResources(...sources: ResourceSource[]): Promise<void>;
  /** Local paths of already-downloaded model (`.pte`) files. */
  listDownloadedModels(): Promise<string[]>;
}

export interface ModelDownloadManagerDeps {
  fetcher: ResourceFetcherLike;
  verifyIntegrity: (fileUri: string, expectedSha256: string) => Promise<boolean>;
  /** Bytes on disk for a given path (injected so this module stays native-free). */
  getFileSize: (fileUri: string) => Promise<number>;
  /** Model + tokenizer + config sources, in order; `sources[0]` is the `.pte`. */
  sources: ResourceSource[];
  expectedSha256: string;
  /** Exact byte size of the pinned `.pte`, used as the launch-time partial-file guard. */
  expectedSize: number;
}

const INITIAL_STATE: ModelState = {
  downloadStatus: 'not_started',
  downloadProgress: 0,
  integrityVerified: false,
  error: null,
};

export class ModelDownloadManager {
  private state: ModelState = { ...INITIAL_STATE };
  private readonly listeners = new Set<(state: ModelState) => void>();

  constructor(private readonly deps: ModelDownloadManagerDeps) {}

  getState(): ModelState {
    return this.state;
  }

  subscribe(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isReadyForInference(): boolean {
    return this.state.downloadStatus === 'downloaded' && this.state.integrityVerified;
  }

  async startDownload(): Promise<void> {
    this.setState({
      downloadStatus: 'downloading',
      downloadProgress: 0,
      integrityVerified: false,
      error: null,
    });
    try {
      const { paths } = await this.deps.fetcher.fetch(
        (progress) => this.setState({ downloadProgress: progress }),
        ...this.deps.sources,
      );
      const verified = await this.deps.verifyIntegrity(paths[0], this.deps.expectedSha256);
      if (verified) {
        this.setState({
          downloadStatus: 'downloaded',
          downloadProgress: 1,
          integrityVerified: true,
          error: null,
        });
        return;
      }
      // Corrupt bytes: clear the partial file BEFORE reporting 'failed' so the
      // next startDownload() is always a clean re-download, never a resume of
      // corrupt bytes (model-lifecycle.contract.md postconditions).
      await this.safeDelete();
      this.setState({
        downloadStatus: 'failed',
        integrityVerified: false,
        error: 'The downloaded model failed its integrity check.',
      });
    } catch (error) {
      await this.safeDelete();
      this.setState({
        downloadStatus: 'failed',
        integrityVerified: false,
        error: toMessage(error),
      });
    }
  }

  /**
   * Launch-time reconciliation against the real filesystem (data-model.md:
   * `OnDeviceModel` is "reconciled each launch"). A model file is only ever left
   * on disk AFTER it passed its SHA-256 check at download time (startDownload
   * deletes anything that fails), so presence is a trustworthy cached result:
   * present ⇒ ready, absent ⇒ not ready. This deliberately does NOT re-hash the
   * file — loading a multi-GB model into memory on every cold start would
   * violate the memory-safety budget on 6–8 GB devices (Principle IV;
   * data-model.md's `lastVerifiedAt` "trust the cached result" path). Never
   * downloads; never throws.
   */
  async reconcile(): Promise<void> {
    try {
      const models = await this.deps.fetcher.listDownloadedModels();
      if (models.length === 0) {
        this.setState({ ...INITIAL_STATE });
        return;
      }
      // Cheap, memory-safe guard against a partial/truncated download (e.g. the
      // app was killed mid-fetch): a file whose size doesn't match the pinned
      // model size is discarded rather than trusted as ready.
      const size = await this.deps.getFileSize(models[0]);
      if (size !== this.deps.expectedSize) {
        await this.safeDelete();
        this.setState({ ...INITIAL_STATE });
        return;
      }
      this.setState({
        downloadStatus: 'downloaded',
        downloadProgress: 1,
        integrityVerified: true,
        error: null,
      });
    } catch {
      this.setState({ ...INITIAL_STATE });
    }
  }

  async pauseDownload(): Promise<void> {
    try {
      await this.deps.fetcher.pauseFetching(...this.deps.sources);
      this.setState({ downloadStatus: 'paused' });
    } catch {
      // Nothing active to pause — absorb ResourceFetcherAlreadyPaused into a
      // safe no-op (model-lifecycle.contract.md preconditions).
    }
  }

  async resumeDownload(): Promise<void> {
    try {
      await this.deps.fetcher.resumeFetching(...this.deps.sources);
      this.setState({ downloadStatus: 'downloading' });
    } catch {
      // Nothing paused to resume — absorb ResourceFetcherAlreadyOngoing.
    }
  }

  async cancelDownload(): Promise<void> {
    try {
      await this.deps.fetcher.cancelFetching(...this.deps.sources);
    } catch {
      // Nothing active to cancel.
    }
    await this.safeDelete();
    this.setState({ ...INITIAL_STATE });
  }

  private async safeDelete(): Promise<void> {
    try {
      await this.deps.fetcher.deleteResources(...this.deps.sources);
    } catch {
      // Best-effort cleanup; a delete failure must not mask the real outcome.
    }
  }

  private setState(patch: Partial<ModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'Model download failed.';
}
