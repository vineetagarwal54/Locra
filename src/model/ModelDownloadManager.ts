import type { ModelState } from '../types/models';

import type { ArtifactReadiness } from './ModelArtifactManifest';
import type { ModelConfig } from './ModelConfig';

// Wraps a resource fetcher's download lifecycle and runs a SHA-256 integrity
// check after every fetch. Constitution Principle X: self-contained model
// lifecycle — no imports from inference or screens. Dependencies (the fetcher
// and the integrity verifier) are INJECTED so this module never loads a native
// package at import time; the real ExpoResourceFetcher/BackgroundDownloadFetcher
// + verifyModelIntegrity are wired at the composition root (modelStore).
//
// Generalized (Spec 005, T017) from a single `.pte` model into an EXACT-manifest
// artifact BUNDLE: one or more independently-verified artifacts (e.g. Qwen's
// language GGUF + Q8_0 projector). Each artifact is located by its exact
// filename and verified independently; the bundle is ready only when every
// artifact is downloaded AND integrity-verified. Aggregate progress/status stays
// the product-facing `ModelState`; per-artifact readiness is exposed separately
// for the internal bundle wiring. The legacy single-artifact (LFM/ExecuTorch)
// wiring is preserved by passing `expectedModelFilename` + `getModelConfig`.

// Mirrors ExpoResourceFetcher's `ResourceSource` (string | number | object)
// without importing the native package.
export type ResourceSource = string | number | object;

export type ReattachedDownloadStatus = 'downloading' | 'paused';

export interface ReattachedDownload {
  status: ReattachedDownloadStatus;
  progress: number;
  promise: Promise<{ paths: string[]; wasDownloaded: boolean[] }>;
}

export interface ResourceFetcherLike {
  fetch(
    callback?: (progress: number) => void,
    ...sources: ResourceSource[]
  ): Promise<{ paths: string[]; wasDownloaded: boolean[] }>;
  reattachExistingDownloads?(
    callback?: (progress: number) => void,
    ...sources: ResourceSource[]
  ): Promise<ReattachedDownload | null>;
  pauseFetching(...sources: ResourceSource[]): Promise<void>;
  resumeFetching(...sources: ResourceSource[]): Promise<void>;
  cancelFetching(...sources: ResourceSource[]): Promise<void>;
  deleteResources(...sources: ResourceSource[]): Promise<void>;
  /** Local paths of already-downloaded model artifact files. */
  listDownloadedModels(): Promise<string[]>;
}

/** One independently-verified artifact in the bundle. */
export interface VerifiedArtifact {
  /** Stable internal id (mirrors the manifest descriptor). */
  readonly artifactId: string;
  /** Exact expected filename, used to locate the file among fetch results / on disk. */
  readonly fileName: string;
  /** Fetches (or returns pinned) expected SHA-256 + size for this artifact. */
  getExpectedIntegrity: () => Promise<ModelConfig>;
}

export interface ModelDownloadManagerDeps {
  fetcher: ResourceFetcherLike;
  verifyIntegrity: (fileUri: string, expectedSha256: string) => Promise<boolean>;
  /** Bytes on disk for a given path (injected so this module stays native-free). */
  getFileSize: (fileUri: string) => Promise<number>;
  /** All download sources for the bundle, in order (verified artifacts + auxiliary files). */
  sources: ResourceSource[];
  /**
   * The independently-verified artifacts in this bundle. When omitted, a single
   * artifact is derived from `expectedModelFilename` + `getModelConfig` (the
   * legacy LFM/ExecuTorch wiring).
   */
  artifacts?: VerifiedArtifact[];
  /** Legacy single-artifact expected hash/size fetcher. Ignored when `artifacts` is set. */
  getModelConfig?: () => Promise<ModelConfig>;
  /** Legacy single-artifact filename. Ignored when `artifacts` is set. */
  expectedModelFilename?: string;
}

interface ArtifactProgress {
  downloaded: boolean;
  verified: boolean;
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
  private readonly artifacts: VerifiedArtifact[];
  private readonly artifactProgress = new Map<string, ArtifactProgress>();
  private readonly expectedCache = new Map<string, ModelConfig>();
  private activeDownloadPromise: Promise<void> | null = null;
  private downloadRunId = 0;

  constructor(private readonly deps: ModelDownloadManagerDeps) {
    this.artifacts = normalizeArtifacts(deps);
    for (const artifact of this.artifacts) {
      this.artifactProgress.set(artifact.artifactId, { downloaded: false, verified: false });
    }
  }

  getState(): ModelState {
    return this.state;
  }

