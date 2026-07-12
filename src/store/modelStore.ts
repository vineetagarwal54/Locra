import {
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from '@kesha-antonov/react-native-background-downloader';
import { Directory, File } from 'expo-file-system';
import { documentDirectory } from 'expo-file-system/legacy';
import { ResourceFetcherUtils } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { create } from 'zustand';

import type { ModelCandidate, ModelCandidateId } from '../model/ActiveModel';
import { BackgroundDownloadFetcher, type BgDownloadTask } from '../model/BackgroundDownloadFetcher';
import { checkDeviceCompatibility } from '../model/DeviceCompatibility';
import { fetchModelConfig } from '../model/ModelConfig';
import { ModelDownloadManager, type ResourceSource } from '../model/ModelDownloadManager';
import { verifyModelIntegrity } from '../model/ModelIntegrity';
import { allowCellularDownload, evaluateNetworkGate } from '../model/NetworkGate';
import { getDownloadConnectionType } from '../platform/NetworkConnection';
import { storage } from '../storage/mmkv';
import type { IModelLifecycle } from '../types/interfaces';
import type { DeviceCompatibilityResult, ModelState } from '../types/models';

// ─────────────────────────────────────────────────────────────────────────────
// The composition root for the model lifecycle (T025). It wires the real
// ExpoResourceFetcher + SHA-256 verifier + pinned model sources into the
// ModelDownloadManager, and composes that with the device-compatibility gate
// into the full IModelLifecycle contract. Screens read from THIS store only.
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_MODEL_STATE: ModelState = {
  downloadStatus: 'not_started',
  downloadProgress: 0,
  integrityVerified: false,
  error: null,
};

// Development escape hatch: skip post-download AND launch-time verification
// entirely so iterating on inference doesn't require hashing a 2.4 GB file on
// every fetch/relaunch. `__DEV__` is `false` in a release build, so production
// always runs the full SHA-256 + size checks below — this only affects local
// development builds. NEVER rely on this for anything but local iteration.
//
// This bypass is wired here, at the composition root, rather than inside
// ModelIntegrity.ts/ModelDownloadManager.ts, because those two modules are
// unit-tested against real (mocked-dependency) verification logic per
// constitution Principle VI (TDD non-negotiable for this module) — and `__DEV__`
// is `true` inside Jest, so an in-module `if (__DEV__)` bypass would silently
// short-circuit those tests instead of exercising the logic they assert on.
async function devSkipIntegrityCheck(): Promise<boolean> {
  // eslint-disable-next-line no-console
  console.warn('[Locra] DEV: skipping model integrity verification (SHA-256 + size checks).');
  return true;
}

// ── Background download (T047, FR-025) ──────────────────────────────────────
// A true Android background download (foreground service + Android 14/16 UIDT +
// persistent notification) via @kesha-antonov/react-native-background-downloader.
// It writes each file to the EXACT path react-native-executorch expects
// (`RNEDirectory + getFilenameFromUri(url)`), so `useLLM`'s ExpoResourceFetcher —
// still the adapter registered with `initExecutorch` — finds the files already
// present and never re-downloads them. Kept behind the `ResourceFetcherLike` seam,
// so `ModelDownloadManager`/`IModelLifecycle` are unchanged.
const RNE_DOWNLOAD_DIR = `${(documentDirectory ?? '').replace(/^file:\/\//, '')}react-native-executorch/`;

setConfig({
  showNotificationsEnabled: true,
  notificationsGrouping: {
    enabled: true,
    mode: 'summaryOnly',
    // Product-identity notification copy (design.md §12 content rules: direct,
    // calm, plain-language; never an internal model filename). The Android small
    // icon is supplied by the app's notification icon (app.json adaptiveIcon
    // monochrome), so tapping the notification opens Locra with its own mark.
    texts: {
      downloadTitle: 'Locra',
      downloadStarting: 'Preparing your on-device AI…',
      downloadProgress: 'Downloading AI model · {progress}%',
      downloadPaused: 'Download paused',
      downloadFinished: 'Locra is ready',
      groupTitle: 'Locra',
      groupText: 'Setting up your on-device AI',
    },
  },
});

const backgroundFetcher = new BackgroundDownloadFetcher({
  createDownloadTask: (cfg) =>
    toBgDownloadTask(createDownloadTask({ id: cfg.id, url: cfg.url, destination: cfg.destination })),
  destinationForUrl: (url) => `${RNE_DOWNLOAD_DIR}${ResourceFetcherUtils.getFilenameFromUri(url)}`,
  fileExists: (absolutePath) => new File(toFileUri(absolutePath)).exists,
  deleteFileIfExists: async (absolutePath) => {
    const file = new File(toFileUri(absolutePath));
    if (file.exists) {
      file.delete();
    }
  },
  // Reuse ExpoResourceFetcher's own listing so the directory scanned is identical.
  listDownloadedFiles: () => ExpoResourceFetcher.listDownloadedFiles(),
  ensureDownloadDir: () => {
    const dir = new Directory(toFileUri(RNE_DOWNLOAD_DIR));
    if (!dir.exists) {
      dir.create();
    }
    return Promise.resolve();
  },
  getExistingDownloadTasks: async () => {
    const tasks = await getExistingDownloadTasks();
    return tasks.map(toBgDownloadTask);
  },
});

let manager: ModelDownloadManager | null = null;
let managerModelId: ModelCandidateId | null = null;
let unsubscribeManager: (() => void) | null = null;

function initializeManager(model: ModelCandidate): void {
  if (manager !== null && managerModelId === model.id) {
    return;
  }

  unsubscribeManager?.();
  const sources: ResourceSource[] = [
    model.modelConstant.modelSource,
    model.modelConstant.tokenizerSource,
    model.modelConstant.tokenizerConfigSource,
  ];
  manager = new ModelDownloadManager({
    fetcher: backgroundFetcher,
    verifyIntegrity: __DEV__ ? devSkipIntegrityCheck : verifyModelIntegrity,
    getFileSize: (fileUri: string) => Promise.resolve(new File(toFileUri(fileUri)).size),
    getModelConfig: () =>
      fetchModelConfig(model.integrityConfigEndpoint, model.integrityFallback),
    sources,
    expectedModelFilename: ResourceFetcherUtils.getFilenameFromUri(
      model.modelConstant.modelSource
    ),
  });
  managerModelId = model.id;
  useModelStore.setState({ ...INITIAL_MODEL_STATE, selectedModelId: model.id });
  unsubscribeManager = manager.subscribe(syncManagerState);
}

function requireManager(): ModelDownloadManager {
  if (manager === null) {
    throw new Error('The model lifecycle is unavailable until a model is selected.');
  }
  return manager;
}

function syncManagerState(state: ModelState): void {
  useModelStore.setState({
    downloadStatus: state.downloadStatus,
    downloadProgress: state.downloadProgress,
    integrityVerified: state.integrityVerified,
    error: state.error,
  });
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export interface ModelStoreState extends ModelState {
  selectedModelId: ModelCandidateId | null;
  cellularDownloadWarningVisible: boolean;
  initialize: (model: ModelCandidate) => void;
  checkDeviceCompatibility: () => DeviceCompatibilityResult;
  /** Reattach native background downloads that survived process death. */
  reattachExistingDownload: () => Promise<boolean>;
  /** Reconcile in-memory readiness against the model on disk (call once at launch). */
  reconcile: () => Promise<void>;
  startDownload: () => Promise<void>;
  confirmCellularDownload: () => Promise<void>;
  dismissCellularDownloadWarning: () => void;
  pauseDownload: () => Promise<void>;
  resumeDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  isReadyForInference: () => boolean;
}

export const useModelStore = create<ModelStoreState>(() => ({
  ...INITIAL_MODEL_STATE,
  selectedModelId: null,
  cellularDownloadWarningVisible: false,
  initialize: initializeManager,
  checkDeviceCompatibility,
  reattachExistingDownload: () => requireManager().reattachExistingDownload(),
  reconcile: () => requireManager().reconcile(),
  startDownload: async () => {
    const gate = await evaluateNetworkGate({
      storage,
      getConnectionType: getDownloadConnectionType,
    });
    if (gate.status === 'warning') {
      useModelStore.setState({ cellularDownloadWarningVisible: true });
      return;
    }

    useModelStore.setState({ cellularDownloadWarningVisible: false });
    await requireManager().startDownload();
  },
  confirmCellularDownload: async () => {
    allowCellularDownload(storage);
    useModelStore.setState({ cellularDownloadWarningVisible: false });
    await requireManager().startDownload();
  },
  dismissCellularDownloadWarning: () => {
    useModelStore.setState({ cellularDownloadWarningVisible: false });
  },
  pauseDownload: () => requireManager().pauseDownload(),
  resumeDownload: () => requireManager().resumeDownload(),
  cancelDownload: () => requireManager().cancelDownload(),
  isReadyForInference: () => manager?.isReadyForInference() ?? false,
}));

// The imperative IModelLifecycle surface (contracts/model-lifecycle.contract.md)
// for non-React consumers, e.g. the InferenceQueue's readiness gate (T027).
export const modelLifecycle: IModelLifecycle = {
  checkDeviceCompatibility,
  getState: () => manager?.getState() ?? INITIAL_MODEL_STATE,
  subscribe: (listener) => requireManager().subscribe(listener),
  isReadyForInference: () => manager?.isReadyForInference() ?? false,
  startDownload: () => requireManager().startDownload(),
  pauseDownload: () => requireManager().pauseDownload(),
  resumeDownload: () => requireManager().resumeDownload(),
  cancelDownload: () => requireManager().cancelDownload(),
};

type NativeDownloadTask =
  | ReturnType<typeof createDownloadTask>
  | Awaited<ReturnType<typeof getExistingDownloadTasks>>[number];

function toBgDownloadTask(task: NativeDownloadTask): BgDownloadTask {
  const adapter: BgDownloadTask = {
    id: task.id,
    state: task.state,
    bytesDownloaded: task.bytesDownloaded,
    bytesTotal: task.bytesTotal,
    destination: 'destination' in task ? task.destination : undefined,
    progress: (handler) => {
      task.progress(handler);
      return adapter;
    },
    done: (handler) => {
      task.done(() => handler());
      return adapter;
    },
    error: (handler) => {
      task.error((params) => handler(params));
      return adapter;
    },
    start: () => task.start(),
    pause: () => task.pause(),
    resume: () => task.resume(),
    stop: () => task.stop(),
  };
  return adapter;
}
