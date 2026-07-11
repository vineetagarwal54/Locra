import { ModelDownloadManager, type ResourceSource } from '../../src/model/ModelDownloadManager';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface FetchResult {
  paths: string[];
  wasDownloaded: boolean[];
}

const SOURCES: ResourceSource[] = ['https://example.test/model.pte', 'tokenizer.json'];
const EXPECTED_HASH = 'expected-hash';
const EXPECTED_SIZE = 4096;
const MODEL_PATH = '/local/model.pte';

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fetchResult(): FetchResult {
  return {
    paths: [MODEL_PATH, '/local/tokenizer.json'],
    wasDownloaded: [true, true],
  };
}

describe('model setup integration flow', () => {
  it('moves from missing model to paused/resumed download to verified ready state', async () => {
    const fetchDeferred = defer<FetchResult>();
    const fetch = jest.fn((onProgress?: (progress: number) => void) => {
      onProgress?.(0.24);
      return fetchDeferred.promise;
    });
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
      expectedModelFilename: 'model.pte',
    });

    await manager.reconcile();
    expect(manager.getState().downloadStatus).toBe('not_started');
    expect(manager.isReadyForInference()).toBe(false);

    const download = manager.startDownload();
    expect(manager.getState().downloadStatus).toBe('downloading');
    await Promise.resolve();
    expect(manager.getState().downloadProgress).toBe(0.24);

    await manager.pauseDownload();
    expect(pauseFetching).toHaveBeenCalledWith(...SOURCES);
    expect(manager.getState().downloadStatus).toBe('paused');

    await manager.resumeDownload();
    expect(resumeFetching).toHaveBeenCalledWith(...SOURCES);
    expect(manager.getState().downloadStatus).toBe('downloading');

    fetchDeferred.resolve(fetchResult());
    await download;

    expect(getModelConfig).toHaveBeenCalledTimes(1);
    expect(verifyIntegrity).toHaveBeenCalledWith(MODEL_PATH, EXPECTED_HASH);
    expect(deleteResources).not.toHaveBeenCalled();
    expect(manager.getState().downloadStatus).toBe('downloaded');
    expect(manager.getState().integrityVerified).toBe(true);
    expect(manager.isReadyForInference()).toBe(true);
  });
});
