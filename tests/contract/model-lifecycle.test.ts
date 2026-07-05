jest.mock('react-native-device-info', () => ({
  getTotalMemorySync: jest.fn(),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { Platform } from 'react-native';
import { getTotalMemorySync } from 'react-native-device-info';

import { checkDeviceCompatibility } from '../../src/model/DeviceCompatibility';
import { ModelDownloadManager, type ResourceSource } from '../../src/model/ModelDownloadManager';
import type { ModelDownloadStatus } from '../../src/types/models';

const mockGetTotalMemorySync = getTotalMemorySync as jest.Mock;
const GB = 1024 * 1024 * 1024;
const SOURCES: ResourceSource[] = ['https://example.test/model.pte', 'tokenizer.json'];
const EXPECTED_HASH = 'hash';
const EXPECTED_SIZE = 2048;
const MODEL_PATH = '/local/model.pte';

function setPlatform(os: 'android' | 'ios', version: number): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
}

function makeManager() {
  const fetch = jest.fn(async () => ({
    paths: [MODEL_PATH, '/local/tokenizer.json'],
    wasDownloaded: [true, true],
  }));
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
    deleteResources,
    listDownloadedModels,
    verifyIntegrity,
    getFileSize,
  };
}

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('Model lifecycle contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('android', 33);
    mockGetTotalMemorySync.mockReturnValue(8 * GB);
  });

  it('returns unsupported with a reason instead of throwing when compatibility cannot be read', () => {
    mockGetTotalMemorySync.mockImplementation(() => {
      throw new Error('native device info unavailable');
    });

    expect(() => checkDeviceCompatibility()).not.toThrow();
    const result = checkDeviceCompatibility();
    expect(result.isSupported).toBe(false);
    expect(result.reason).not.toBeNull();
  });

  it('resolves startDownload to downloaded with integrity verified', async () => {
    const { manager, verifyIntegrity } = makeManager();

    await manager.startDownload();

    expect(verifyIntegrity).toHaveBeenCalledWith(MODEL_PATH, EXPECTED_HASH);
    expect(manager.getState()).toEqual(
      expect.objectContaining({
        downloadStatus: 'downloaded',
        downloadProgress: 1,
        integrityVerified: true,
        error: null,
      })
    );
    expect(manager.isReadyForInference()).toBe(true);
  });

  it('reports failed, not ready, and deletes corrupt bytes before publishing failure', async () => {
    const { manager, verifyIntegrity, deleteResources } = makeManager();
    verifyIntegrity.mockResolvedValue(false);
    let statusAtDelete: ModelDownloadStatus | null = null;
    deleteResources.mockImplementation(async () => {
      statusAtDelete = manager.getState().downloadStatus;
    });

    await manager.startDownload();

    expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
    expect(statusAtDelete).toBe('downloading');
    expect(manager.getState().downloadStatus).toBe('failed');
    expect(manager.getState().integrityVerified).toBe(false);
    expect(manager.isReadyForInference()).toBe(false);
  });

  it('absorbs pause/resume fetcher guard errors when no download is active', async () => {
    const { manager, pauseFetching, resumeFetching } = makeManager();
    pauseFetching.mockRejectedValue(new Error('ResourceFetcherAlreadyPaused'));
    resumeFetching.mockRejectedValue(new Error('ResourceFetcherAlreadyOngoing'));

    await expect(manager.pauseDownload()).resolves.toBeUndefined();
    await expect(manager.resumeDownload()).resolves.toBeUndefined();
  });

  it('reconciles missing, complete, and truncated model files without throwing', async () => {
    const { manager, listDownloadedModels, getFileSize, deleteResources } = makeManager();

    listDownloadedModels.mockResolvedValue([]);
    await manager.reconcile();
    expect(manager.getState().downloadStatus).toBe('not_started');
    expect(manager.isReadyForInference()).toBe(false);

    listDownloadedModels.mockResolvedValue([MODEL_PATH]);
    getFileSize.mockResolvedValue(EXPECTED_SIZE);
    await manager.reconcile();
    expect(manager.getState().downloadStatus).toBe('downloaded');
    expect(manager.isReadyForInference()).toBe(true);

    getFileSize.mockResolvedValue(EXPECTED_SIZE - 1);
    await manager.reconcile();
    expect(deleteResources).toHaveBeenCalledWith(...SOURCES);
    expect(manager.getState().downloadStatus).toBe('not_started');
  });

  it('keeps the model lifecycle boundary free of screen and inference imports', () => {
    const modelSources = [
      readSource('src/model/DeviceCompatibility.ts'),
      readSource('src/model/ModelDownloadManager.ts'),
      readSource('src/model/ModelIntegrity.ts'),
    ].join('\n');

    expect(modelSources).not.toMatch(/['"].*(screens|inference)/);
  });
});
