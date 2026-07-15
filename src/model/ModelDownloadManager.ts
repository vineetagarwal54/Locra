import type { ModelState } from '../types/models';

import type { ArtifactReadiness } from './ModelArtifactManifest';
import {
  createManifestFingerprint,
  isRecordCurrent,
  MODEL_VERIFICATION_SCHEMA_VERSION,
  parseVerificationRecord,
  type ModelVerificationRecord,
  type ResolvedArtifactManifest,
} from './ModelVerificationRecord';

export interface ArtifactIntegrity {
  expectedSha256: string;
  expectedSize: number;
}

export type ResourceSource = string | number | object;
export type ReattachedDownloadStatus = 'downloading' | 'paused';

export interface ReattachedDownload {
  status: ReattachedDownloadStatus;
  progress: number;
  promise: Promise<{ paths: string[]; wasDownloaded: boolean[] }>;
}

export interface ResourceFetcherLike {
  fetch(callback?: (progress: number) => void, ...sources: ResourceSource[]): Promise<{
    paths: string[];
    wasDownloaded: boolean[];
  }>;
  reattachExistingDownloads?(
    callback?: (progress: number) => void,
    ...sources: ResourceSource[]
  ): Promise<ReattachedDownload | null>;
  pauseFetching(...sources: ResourceSource[]): Promise<void>;
  resumeFetching(...sources: ResourceSource[]): Promise<void>;
  cancelFetching(...sources: ResourceSource[]): Promise<void>;
  deleteResources(...sources: ResourceSource[]): Promise<void>;
  listDownloadedModels(): Promise<string[]>;
}

export interface VerifiedArtifact {
  readonly artifactId: string;
  readonly fileName: string;
  getExpectedIntegrity: () => Promise<ArtifactIntegrity>;
}

export interface ModelDownloadManagerDeps {
  fetcher: ResourceFetcherLike;
  verifyIntegrity: (
    fileUri: string,
    expectedSha256: string,
    onProgress?: (progress: { bytesRead: number; totalBytes: number; progress: number }) => void,
  ) => Promise<boolean>;
  getFileSize: (fileUri: string) => Promise<number>;
  sources: ResourceSource[];
  artifacts: VerifiedArtifact[];
  modelId?: string;
  verificationRecord?: {
    read: () => Promise<string | null>;
    write: (value: string) => Promise<void>;
    clear: () => Promise<void>;
  };
  now?: () => number;
}

interface ArtifactProgress {
  downloaded: boolean;
  verified: boolean;
}

const INITIAL_STATE: ModelState = {
  setupPhase: 'not_installed',
  downloadStatus: 'not_started',
  downloadProgress: 0,
  verificationProgress: 0,
  verificationArtifactProgress: 0,
  verificationArtifactName: null,
  canRetryVerification: false,
  integrityVerified: false,
  error: null,
};

interface PendingVerification {
  resolved: ReadonlyArray<ResolvedArtifactManifest>;
  paths: ReadonlyMap<string, string>;
  sizes: ReadonlyMap<string, number>;
  fingerprint: string;
}

export class ModelDownloadManager {
  private state: ModelState = { ...INITIAL_STATE };
  private readonly listeners = new Set<(state: ModelState) => void>();
  private readonly artifactProgress = new Map<string, ArtifactProgress>();
  private readonly expectedCache = new Map<string, ArtifactIntegrity>();
  private activeDownloadPromise: Promise<void> | null = null;
  private activeVerification: { runId: number; promise: Promise<void> } | null = null;
  private pendingVerification: PendingVerification | null = null;
  private runId = 0;

  constructor(private readonly deps: ModelDownloadManagerDeps) {
    if (deps.artifacts.length === 0) throw new Error('ModelDownloadManager requires at least one artifact.');
    this.resetArtifactProgress();
  }

  getState(): ModelState {
    return this.state;
  }