  /** Internal per-artifact readiness for the bundle wiring (not product-facing). */
  getArtifactStates(): ArtifactReadiness[] {
    return this.artifacts.map((artifact) => {
      const progress = this.artifactProgress.get(artifact.artifactId);
      return {
        artifactId: artifact.artifactId,
        downloaded: progress?.downloaded ?? false,
        integrityVerified: progress?.verified ?? false,
      };
    });
  }

  subscribe(listener: (state: ModelState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isReadyForInference(): boolean {
    return this.artifacts.every(
      (artifact) => this.artifactProgress.get(artifact.artifactId)?.verified === true
    );
  }

  startDownload(): Promise<void> {
    if (this.activeDownloadPromise !== null) {
      return this.activeDownloadPromise;
    }
    if (this.isReadyForInference()) {
      return Promise.resolve();
    }

    const runId = this.nextDownloadRun();
    const promise = this.runDownload(runId).finally(() => {
      if (this.activeDownloadPromise === promise) {
        this.activeDownloadPromise = null;
      }
    });
    this.activeDownloadPromise = promise;
    return promise;
  }

  private async runDownload(runId: number): Promise<void> {
    this.resetArtifactProgress();
    this.setState({
      downloadStatus: 'downloading',
      downloadProgress: 0,
      integrityVerified: false,
      error: null,
    });
    try {
      const downloadPromise = this.deps.fetcher.fetch(
        (progress) => {
          if (this.isCurrentRun(runId)) {
            this.setState({ downloadProgress: progress });
          }
        },
        ...this.deps.sources
      );
      await this.finishDownload(downloadPromise, runId);
    } catch (error) {
      if (!this.isCurrentRun(runId)) {
        return;
      }
      await this.safeDelete();
      this.setState({
        downloadStatus: 'failed',
        integrityVerified: false,
        error: toMessage(error),
      });
    }
  }

  async reattachExistingDownload(): Promise<boolean> {
    if (this.activeDownloadPromise !== null) {
      return true;
    }
    if (!this.deps.fetcher.reattachExistingDownloads) {
      return false;
    }

    const runId = this.nextDownloadRun();
    try {
      const reattached = await this.deps.fetcher.reattachExistingDownloads(
        (progress) => {
          if (this.isCurrentRun(runId)) {
            this.setState({ downloadProgress: progress });
          }
        },
        ...this.deps.sources
      );
      if (!reattached) {
        return false;
      }

      this.resetArtifactProgress();
      this.setState({
        downloadStatus: reattached.status,
        downloadProgress: reattached.progress,
        integrityVerified: false,
        error: null,
      });
      const promise = this.finishReattachedDownload(reattached.promise, runId).finally(() => {
        if (this.activeDownloadPromise === promise) {
          this.activeDownloadPromise = null;
        }
      });
      this.activeDownloadPromise = promise;
      void promise;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Launch-time reconciliation against the real filesystem. Each artifact left on
   * disk was only ever kept AFTER passing its SHA-256 check at download time
   * (startDownload deletes anything that fails), so presence + a cheap size check
   * is a trustworthy cached result: present & big enough ⇒ ready, otherwise not
   * ready. This deliberately does NOT re-hash multi-GB files on every cold start
   * (Principle IV). Every manifest artifact must reconcile as ready for the
   * bundle to be ready. Never downloads; never throws.
   */
  async reconcile(): Promise<void> {
    try {
      const files = await this.deps.fetcher.listDownloadedModels();
      for (const artifact of this.artifacts) {
        const path = files.find((file) => getFilename(file) === artifact.fileName);
        if (path === undefined) {
          await this.markNotReady();
          return;
        }
        const expected = await this.resolveExpected(artifact);
        const size = await this.deps.getFileSize(path);
        if (size < expected.expectedSize) {
          await this.safeDelete();
          await this.markNotReady();
          return;
        }
        this.artifactProgress.set(artifact.artifactId, { downloaded: true, verified: true });
      }
      this.setState({
        downloadStatus: 'downloaded',
        downloadProgress: 1,
        integrityVerified: true,
        error: null,
      });
    } catch {
      await this.markNotReady();
    }
  }

  async pauseDownload(): Promise<void> {
    if (this.state.downloadStatus !== 'downloading') {
      try {
        await this.deps.fetcher.pauseFetching(...this.deps.sources);
      } catch {
        // Nothing active to pause.
      }
      return;
    }

    this.setState({ downloadStatus: 'paused' });
    try {
      await this.deps.fetcher.pauseFetching(...this.deps.sources);
    } catch {
      this.setState({ downloadStatus: 'downloading' });
    }
  }

  async resumeDownload(): Promise<void> {
    if (this.state.downloadStatus !== 'paused') {
      try {
        await this.deps.fetcher.resumeFetching(...this.deps.sources);
      } catch {
        // Nothing paused to resume.
      }
      return;
    }

    this.setState({ downloadStatus: 'downloading' });
    try {
      await this.deps.fetcher.resumeFetching(...this.deps.sources);
    } catch {
      this.setState({ downloadStatus: 'paused' });
    }
  }

  async cancelDownload(): Promise<void> {
    const cancelledPromise = this.activeDownloadPromise;
    this.downloadRunId += 1;
    try {
      await this.deps.fetcher.cancelFetching(...this.deps.sources);
    } catch {
      // Nothing active to cancel.
    }
    await this.safeDelete();
    if (this.activeDownloadPromise === cancelledPromise) {
      this.activeDownloadPromise = null;
    }
    this.resetArtifactProgress();
    this.setState({ ...INITIAL_STATE });
  }

  private async safeDelete(): Promise<void> {
    try {
      await this.deps.fetcher.deleteResources(...this.deps.sources);
    } catch {
      // Best-effort cleanup; a delete failure must not mask the real outcome.
    }
  }

  private async finishReattachedDownload(
    downloadPromise: Promise<{ paths: string[]; wasDownloaded: boolean[] }>,
    runId: number
  ): Promise<void> {
    try {
      await this.finishDownload(downloadPromise, runId);
    } catch (error) {
      if (!this.isCurrentRun(runId)) {
        return;
      }
      try {
        await this.deps.fetcher.cancelFetching(...this.deps.sources);
      } catch {
        // Nothing active to cancel.
      }
      await this.safeDelete();
      this.setState({
        downloadStatus: 'failed',
        integrityVerified: false,
        error: toMessage(error),
      });
    }
  }

  private async finishDownload(
    downloadPromise: Promise<{ paths: string[]; wasDownloaded: boolean[] }>,
    runId: number
  ): Promise<void> {
    const { paths } = await downloadPromise;
    if (!this.isCurrentRun(runId)) {
      return;
    }

    // Verify each artifact independently — a match on one artifact never implies
    // verification of another.
    for (const artifact of this.artifacts) {
      const expected = await this.resolveExpected(artifact);
      if (!this.isCurrentRun(runId)) {
        return;
      }
      const path = paths.find((candidate) => getFilename(candidate) === artifact.fileName);
      const verified =
        path !== undefined && (await this.deps.verifyIntegrity(path, expected.expectedSha256));
      if (!this.isCurrentRun(runId)) {
        return;
      }
      if (!verified) {
        this.artifactProgress.set(artifact.artifactId, { downloaded: true, verified: false });
        // Corrupt/missing bytes: clear the partial files BEFORE reporting 'failed'
        // so the next startDownload() is always a clean re-download.
        await this.safeDelete();
        this.setState({
          downloadStatus: 'failed',
          integrityVerified: false,
          error: 'The downloaded model failed its integrity check.',
        });
        return;
      }
      this.artifactProgress.set(artifact.artifactId, { downloaded: true, verified: true });
    }

    this.setState({
      downloadStatus: 'downloaded',
      downloadProgress: 1,
      integrityVerified: true,
      error: null,
    });
  }

  private async resolveExpected(artifact: VerifiedArtifact): Promise<ModelConfig> {
    const cached = this.expectedCache.get(artifact.artifactId);
    if (cached !== undefined) {
      return cached;
    }
    const expected = await artifact.getExpectedIntegrity();
    this.expectedCache.set(artifact.artifactId, expected);
    return expected;
  }

  private resetArtifactProgress(): void {
    for (const artifact of this.artifacts) {
      this.artifactProgress.set(artifact.artifactId, { downloaded: false, verified: false });
    }
  }

  private async markNotReady(): Promise<void> {
    this.resetArtifactProgress();
    this.setState({ ...INITIAL_STATE });
  }

  private setState(patch: Partial<ModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private nextDownloadRun(): number {
    this.downloadRunId += 1;
    return this.downloadRunId;
  }

  private isCurrentRun(runId: number): boolean {
    return runId === this.downloadRunId;
  }
}

function normalizeArtifacts(deps: ModelDownloadManagerDeps): VerifiedArtifact[] {
  if (deps.artifacts !== undefined && deps.artifacts.length > 0) {
    return deps.artifacts;
  }
  if (deps.expectedModelFilename !== undefined && deps.getModelConfig !== undefined) {
    const getModelConfig = deps.getModelConfig;
    return [
      {
        artifactId: deps.expectedModelFilename,
        fileName: deps.expectedModelFilename,
        getExpectedIntegrity: getModelConfig,
      },
    ];
  }
  throw new Error(
    'ModelDownloadManager requires either `artifacts` or `expectedModelFilename` + `getModelConfig`.'
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Model download failed.';
}

function getFilename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? '';
}
