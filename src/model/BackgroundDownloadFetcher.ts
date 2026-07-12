import type {
  ReattachedDownload,
  ReattachedDownloadStatus,
  ResourceFetcherLike,
  ResourceSource,
} from './ModelDownloadManager';

// A `ResourceFetcherLike` (the interface ModelDownloadManager consumes) backed by
// a true Android background download (@kesha-antonov/react-native-background-downloader:
// DownloadManager + foreground service + Android 14/16 UIDT jobs + notification).
// It writes each artifact to the EXACT on-disk path the runtime expects (the
// destination resolver is INJECTED), so the runtime finds files already present
// and never re-downloads them (FR-025). Constitution Principle X: self-contained
// model-lifecycle module — no imports from inference/ or screens/. All native
// touchpoints (the kesha task factory, filesystem, destination resolver, and the
// "is this a model artifact" filter) are INJECTED so this module and its unit
// tests never load a native package at import time.
//
// Runtime-neutral (Spec 005): the download directory is supplied by the injected
// resolvers and the model-file filter is injectable, so the fetcher serves the
// Qwen `.gguf` bundle (language model + projector) without hardcoding any
// runtime-specific directory or file extension.

/**
 * The subset of a kesha `DownloadTask` this fetcher drives. Handlers are attached
 * first and {@link start} is called last, so no early begin/progress/done/error
 * event is missed (kesha's `createDownloadTask` returns a PENDING task — it does
 * NOT auto-start).
 */
export interface BgDownloadTask {
  readonly id: string;
  readonly state?: 'PENDING' | 'DOWNLOADING' | 'PAUSED' | 'DONE' | 'FAILED' | 'STOPPED';
  readonly bytesDownloaded?: number;
  readonly bytesTotal?: number;
  readonly destination?: string;
  progress(handler: (params: { bytesDownloaded: number; bytesTotal: number }) => void): BgDownloadTask;
  done(handler: () => void): BgDownloadTask;
  error(handler: (error: unknown) => void): BgDownloadTask;
  start(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
}

export interface BackgroundDownloadFetcherDeps {
  /** kesha `createDownloadTask({ id, url, destination })`. */
  createDownloadTask: (config: { id: string; url: string; destination: string }) => BgDownloadTask;
  /** Absolute on-disk path the runtime expects for a URL (download dir + filename, no file://). */
  destinationForUrl: (url: string) => string;
  fileExists: (absolutePath: string) => boolean;
  deleteFileIfExists: (absolutePath: string) => Promise<void>;
  /** Absolute paths of every file already in the model download directory. */
  listDownloadedFiles: () => Promise<string[]>;
  /** Ensure the model download directory exists before writing into it. */
  ensureDownloadDir: () => Promise<void>;
  /** Native background tasks that survived an app/process restart. */
  getExistingDownloadTasks: () => Promise<BgDownloadTask[]>;
  /**
   * Predicate identifying downloaded model-artifact files among all files in the
   * download directory. Defaults to `.gguf`; the Qwen composition root injects a
   * `.gguf`/manifest-filename predicate for the bundle.
   */
  isModelArtifactFile?: (absolutePath: string) => boolean;
}

interface ActiveDownload {
  task: BgDownloadTask;
  /** Settles the in-flight fetchOne promise when the download is cancelled. */
  reject: (error: unknown) => void;
}

export class BackgroundDownloadFetcher implements ResourceFetcherLike {
  // Active downloads keyed by the source URL, so pause/resume/cancel can find them.
  private readonly active = new Map<string, ActiveDownload>();

  constructor(private readonly deps: BackgroundDownloadFetcherDeps) {}

