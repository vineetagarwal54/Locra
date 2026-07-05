import { ModelDownloadManager } from '../../../src/model/ModelDownloadManager';
import type { ModelDownloadStatus } from '../../../src/types/models';

// The manager wraps ExpoResourceFetcher (fetch / pause / resume / cancel /
// deleteResources) and runs a SHA-256 integrity check after each fetch. Both the
// fetcher and the integrity verifier are injected here as mocks — no real
// download or native crypto is exercised.

const SOURCES = ['https://example.test/model.pte', 'https://example.test/tokenizer.json'];
const EXPECTED_HASH = 'abc123def456';
const EXPECTED_SIZE = 2_427_656_704;
const LOCAL_MODEL_PATH = '/local/react-native-executorch/model.pte';
const LOCAL_TOKENIZER_PATH = '/local/react-native-executorch/tokenizer.json';

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
    sources: SOURCES,
    expectedSha256: EXPECTED_HASH,
    expectedSize: EXPECTED_SIZE,
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
  };
}

describe('ModelDownloadManager', () => {
  it('resolves to downloaded with a true integrity check on success', async () => {
    const { manager, verifyIntegrity } = makeHarness();
    verifyIntegrity.mockResolvedValue(true);

    await manager.startDownload();

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

  describe('reconcile (launch-time disk reconciliation)', () => {
    it('reports ready when a present model has the expected size, without re-hashing a multi-GB file', async () => {
      const { manager, listDownloadedModels, getFileSize, verifyIntegrity } = makeHarness();
      listDownloadedModels.mockResolvedValue([LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE);

      await manager.reconcile();

      // Memory safety (constitution Principle IV): a model left on disk already
      // passed verification at download time (the manager deletes anything that
      // fails), so launch trusts that cached result — a cheap size check — instead
      // of loading 2.4 GB into memory to re-hash it on every cold start.
      expect(verifyIntegrity).not.toHaveBeenCalled();
      expect(manager.getState().downloadStatus).toBe('downloaded');
      expect(manager.getState().integrityVerified).toBe(true);
      expect(manager.isReadyForInference()).toBe(true);
    });

    it('deletes a truncated download (fewer bytes than expected) and reports not-ready', async () => {
      const { manager, listDownloadedModels, getFileSize, deleteResources } = makeHarness();
      listDownloadedModels.mockResolvedValue([LOCAL_MODEL_PATH]);
      getFileSize.mockResolvedValue(EXPECTED_SIZE - 1024); // interrupted / partial download

      await manager.reconcile();

      expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
      expect(manager.getState().downloadStatus).toBe('not_started');
      expect(manager.isReadyForInference()).toBe(false);
    });

    it('trusts a complete file at or above the expected size (never false-deletes)', async () => {
      const { manager, listDownloadedModels, getFileSize, deleteResources } = makeHarness();
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
