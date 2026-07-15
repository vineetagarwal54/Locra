import {
  ModelDownloadManager,
  type ReattachedDownload,
  type VerifiedArtifact,
} from '../../../src/model/ModelDownloadManager';

// The generalized manager drives an EXACT-manifest bundle: Qwen's language GGUF
// plus its Q8_0 projector, each verified independently. The fetcher and integrity
// verifier are injected mocks — no real download or native crypto runs here.

const LANG_URL = 'https://hf.test/Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const PROJ_URL = 'https://hf.test/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf';
const LANG_FILE = 'Qwen3VL-2B-Instruct-Q4_K_M.gguf';
const PROJ_FILE = 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf';
const LANG_PATH = `/local/models/${LANG_FILE}`;
const PROJ_PATH = `/local/models/${PROJ_FILE}`;
const LANG_SHA = '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae';
const PROJ_SHA = 'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82';
const LANG_SIZE = 1_107_409_952;
const PROJ_SIZE = 445_053_216;
const SOURCES = [LANG_URL, PROJ_URL];

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

function bundleFetchResult(): FetchResult {
  return { paths: [LANG_PATH, PROJ_PATH], wasDownloaded: [true, true] };
}

function artifacts(): VerifiedArtifact[] {
  return [
    {
      artifactId: 'qwen_language_model',
      fileName: LANG_FILE,
      getExpectedIntegrity: async () => ({ expectedSha256: LANG_SHA, expectedSize: LANG_SIZE }),
    },
    {
      artifactId: 'qwen_multimodal_projector',
      fileName: PROJ_FILE,
      getExpectedIntegrity: async () => ({ expectedSha256: PROJ_SHA, expectedSize: PROJ_SIZE }),
    },
  ];
}

function makeHarness() {
  const fetch = jest.fn(async () => bundleFetchResult());
  const pauseFetching = jest.fn(async () => {});
  const resumeFetching = jest.fn(async () => {});
  const cancelFetching = jest.fn(async () => {});
  const deleteResources = jest.fn(async () => {});
  const listDownloadedModels = jest.fn(async (): Promise<string[]> => []);
  const verifyIntegrity = jest.fn(async (fileUri: string) => fileUri.length > 0);
  const getFileSize = jest.fn(
    async (path: string): Promise<number> => (path === PROJ_PATH ? PROJ_SIZE : LANG_SIZE)
  );
  let verificationRecord: string | null = null;
  const readVerificationRecord = jest.fn(async () => verificationRecord);
  const writeVerificationRecord = jest.fn(async (value: string) => {
    verificationRecord = value;
  });
  const clearVerificationRecord = jest.fn(async () => {
    verificationRecord = null;
  });

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
    artifacts: artifacts(),
    modelId: 'qwen-test',
    verificationRecord: {
      read: readVerificationRecord,
      write: writeVerificationRecord,
      clear: clearVerificationRecord,
    },
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
    readVerificationRecord,
    writeVerificationRecord,
    clearVerificationRecord,
  };
}