  async fetch(
    callback?: (progress: number) => void,
    ...sources: ResourceSource[]
  ): Promise<{ paths: string[]; wasDownloaded: boolean[] }> {
    const urls = sources.filter(isUrl);
    await this.deps.ensureDownloadDir();

    // Unified 0..1 progress across all in-flight files, dominated by the
    // ~1.1 GB language GGUF, so the aggregate bundle progress advances smoothly.
    const bytes = new Map<string, { downloaded: number; total: number }>();
    const emit = (): void => {
      if (!callback) return;
      let downloaded = 0;
      let total = 0;
      for (const entry of bytes.values()) {
        downloaded += entry.downloaded;
        total += entry.total;
      }
      callback(total > 0 ? downloaded / total : 0);
    };

    const results = await Promise.all(urls.map((url) => this.fetchOne(url, bytes, emit)));
    return {
      paths: results.map((r) => r.path),
      wasDownloaded: results.map((r) => r.wasDownloaded),
    };
  }

  async reattachExistingDownloads(
    callback?: (progress: number) => void,
    ...sources: ResourceSource[]
  ): Promise<ReattachedDownload | null> {
    const urls = sources.filter(isUrl);
    if (urls.length === 0) {
      return null;
    }

    await this.deps.ensureDownloadDir();
    const existingTasks = await this.deps.getExistingDownloadTasks();
    const bytes = new Map<string, { downloaded: number; total: number }>();
    const emit = (): void => {
      if (!callback) return;
      callback(progressFor(bytes));
    };

    const promises: Array<Promise<{ path: string; wasDownloaded: boolean }>> = [];
    const statuses: ReattachedDownloadStatus[] = [];
    const missingDestinations: string[] = [];
    let attachedCount = 0;

    for (const url of urls) {
      const destination = this.deps.destinationForUrl(url);
      if (this.deps.fileExists(destination)) {
        promises.push(Promise.resolve({ path: destination, wasDownloaded: false }));
        continue;
      }

      const task = findTaskForDestination(existingTasks, destination);
      if (!task) {
        missingDestinations.push(destination);
        continue;
      }

      attachedCount += 1;
      seedProgress(bytes, url, task);
      statuses.push(task.state === 'PAUSED' ? 'paused' : 'downloading');
      promises.push(this.reattachOne(url, destination, task, bytes, emit));
    }

    if (attachedCount === 0) {
      return null;
    }
    for (const destination of missingDestinations) {
      promises.push(Promise.reject(new Error(`No existing download task for ${filenameOf(destination)}.`)));
    }

    emit();
    return {
      status: statuses.every((status) => status === 'paused') ? 'paused' : 'downloading',
      progress: progressFor(bytes),
      promise: Promise.all(promises).then((results) => ({
        paths: results.map((r) => r.path),
        wasDownloaded: results.map((r) => r.wasDownloaded),
      })),
    };
  }