  getArtifactStates(): ArtifactReadiness[] {
    return this.deps.artifacts.map((artifact) => {
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
    return () => this.listeners.delete(listener);
  }

  isReadyForInference(): boolean {
    return this.state.setupPhase === 'ready' &&
      this.state.integrityVerified &&
      this.deps.artifacts.every((artifact) => this.artifactProgress.get(artifact.artifactId)?.verified === true);
  }

  startDownload(): Promise<void> {
    if (this.activeDownloadPromise !== null) return this.activeDownloadPromise;
    if (this.isReadyForInference()) return Promise.resolve();
    const currentRun = this.nextRun();
    const promise = this.runDownload(currentRun).finally(() => {
      if (this.activeDownloadPromise === promise) this.activeDownloadPromise = null;
    });
    this.activeDownloadPromise = promise;
    return promise;
  }

  private async runDownload(currentRun: number): Promise<void> {
    this.resetArtifactProgress();
    this.setState({
      setupPhase: 'preparing',
      downloadStatus: 'downloading',
      downloadProgress: 0,
      verificationProgress: 0,
      verificationArtifactProgress: 0,
      verificationArtifactName: null,
      canRetryVerification: false,
      integrityVerified: false,
      error: null,
    });
    try {
      this.setState({ setupPhase: 'downloading' });
      const pending = this.deps.fetcher.fetch((progress) => {
        if (this.isCurrent(currentRun)) this.setState({ downloadProgress: progress });
      }, ...this.deps.sources);
      await this.finishDownload(pending, currentRun);
    } catch (error) {
      if (!this.isCurrent(currentRun)) return;
      await this.safeDelete();
      await this.clearVerificationRecord();
      this.fail(toDownloadMessage(error));
    }
  }

  async reattachExistingDownload(): Promise<boolean> {
    if (this.activeDownloadPromise !== null) return true;
    if (!this.deps.fetcher.reattachExistingDownloads) return false;
    const currentRun = this.nextRun();
    try {
      const reattached = await this.deps.fetcher.reattachExistingDownloads((progress) => {
        if (this.isCurrent(currentRun)) this.setState({ downloadProgress: progress });
      }, ...this.deps.sources);
      if (!this.isCurrent(currentRun)) return false;
      if (!reattached) return false;
      this.resetArtifactProgress();
      this.setState({
        setupPhase: reattached.status === 'paused' ? 'paused' : 'downloading',
        downloadStatus: reattached.status,
        downloadProgress: reattached.progress,
        integrityVerified: false,
        error: null,
      });
      const promise = this.finishReattachedDownload(reattached.promise, currentRun).finally(() => {
        if (this.activeDownloadPromise === promise) this.activeDownloadPromise = null;
      });
      this.activeDownloadPromise = promise;
      void promise;
      return true;
    } catch {
      return false;
    }
  }

  async reconcile(): Promise<void> {
    const currentRun = this.nextRun();
    this.setState({ setupPhase: 'checking', integrityVerified: false, error: null });
    try {
      const files = await this.deps.fetcher.listDownloadedModels();
      if (!this.isCurrent(currentRun)) return;
      const resolved = await this.resolveManifest();
      if (!this.isCurrent(currentRun)) return;
      const paths = new Map<string, string>();
      for (const { artifact } of resolved) {
        const path = files.find((file) => getFilename(file) === artifact.fileName);
        if (path === undefined) {
          await this.clearVerificationRecord();
          if (this.isCurrent(currentRun)) this.markNotInstalled();
          return;
        }
        paths.set(artifact.artifactId, path);
      }

      const sizes = new Map<string, number>();
      for (const { artifact, integrity } of resolved) {
        const size = await this.deps.getFileSize(paths.get(artifact.artifactId) as string);
        if (!this.isCurrent(currentRun)) return;
        if (size !== integrity.expectedSize) {
          await this.safeDelete();
          await this.clearVerificationRecord();
          if (this.isCurrent(currentRun)) this.fail('Model files changed and need to be downloaded again.');
          return;
        }
        sizes.set(artifact.artifactId, size);
      }

      const fingerprint = createManifestFingerprint(this.modelId(), resolved);
      const rawRecord = await this.deps.verificationRecord?.read() ?? null;
      const record = parseVerificationRecord(rawRecord);
      const recordCurrent = record !== null && isRecordCurrent(record, this.modelId(), fingerprint, resolved);
      if (rawRecord !== null && !recordCurrent) await this.clearVerificationRecord();
      if (!this.isCurrent(currentRun)) return;
      if (recordCurrent) {
        this.pendingVerification = null;
        this.markAllArtifactsReady();
        this.publishReady();
        return;
      }

      this.prepareVerification(resolved, paths, sizes, fingerprint);
      // Fast bootstrap stops here. DownloadProgress starts native hashing after
      // navigation is mounted, so Splash never waits for a full-file digest.
    } catch {
      if (!this.isCurrent(currentRun)) return;
      await this.clearVerificationRecord();
      this.fail('Model setup could not be checked. Retry the check or redownload the model.');
    }
  }

  failActiveCheck(message: string): void {
    this.runId += 1;
    this.pendingVerification = null;
    this.resetArtifactProgress();
    this.fail(message);
  }

  verifyPendingArtifacts(): Promise<void> {
    if (this.pendingVerification === null) return Promise.resolve();
    if (this.activeVerification?.runId === this.runId) return this.activeVerification.promise;
    const currentRun = this.nextRun();
    this.markAllArtifactsDownloaded();
    this.setState({
      setupPhase: 'verifying',
      downloadStatus: 'downloaded',
      verificationProgress: 0,
      verificationArtifactProgress: 0,
      verificationArtifactName: null,
      canRetryVerification: false,
      integrityVerified: false,
      error: null,
    });
    return this.runPendingVerification(this.pendingVerification, currentRun);
  }

  async pauseDownload(): Promise<void> {
    if (this.state.downloadStatus !== 'downloading') {
      try { await this.deps.fetcher.pauseFetching(...this.deps.sources); } catch { /* no active task */ }
      return;
    }
    this.setState({ setupPhase: 'paused', downloadStatus: 'paused' });
    try {
      await this.deps.fetcher.pauseFetching(...this.deps.sources);
    } catch {
      this.setState({ setupPhase: 'downloading', downloadStatus: 'downloading' });
    }
  }

  async resumeDownload(): Promise<void> {
    if (this.state.downloadStatus !== 'paused') {
      try { await this.deps.fetcher.resumeFetching(...this.deps.sources); } catch { /* no paused task */ }
      return;
    }
    this.setState({ setupPhase: 'downloading', downloadStatus: 'downloading' });
    try {
      await this.deps.fetcher.resumeFetching(...this.deps.sources);
    } catch {
      this.setState({ setupPhase: 'paused', downloadStatus: 'paused' });
    }
  }

  async cancelDownload(): Promise<void> {
    const cancelled = this.activeDownloadPromise;
    this.runId += 1;
    try { await this.deps.fetcher.cancelFetching(...this.deps.sources); } catch { /* no active task */ }
    await this.safeDelete();
    await this.clearVerificationRecord();
    if (this.activeDownloadPromise === cancelled) this.activeDownloadPromise = null;
    this.pendingVerification = null;
    this.activeVerification = null;
    this.resetArtifactProgress();
    this.setState({ ...INITIAL_STATE });
  }

  private async finishReattachedDownload(
    pending: Promise<{ paths: string[]; wasDownloaded: boolean[] }>,
    currentRun: number,
  ): Promise<void> {
    try {
      await this.finishDownload(pending, currentRun);
    } catch (error) {
      if (!this.isCurrent(currentRun)) return;
      try { await this.deps.fetcher.cancelFetching(...this.deps.sources); } catch { /* already complete */ }
      await this.safeDelete();
      await this.clearVerificationRecord();
      this.fail(toDownloadMessage(error));
    }
  }

  private async finishDownload(
    pending: Promise<{ paths: string[]; wasDownloaded: boolean[] }>,
    currentRun: number,
  ): Promise<void> {
    const { paths } = await pending;
    if (!this.isCurrent(currentRun)) return;
    this.setState({ setupPhase: 'verifying', downloadProgress: 1 });
    const resolved = await this.resolveManifest();
    const artifactPaths = new Map<string, string>();
    const sizes = new Map<string, number>();
    for (const { artifact, integrity } of resolved) {
      const path = paths.find((candidate) => getFilename(candidate) === artifact.fileName);
      if (path === undefined) return this.handleInvalidArtifacts(currentRun);
      const size = await this.deps.getFileSize(path);
      if (!this.isCurrent(currentRun)) return;
      if (size !== integrity.expectedSize) return this.handleInvalidArtifacts(currentRun);
      artifactPaths.set(artifact.artifactId, path);
      sizes.set(artifact.artifactId, size);
    }
    const fingerprint = createManifestFingerprint(this.modelId(), resolved);
    const verification = this.prepareVerification(resolved, artifactPaths, sizes, fingerprint);
    await this.runPendingVerification(verification, currentRun);
  }

  private prepareVerification(
    resolved: ReadonlyArray<ResolvedArtifactManifest>,
    paths: ReadonlyMap<string, string>,
    sizes: ReadonlyMap<string, number>,
    fingerprint: string,
  ): PendingVerification {
    const pending = { resolved, paths, sizes, fingerprint };
    this.pendingVerification = pending;
    this.markAllArtifactsDownloaded();
    this.setState({
      setupPhase: 'verifying',
      downloadStatus: 'downloaded',
      downloadProgress: 1,
      verificationProgress: 0,
      verificationArtifactProgress: 0,
      verificationArtifactName: null,
      canRetryVerification: false,
      integrityVerified: false,
      error: null,
    });
    return pending;
  }

  private runPendingVerification(pending: PendingVerification, currentRun: number): Promise<void> {
    const promise = this.completePendingVerification(pending, currentRun).finally(() => {
      if (this.activeVerification?.promise === promise) this.activeVerification = null;
    });
    this.activeVerification = { runId: currentRun, promise };
    return promise;
  }

  private async completePendingVerification(
    pending: PendingVerification,
    currentRun: number,
  ): Promise<void> {
    if (!await this.verifyArtifacts(pending.resolved, pending.paths, currentRun)) return;
    if (!this.isCurrent(currentRun)) return;
    await this.writeVerificationRecord(pending.resolved, pending.fingerprint, pending.sizes);
    if (!this.isCurrent(currentRun)) return;
    this.pendingVerification = null;
    this.publishReady();
  }

  private async verifyArtifacts(
    resolved: ReadonlyArray<ResolvedArtifactManifest>,
    paths: ReadonlyMap<string, string>,
    currentRun: number,
  ): Promise<boolean> {
    const totalBytes = resolved.reduce((sum, entry) => sum + entry.integrity.expectedSize, 0);
    let completedBytes = 0;
    for (const { artifact, integrity } of resolved) {
      const path = paths.get(artifact.artifactId);
      if (!this.isCurrent(currentRun)) return false;
      this.setState({
        verificationArtifactName: artifact.fileName,
        verificationArtifactProgress: 0,
        verificationProgress: completedBytes / totalBytes,
      });
      const verified = path !== undefined && await this.deps.verifyIntegrity(
        path,
        integrity.expectedSha256,
        (progress) => {
          if (!this.isCurrent(currentRun)) return;
          const artifactBytes = Math.min(integrity.expectedSize, Math.max(0, progress.bytesRead));
          this.setState({
            verificationArtifactProgress: clampProgress(progress.progress),
            verificationProgress: clampProgress((completedBytes + artifactBytes) / totalBytes),
          });
        },
      );
      if (!this.isCurrent(currentRun)) return false;
      if (!verified) {
        await this.handleVerificationFailure(currentRun);
        return false;
      }
      completedBytes += integrity.expectedSize;
      this.artifactProgress.set(artifact.artifactId, { downloaded: true, verified: true });
    }
    return true;
  }

  private async handleVerificationFailure(currentRun: number): Promise<void> {
    if (!this.isCurrent(currentRun)) return;
    await this.clearVerificationRecord();
    if (!this.isCurrent(currentRun)) return;
    this.setState({
      setupPhase: 'failed',
      downloadStatus: 'failed',
      integrityVerified: false,
      canRetryVerification: true,
      error: 'The model could not be verified. Retry the integrity check or redownload the model.',
    });
  }

  private async handleInvalidArtifacts(currentRun: number): Promise<void> {
    await this.safeDelete();
    await this.clearVerificationRecord();
    if (this.isCurrent(currentRun)) this.fail('Model files changed and need to be downloaded again.');
  }

  private fail(error: string): void {
    this.resetArtifactProgress();
    this.setState({
      setupPhase: 'failed',
      downloadStatus: 'failed',
      canRetryVerification: false,
      integrityVerified: false,
      error,
    });
  }

  private publishReady(): void {
    this.setState({
      setupPhase: 'ready',
      downloadStatus: 'downloaded',
      downloadProgress: 1,
      verificationProgress: 1,
      verificationArtifactProgress: 1,
      verificationArtifactName: null,
      canRetryVerification: false,
      integrityVerified: true,
      error: null,
    });
  }

  private markNotInstalled(): void {
    this.pendingVerification = null;
    this.resetArtifactProgress();
    this.setState({ ...INITIAL_STATE });
  }

  private markAllArtifactsReady(): void {
    for (const artifact of this.deps.artifacts) {
      this.artifactProgress.set(artifact.artifactId, { downloaded: true, verified: true });
    }
  }

  private markAllArtifactsDownloaded(): void {
    for (const artifact of this.deps.artifacts) {
      this.artifactProgress.set(artifact.artifactId, { downloaded: true, verified: false });
    }
  }

  private async resolveManifest(): Promise<ResolvedArtifactManifest[]> {
    return Promise.all(this.deps.artifacts.map(async (artifact) => ({
      artifact,
      integrity: await this.resolveExpected(artifact),
    })));
  }

  private async resolveExpected(artifact: VerifiedArtifact): Promise<ArtifactIntegrity> {
    const cached = this.expectedCache.get(artifact.artifactId);
    if (cached !== undefined) return cached;
    const expected = await artifact.getExpectedIntegrity();
    this.expectedCache.set(artifact.artifactId, expected);
    return expected;
  }

  private async writeVerificationRecord(
    resolved: ReadonlyArray<ResolvedArtifactManifest>,
    fingerprint: string,
    sizes: ReadonlyMap<string, number>,
  ): Promise<void> {
    if (!this.deps.verificationRecord) return;
    const record: ModelVerificationRecord = {
      schemaVersion: MODEL_VERIFICATION_SCHEMA_VERSION,
      modelId: this.modelId(),
      manifestFingerprint: fingerprint,
      verifiedAt: (this.deps.now ?? Date.now)(),
      artifacts: resolved.map(({ artifact, integrity }) => ({
        artifactId: artifact.artifactId,
        fileName: artifact.fileName,
        expectedSize: integrity.expectedSize,
        expectedSha256: integrity.expectedSha256,
        verifiedSize: sizes.get(artifact.artifactId) ?? integrity.expectedSize,
      })),
    };
    await this.deps.verificationRecord.write(JSON.stringify(record));
  }

  private async clearVerificationRecord(): Promise<void> {
    try { await this.deps.verificationRecord?.clear(); } catch { /* stale records are rejected */ }
  }

  private async safeDelete(): Promise<void> {
    try { await this.deps.fetcher.deleteResources(...this.deps.sources); } catch { /* best effort */ }
  }

  private resetArtifactProgress(): void {
    for (const artifact of this.deps.artifacts) {
      this.artifactProgress.set(artifact.artifactId, { downloaded: false, verified: false });
    }
  }

  private setState(patch: Partial<ModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private nextRun(): number {
    this.runId += 1;
    return this.runId;
  }

  private isCurrent(currentRun: number): boolean {
    return currentRun === this.runId;
  }

  private modelId(): string {
    return this.deps.modelId ?? 'model-bundle';
  }
}

function toDownloadMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? 'Model download failed. Check your connection and try again.'
    : 'Model download failed. Try again.';
}

function getFilename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? '';
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