describe('ModelArtifactBundleManager (generalized ModelDownloadManager)', () => {
  it('is ready only when BOTH artifacts are downloaded and independently verified', async () => {
    const { manager, verifyIntegrity } = makeHarness();

    await manager.startDownload();

    expect(verifyIntegrity).toHaveBeenCalledWith(LANG_PATH, LANG_SHA);
    expect(verifyIntegrity).toHaveBeenCalledWith(PROJ_PATH, PROJ_SHA);
    expect(manager.getState().downloadStatus).toBe('downloaded');
    expect(manager.getState().integrityVerified).toBe(true);
    expect(manager.isReadyForInference()).toBe(true);
    expect(manager.getArtifactStates()).toEqual([
      { artifactId: 'qwen_language_model', downloaded: true, integrityVerified: true },
      { artifactId: 'qwen_multimodal_projector', downloaded: true, integrityVerified: true },
    ]);
  });

  it('publishes downloading -> verifying -> ready and persists only after the whole bundle verifies', async () => {
    const { manager, writeVerificationRecord } = makeHarness();
    const phases: string[] = [];
    manager.subscribe((state) => phases.push(state.setupPhase));

    await manager.startDownload();

    expect(phases).toEqual(expect.arrayContaining(['preparing', 'downloading', 'verifying', 'ready']));
    expect(phases.indexOf('verifying')).toBeLessThan(phases.indexOf('ready'));
    expect(writeVerificationRecord).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toEqual(expect.objectContaining({
      setupPhase: 'ready',
      integrityVerified: true,
    }));
  });

  it('fails the whole bundle (not ready) when the projector fails verification', async () => {
    const { manager, verifyIntegrity, deleteResources, writeVerificationRecord } = makeHarness();
    const phases: string[] = [];
    manager.subscribe((state) => phases.push(state.setupPhase));
    verifyIntegrity.mockImplementation(async (path: string) => path !== PROJ_PATH);

    await manager.startDownload();

    expect(manager.getState().downloadStatus).toBe('failed');
    expect(manager.getState().setupPhase).toBe('failed');
    expect(phases).toEqual(expect.arrayContaining(['downloading', 'verifying', 'failed']));
    expect(phases).not.toContain('ready');
    expect(manager.isReadyForInference()).toBe(false);
    expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
    expect(writeVerificationRecord).not.toHaveBeenCalled();
    const states = manager.getArtifactStates();
    expect(states.find((s) => s.artifactId === 'qwen_multimodal_projector')?.integrityVerified).toBe(false);
  });

  it.each([
    ['smaller', PROJ_SIZE - 1],
    ['larger', PROJ_SIZE + 1],
  ])('rejects a %s-than-expected artifact before hashing it', async (_label, badSize) => {
    const { manager, getFileSize, verifyIntegrity } = makeHarness();
    getFileSize.mockImplementation(async (path: string) => path === PROJ_PATH ? badSize : LANG_SIZE);

    await manager.startDownload();

    expect(manager.getState().setupPhase).toBe('failed');
    expect(manager.isReadyForInference()).toBe(false);
    expect(verifyIntegrity).not.toHaveBeenCalledWith(PROJ_PATH, PROJ_SHA);
  });

  it('reports aggregate 0..1 progress across both files', async () => {
    const { manager, fetch } = makeHarness();
    const fetchDeferred = defer<FetchResult>();
    let emit: ((progress: number) => void) | undefined;
    fetch.mockImplementation((callback?: (progress: number) => void) => {
      emit = callback;
      return fetchDeferred.promise;
    });

    const startPromise = manager.startDownload();
    emit?.(0.5);
    expect(manager.getState().downloadProgress).toBe(0.5);

    fetchDeferred.resolve(bundleFetchResult());
    await startPromise;
    expect(manager.getState().downloadProgress).toBe(1);
  });

  it('delegates pause/resume/cancel to the fetcher for all bundle sources', async () => {
    const { manager, fetch, pauseFetching, resumeFetching, cancelFetching } = makeHarness();
    const fetchDeferred = defer<FetchResult>();
    fetch.mockReturnValue(fetchDeferred.promise);

    const startPromise = manager.startDownload();
    await flush();

    await manager.pauseDownload();
    expect(pauseFetching).toHaveBeenCalledWith(...SOURCES);
    await manager.resumeDownload();
    expect(resumeFetching).toHaveBeenCalledWith(...SOURCES);

    await manager.cancelDownload();
    expect(cancelFetching).toHaveBeenCalledWith(...SOURCES);

    fetchDeferred.reject(new Error('Download cancelled.'));
    await expect(startPromise).resolves.toBeUndefined();
    expect(manager.getState().downloadStatus).toBe('not_started');
  });

  it('reattaches a background bundle download and verifies both files on completion', async () => {
    const downloadDeferred = defer<FetchResult>();
    const reattached: ReattachedDownload = {
      status: 'downloading',
      progress: 0.33,
      promise: downloadDeferred.promise,
    };
    const reattachExistingDownloads = jest.fn(async () => reattached);
    const verifyIntegrity = jest.fn(async () => true);
    const manager = new ModelDownloadManager({
      fetcher: {
        fetch: jest.fn(async () => bundleFetchResult()),
        reattachExistingDownloads,
        pauseFetching: jest.fn(async () => {}),
        resumeFetching: jest.fn(async () => {}),
        cancelFetching: jest.fn(async () => {}),
        deleteResources: jest.fn(async () => {}),
        listDownloadedModels: jest.fn(async (): Promise<string[]> => []),
      },
      verifyIntegrity,
      getFileSize: jest.fn(async (path: string) => path === PROJ_PATH ? PROJ_SIZE : LANG_SIZE),
      sources: SOURCES,
      artifacts: artifacts(),
      modelId: 'qwen-test',
    });

    await expect(manager.reattachExistingDownload()).resolves.toBe(true);
    expect(reattachExistingDownloads).toHaveBeenCalledWith(expect.any(Function), ...SOURCES);
    expect(manager.getState().downloadProgress).toBe(0.33);

    downloadDeferred.resolve(bundleFetchResult());
    await flush();

    expect(verifyIntegrity).toHaveBeenCalledWith(LANG_PATH, LANG_SHA);
    expect(verifyIntegrity).toHaveBeenCalledWith(PROJ_PATH, PROJ_SHA);
    expect(manager.isReadyForInference()).toBe(true);
  });

  describe('restart reconciliation', () => {
    it('creates a record after full verification, then restores readiness without re-hashing', async () => {
      const { manager, listDownloadedModels, fetch, verifyIntegrity, writeVerificationRecord } = makeHarness();
      listDownloadedModels.mockResolvedValue([LANG_PATH, PROJ_PATH]);

      await manager.reconcile();
      expect(verifyIntegrity).toHaveBeenCalledTimes(2);
      expect(writeVerificationRecord).toHaveBeenCalledTimes(1);
      verifyIntegrity.mockClear();
      await manager.reconcile();
      await manager.startDownload();

      expect(fetch).not.toHaveBeenCalled();
      expect(verifyIntegrity).not.toHaveBeenCalled();
      expect(manager.isReadyForInference()).toBe(true);
    });

    it('is not ready when only one artifact is present on disk', async () => {
      const { manager, listDownloadedModels, clearVerificationRecord } = makeHarness();
      listDownloadedModels.mockResolvedValue([LANG_PATH]);

      await manager.reconcile();

      expect(manager.isReadyForInference()).toBe(false);
      expect(manager.getState().downloadStatus).toBe('not_started');
      expect(manager.getState().setupPhase).toBe('not_installed');
      expect(clearVerificationRecord).toHaveBeenCalled();
    });

    it('deletes and reports not-ready when an artifact is truncated', async () => {
      const { manager, listDownloadedModels, getFileSize, deleteResources } = makeHarness();
      listDownloadedModels.mockResolvedValue([LANG_PATH, PROJ_PATH]);
      getFileSize.mockImplementation(async (path: string) =>
        path === PROJ_PATH ? PROJ_SIZE - 4096 : LANG_SIZE
      );

      await manager.reconcile();

      expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
      expect(manager.isReadyForInference()).toBe(false);
    });

    it('invalidates a stale or malformed record and performs full verification safely', async () => {
      const { manager, listDownloadedModels, readVerificationRecord, verifyIntegrity, clearVerificationRecord } = makeHarness();
      listDownloadedModels.mockResolvedValue([LANG_PATH, PROJ_PATH]);
      readVerificationRecord.mockResolvedValue('{broken');

      await manager.reconcile();

      expect(clearVerificationRecord).toHaveBeenCalled();
      expect(verifyIntegrity).toHaveBeenCalledTimes(2);
      expect(manager.getState().setupPhase).toBe('ready');
    });

    it('invalidates a manifest-mismatched record and performs full verification', async () => {
      const { manager, listDownloadedModels, readVerificationRecord, verifyIntegrity, clearVerificationRecord } = makeHarness();
      listDownloadedModels.mockResolvedValue([LANG_PATH, PROJ_PATH]);
      readVerificationRecord.mockResolvedValue(JSON.stringify({
        schemaVersion: 1,
        modelId: 'another-model',
        manifestFingerprint: 'stale',
        verifiedAt: 1,
        artifacts: [],
      }));

      await manager.reconcile();

      expect(clearVerificationRecord).toHaveBeenCalled();
      expect(verifyIntegrity).toHaveBeenCalledTimes(2);
      expect(manager.getState().setupPhase).toBe('ready');
    });

    it('deduplicates repeated download taps into one native task', async () => {
      const { manager, fetch } = makeHarness();
      const download = defer<FetchResult>();
      fetch.mockReturnValue(download.promise);

      const first = manager.startDownload();
      const second = manager.startDownload();
      expect(first).toBe(second);
      expect(fetch).toHaveBeenCalledTimes(1);
      download.resolve(bundleFetchResult());
      await first;
    });

    it('prevents a late reconciliation result from overwriting a newer download', async () => {
      const { manager, listDownloadedModels, fetch } = makeHarness();
      const files = defer<string[]>();
      const download = defer<FetchResult>();
      listDownloadedModels.mockReturnValue(files.promise);
      fetch.mockReturnValue(download.promise);

      const reconciliation = manager.reconcile();
      const downloading = manager.startDownload();
      expect(manager.getState().setupPhase).toBe('downloading');
      files.resolve([]);
      await reconciliation;
      expect(manager.getState().setupPhase).toBe('downloading');
      download.resolve(bundleFetchResult());
      await downloading;
    });
  });
});
