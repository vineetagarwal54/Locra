import { readFileSync } from 'fs';
import { join } from 'path';

import { ModelDownloadManager, type ReattachedDownload } from '../../../src/model/ModelDownloadManager';
import type { ModelDownloadStatus } from '../../../src/types/models';

// The manager wraps ExpoResourceFetcher (fetch / pause / resume / cancel /
// deleteResources) and runs a SHA-256 integrity check after each fetch. Both the
// fetcher and the integrity verifier are injected here as mocks — no real
// download or native crypto is exercised.

const SOURCES = ['https://example.test/model.pte', 'https://example.test/tokenizer.json'];
const EXPECTED_HASH = 'abc123def456';
const EXPECTED_SIZE = 2_427_656_704;
const LOCAL_MODEL_PATH = '/local/react-native-executorch/model.pte';
const OTHER_MODEL_PATH = '/local/react-native-executorch/other-model.pte';
const LOCAL_TOKENIZER_PATH = '/local/react-native-executorch/tokenizer.json';
const EXPECTED_MODEL_FILENAME = 'model.pte';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface FetchResult {
  paths: string[];
  wasDownloaded: boolean[];
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function successfulFetchResult(): FetchResult {
  return {
    paths: [LOCAL_MODEL_PATH, LOCAL_TOKENIZER_PATH],
    wasDownloaded: [true, true],
  };
}

function makeHarness() {
  const fetch = jest.fn(async () => successfulFetchResult());
  const pauseFetching = jest.fn(async () => {});
  const resumeFetching = jest.fn(async () => {});
  const cancelFetching = jest.fn(async () => {});
  const deleteResources = jest.fn(async () => {});
  const listDownloadedModels = jest.fn(async (): Promise<string[]> => []);
  const verifyIntegrity = jest.fn(async () => true);
  const getFileSize = jest.fn(async () => EXPECTED_SIZE);
  const getModelConfig = jest.fn(async () => ({
    expectedSha256: EXPECTED_HASH,
    expectedSize: EXPECTED_SIZE,
  }));

  const manager = new ModelDownloadManager({
    fetcher: {
      fetch,
      pauseFetching,
      resumeFetching,
      cancelFetching,
      deleteResources,
      listDownloadedModels,
    },
    verifyIntegrity,
    getFileSize,
    getModelConfig,
    sources: SOURCES,
    expectedModelFilename: EXPECTED_MODEL_FILENAME,
  });

  return {
    manager,
    fetch,
    pauseFetching,
    resumeFetching,
    cancelFetching,
    deleteResources,
    listDownloadedModels,
    verifyIntegrity,
    getFileSize,
    getModelConfig,
  };
}

describe('ModelDownloadManager', () => {
  it('wires the Qwen artifact bundle sources at the composition root', () => {
    const source = readFileSync(join(process.cwd(), 'src/store/modelStore.ts'), 'utf8');

    expect(source).toContain('QWEN3_VL_2B_INSTRUCT_BUNDLE');
    expect(source).toContain('artifact.sourceUri');
    // ExecuTorch model-constant wiring is fully removed.
    expect(source).not.toContain('modelConstant');
  });

  it('resolves to downloaded with a true integrity check on success', async () => {
    const { manager, verifyIntegrity, getModelConfig } = makeHarness();
    verifyIntegrity.mockResolvedValue(true);

    await manager.startDownload();

    expect(getModelConfig).toHaveBeenCalledTimes(1);
    expect(verifyIntegrity).toHaveBeenCalledWith(LOCAL_MODEL_PATH, EXPECTED_HASH);
    expect(manager.getState().downloadStatus).toBe('downloaded');
    expect(manager.getState().integrityVerified).toBe(true);
  });

  it('resolves to failed on a bad integrity hash', async () => {
    const { manager, verifyIntegrity } = makeHarness();
    verifyIntegrity.mockResolvedValue(false);

    await manager.startDownload();

    expect(manager.getState().downloadStatus).toBe('failed');
    expect(manager.getState().integrityVerified).toBe(false);
  });

  it('resolves to failed if the fetch itself throws', async () => {
    const { manager, fetch } = makeHarness();
    fetch.mockRejectedValue(new Error('Cannot allocate: download interrupted'));

    await expect(manager.startDownload()).resolves.toBeUndefined();
    expect(manager.getState().downloadStatus).toBe('failed');
  });

  it('deduplicates repeated startDownload calls while one transfer is active', async () => {
    const { manager, fetch, verifyIntegrity } = makeHarness();
    const fetchDeferred = defer<FetchResult>();
    fetch.mockReturnValue(fetchDeferred.promise);

    const firstStart = manager.startDownload();
    await flush();
    const secondStart = manager.startDownload();

    expect(secondStart).toBe(firstStart);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(manager.getState().downloadStatus).toBe('downloading');

    fetchDeferred.resolve(successfulFetchResult());
    await firstStart;

    expect(verifyIntegrity).toHaveBeenCalledTimes(1);
    expect(manager.getState().downloadStatus).toBe('downloaded');
  });

  it('keeps cancelled state from being overwritten by the rejected in-flight fetch', async () => {
    const { manager, fetch, cancelFetching } = makeHarness();
    const fetchDeferred = defer<FetchResult>();
    fetch.mockReturnValue(fetchDeferred.promise);

    const startPromise = manager.startDownload();
    await flush();
    expect(manager.getState().downloadStatus).toBe('downloading');

    await manager.cancelDownload();
    expect(cancelFetching).toHaveBeenCalledWith(...SOURCES);
    expect(manager.getState().downloadStatus).toBe('not_started');

    fetchDeferred.reject(new Error('Download cancelled.'));
    await expect(startPromise).resolves.toBeUndefined();
    expect(manager.getState().downloadStatus).toBe('not_started');
    expect(manager.isReadyForInference()).toBe(false);
  });

  it('pauseDownload() no-ops safely when there is nothing active to pause', async () => {
    const { manager, pauseFetching } = makeHarness();
    // The underlying fetcher throws ResourceFetcherAlreadyPaused when idle.
    pauseFetching.mockRejectedValue(new Error('ResourceFetcherAlreadyPaused'));

    await expect(manager.pauseDownload()).resolves.toBeUndefined();
  });

  it('publishes paused immediately while the native pause request settles', async () => {
    const { manager, fetch, pauseFetching } = makeHarness();
    const fetchDeferred = defer<FetchResult>();
    const pauseDeferred = defer<void>();
    fetch.mockReturnValue(fetchDeferred.promise);
    pauseFetching.mockReturnValue(pauseDeferred.promise);

    const startPromise = manager.startDownload();
    expect(manager.getState().downloadStatus).toBe('downloading');

    const pausePromise = manager.pauseDownload();
    expect(manager.getState().downloadStatus).toBe('paused');

    pauseDeferred.resolve();
    await pausePromise;
    fetchDeferred.resolve(successfulFetchResult());
    await startPromise;
  });

  it('resumeDownload() no-ops safely when there is nothing active to resume', async () => {
    const { manager, resumeFetching } = makeHarness();
    resumeFetching.mockRejectedValue(new Error('ResourceFetcherAlreadyOngoing'));

    await expect(manager.resumeDownload()).resolves.toBeUndefined();
  });

  it('publishes downloading immediately while the native resume request settles', async () => {
    const { manager, fetch, resumeFetching } = makeHarness();
    const fetchDeferred = defer<FetchResult>();
    const resumeDeferred = defer<void>();
    fetch.mockReturnValue(fetchDeferred.promise);

    const startPromise = manager.startDownload();
    await manager.pauseDownload();
    expect(manager.getState().downloadStatus).toBe('paused');

    resumeFetching.mockReturnValue(resumeDeferred.promise);
    const resumePromise = manager.resumeDownload();
    expect(manager.getState().downloadStatus).toBe('downloading');

    resumeDeferred.resolve();
    await resumePromise;
    fetchDeferred.resolve(successfulFetchResult());
    await startPromise;
  });

  it('deletes the corrupt file before reporting failed (clean re-download guarantee)', async () => {
    const { manager, verifyIntegrity, deleteResources } = makeHarness();
    verifyIntegrity.mockResolvedValue(false);

    let statusAtDelete: ModelDownloadStatus | undefined;
    deleteResources.mockImplementation(async () => {
      statusAtDelete = manager.getState().downloadStatus;
    });

    await manager.startDownload();

    expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
    // The delete must happen BEFORE the terminal 'failed' state is published.
    expect(statusAtDelete).not.toBe('failed');
    expect(manager.getState().downloadStatus).toBe('failed');
  });

  it('reattaches an existing native download and verifies it when completion arrives', async () => {
    const downloadDeferred = defer<FetchResult>();
    const reattached: ReattachedDownload = {
      status: 'downloading',
      progress: 0.42,
      promise: downloadDeferred.promise,
    };
    const reattachExistingDownloads = jest.fn(async () => reattached);
    const verifyIntegrity = jest.fn(async () => true);
    const getModelConfig = jest.fn(async () => ({
      expectedSha256: EXPECTED_HASH,
      expectedSize: EXPECTED_SIZE,
    }));
    const manager = new ModelDownloadManager({
      fetcher: {
        fetch: jest.fn(async () => successfulFetchResult()),
        reattachExistingDownloads,
        pauseFetching: jest.fn(async () => {}),
        resumeFetching: jest.fn(async () => {}),
        cancelFetching: jest.fn(async () => {}),
        deleteResources: jest.fn(async () => {}),
        listDownloadedModels: jest.fn(async (): Promise<string[]> => []),
      },
      verifyIntegrity,
      getFileSize: jest.fn(async () => EXPECTED_SIZE),
      getModelConfig,
      sources: SOURCES,
      expectedModelFilename: EXPECTED_MODEL_FILENAME,
    });

    await expect(manager.reattachExistingDownload()).resolves.toBe(true);
    expect(reattachExistingDownloads).toHaveBeenCalledWith(expect.any(Function), ...SOURCES);
    expect(manager.getState().downloadStatus).toBe('downloading');
    expect(manager.getState().downloadProgress).toBe(0.42);

    downloadDeferred.resolve(successfulFetchResult());
    await flush();

    expect(getModelConfig).toHaveBeenCalledTimes(1);
    expect(verifyIntegrity).toHaveBeenCalledWith(LOCAL_MODEL_PATH, EXPECTED_HASH);
    expect(manager.getState().downloadStatus).toBe('downloaded');
    expect(manager.getState().integrityVerified).toBe(true);
  });

  describe('reconcile (launch-time disk reconciliation)', () => {
    it('reports not-ready when only another model is present', async () => {
      const { manager, listDownloadedModels, getFileSize } = makeHarness();
      listDownloadedModels.mockResolvedValue([OTHER_MODEL_PATH]);

      await manager.reconcile();

      expect(getFileSize).not.toHaveBeenCalled();
      expect(manager.isReadyForInference()).toBe(false);
    });

    it('reports ready from the active model when both model files coexist', async () => {
      const { manager, listDownloadedModels, getFileSize, deleteResources } = makeHarness();
      listDownloadedModels.mockResolvedValue([OTHER_MODEL_PATH, LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE);

      await manager.reconcile();

      expect(getFileSize).toHaveBeenCalledWith(LOCAL_MODEL_PATH);
      expect(deleteResources).not.toHaveBeenCalled();
      expect(manager.isReadyForInference()).toBe(true);
    });

    it('does not redownload when the newly selected model is already verified on disk', async () => {
      const { manager, listDownloadedModels, getFileSize, fetch } = makeHarness();
      listDownloadedModels.mockResolvedValue([OTHER_MODEL_PATH, LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE);

      await manager.reconcile();
      await manager.startDownload();

      expect(fetch).not.toHaveBeenCalled();
      expect(manager.isReadyForInference()).toBe(true);
    });

    it('reports ready when a present model has the expected size, without re-hashing a multi-GB file', async () => {
      const { manager, listDownloadedModels, getFileSize, verifyIntegrity, getModelConfig } = makeHarness();
      listDownloadedModels.mockResolvedValue([LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE);

      await manager.reconcile();

      // Memory safety (constitution Principle IV): a model left on disk already
      // passed verification at download time (the manager deletes anything that
      // fails), so launch trusts that cached result — a cheap size check — instead
      // of loading 2.4 GB into memory to re-hash it on every cold start.
      expect(verifyIntegrity).not.toHaveBeenCalled();
      expect(getModelConfig).toHaveBeenCalledTimes(1);
      expect(getFileSize).toHaveBeenCalledWith(LOCAL_MODEL_PATH);
      expect(manager.getState().downloadStatus).toBe('downloaded');
      expect(manager.getState().integrityVerified).toBe(true);
      expect(manager.isReadyForInference()).toBe(true);
    });

    it('deletes a truncated download (fewer bytes than expected) and reports not-ready', async () => {
      const { manager, listDownloadedModels, getFileSize, deleteResources } = makeHarness();
      await manager.startDownload();
      deleteResources.mockClear();
      listDownloadedModels.mockResolvedValue([LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE - 1024); // interrupted / partial download

      await manager.reconcile();

      expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
      expect(manager.getState().downloadStatus).toBe('not_started');
      expect(manager.isReadyForInference()).toBe(false);
    });

    it('trusts a complete file at or above the expected size (never false-deletes)', async () => {
      const { manager, listDownloadedModels, getFileSize, deleteResources } = makeHarness();
      await manager.startDownload();
      deleteResources.mockClear();
      listDownloadedModels.mockResolvedValue([LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE + 4096);

      await manager.reconcile();

      expect(deleteResources).not.toHaveBeenCalled();
      expect(manager.isReadyForInference()).toBe(true);
    });

    it('reports not-ready when no model is present on disk', async () => {
      const { manager, listDownloadedModels } = makeHarness();
      listDownloadedModels.mockResolvedValue([]);

      await manager.reconcile();

      expect(manager.getState().downloadStatus).toBe('not_started');
      expect(manager.isReadyForInference()).toBe(false);
    });

    it('reports not-ready without throwing if the on-disk check fails', async () => {
      const { manager, listDownloadedModels } = makeHarness();
      listDownloadedModels.mockRejectedValue(new Error('filesystem unavailable'));

      await expect(manager.reconcile()).resolves.toBeUndefined();
      expect(manager.isReadyForInference()).toBe(false);
    });
  });
});