  private fetchOne(
    url: string,
    bytes: Map<string, { downloaded: number; total: number }>,
    emit: () => void,
  ): Promise<{ path: string; wasDownloaded: boolean }> {
    const destination = this.deps.destinationForUrl(url);
    if (this.deps.fileExists(destination)) {
      // Already downloaded and left on disk (i.e. previously verified) — reuse it.
      return Promise.resolve({ path: destination, wasDownloaded: false });
    }
    return new Promise((resolve, reject) => {
      const task = this.deps.createDownloadTask({ id: filenameOf(destination), url, destination });
      this.active.set(url, { task, reject });
      task
        .progress(({ bytesDownloaded, bytesTotal }) => {
          bytes.set(url, { downloaded: bytesDownloaded, total: bytesTotal });
          emit();
        })
        .done(() => {
          this.active.delete(url);
          resolve({ path: destination, wasDownloaded: true });
        })
        .error((error) => {
          this.active.delete(url);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      // Handlers attached — now kick off the transfer (kesha requires an explicit start).
      task.start();
    });
  }

  private reattachOne(
    url: string,
    destination: string,
    task: BgDownloadTask,
    bytes: Map<string, { downloaded: number; total: number }>,
    emit: () => void
  ): Promise<{ path: string; wasDownloaded: boolean }> {
    if (task.state === 'DONE') {
      return Promise.resolve({ path: destination, wasDownloaded: true });
    }
    if (task.state === 'FAILED' || task.state === 'STOPPED') {
      return Promise.reject(new Error(`Existing download task ${task.id} is ${task.state}.`));
    }

    return new Promise((resolve, reject) => {
      this.active.set(url, { task, reject });
      task
        .progress(({ bytesDownloaded, bytesTotal }) => {
          bytes.set(url, { downloaded: bytesDownloaded, total: bytesTotal });
          emit();
        })
        .done(() => {
          this.active.delete(url);
          resolve({ path: destination, wasDownloaded: true });
        })
        .error((error) => {
          this.active.delete(url);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  async pauseFetching(...sources: ResourceSource[]): Promise<void> {
    await this.forEachActive(sources, (task) => task.pause());
  }

  async resumeFetching(...sources: ResourceSource[]): Promise<void> {
    await this.forEachActive(sources, (task) => task.resume());
  }

  async cancelFetching(...sources: ResourceSource[]): Promise<void> {
    for (const url of sources.filter(isUrl)) {
      const entry = this.active.get(url);
      if (entry) {
        this.active.delete(url);
        await safe(() => entry.task.stop());
        // Settle the in-flight fetch so it doesn't hang (fetcher contract:
        // a cancelled download rejects the fetch with an interruption).
        entry.reject(new Error('Download cancelled.'));
      }
      // Clear any partial bytes so a retry is a clean download.
      await safe(() => this.deps.deleteFileIfExists(this.deps.destinationForUrl(url)));
    }
  }

  async deleteResources(...sources: ResourceSource[]): Promise<void> {
    for (const url of sources.filter(isUrl)) {
      await safe(() => this.deps.deleteFileIfExists(this.deps.destinationForUrl(url)));
    }
  }

  async listDownloadedModels(): Promise<string[]> {
    const files = await this.deps.listDownloadedFiles();
    const isModelArtifact = this.deps.isModelArtifactFile ?? isGgufFile;
    return files.filter(isModelArtifact);
  }

  private async forEachActive(
    sources: ResourceSource[],
    action: (task: BgDownloadTask) => Promise<void>,
  ): Promise<void> {
    for (const url of sources.filter(isUrl)) {
      const entry = this.active.get(url);
      if (entry) {
        // Absorb the fetcher's already-paused/already-ongoing throws into a safe
        // no-op (model-lifecycle.contract.md pause/resume preconditions).
        await safe(() => action(entry.task));
      }
    }
  }
}

function isUrl(source: ResourceSource): source is string {
  return typeof source === 'string';
}

function isGgufFile(absolutePath: string): boolean {
  return absolutePath.endsWith('.gguf');
}

function filenameOf(absolutePath: string): string {
  const parts = absolutePath.split('/');
  return parts[parts.length - 1] || absolutePath;
}

function findTaskForDestination(tasks: BgDownloadTask[], destination: string): BgDownloadTask | undefined {
  const destinationId = filenameOf(destination);
  return tasks.find((task) => task.id === destinationId || task.destination === destination);
}

function seedProgress(
  bytes: Map<string, { downloaded: number; total: number }>,
  url: string,
  task: BgDownloadTask
): void {
  if (typeof task.bytesDownloaded === 'number' && typeof task.bytesTotal === 'number') {
    bytes.set(url, { downloaded: task.bytesDownloaded, total: task.bytesTotal });
  }
}

function progressFor(bytes: Map<string, { downloaded: number; total: number }>): number {
  let downloaded = 0;
  let total = 0;
  for (const entry of bytes.values()) {
    downloaded += entry.downloaded;
    total += entry.total;
  }
  return total > 0 ? downloaded / total : 0;
}

async function safe(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Best-effort — pause/resume/cancel/delete must never throw to the caller.
  }
}
