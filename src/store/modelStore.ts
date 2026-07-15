import {
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from '@kesha-antonov/react-native-background-downloader';
import { Directory, File } from 'expo-file-system';
import { documentDirectory } from 'expo-file-system/legacy';
import { create } from 'zustand';

import type { ModelCandidate, ModelCandidateId } from '../model/ActiveModel';
import { BackgroundDownloadFetcher, type BgDownloadTask } from '../model/BackgroundDownloadFetcher';
import { checkActiveModelCompatibility, checkDeviceCompatibility } from '../model/DeviceCompatibility';
import {
  getInferenceReadiness,
  type InferenceReadiness,
} from '../model/InferenceReadiness';
import {
  QWEN3_VL_2B_INSTRUCT_BUNDLE,
  type ModelArtifactBundleManifest,
} from '../model/ModelArtifactManifest';
import {
  ModelDownloadManager,
  type VerifiedArtifact,
} from '../model/ModelDownloadManager';
import { verifyModelIntegrity } from '../model/ModelIntegrity';
import {
  isQwenBundleReady,
  shouldRouteToQwenDownload,
} from '../model/ModelReadinessReconciliation';
import { allowCellularDownload, evaluateNetworkGate } from '../model/NetworkGate';
import { getDownloadConnectionType } from '../platform/NetworkConnection';
import { storage } from '../storage/mmkv';
import type { IModelLifecycle } from '../types/interfaces';
import type { DeviceCompatibilityResult, ModelState } from '../types/models';

// ─────────────────────────────────────────────────────────────────────────────
// The composition root for the Qwen V1 model lifecycle. It wires the background
// downloader + SHA-256 verifier + exact artifact manifest into the bundle
// ModelDownloadManager, and composes that with the device-compatibility gate into
// the full IModelLifecycle contract. Screens read from THIS store only.
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL_MODEL_STATE: ModelState = {
  setupPhase: 'checking',
  downloadStatus: 'not_started',
  downloadProgress: 0,
  verificationProgress: 0,
  verificationArtifactProgress: 0,
  verificationArtifactName: null,
  canRetryVerification: false,
  integrityVerified: false,
  error: null,
};

// Development escape hatch: skip SHA hashing only. Exact sizes still apply, and
// development never writes a durable record that a production build could trust.
// `__DEV__` is `false` in a release build, so production always runs the full
// SHA-256 + size checks. Wired here (not inside the unit-tested lifecycle modules)
// because `__DEV__` is `true` under Jest.
async function devSkipIntegrityCheck(
  _fileUri: string,
  _expectedSha256: string,
  onProgress?: (progress: { bytesRead: number; totalBytes: number; progress: number }) => void,
): Promise<boolean> {
  // eslint-disable-next-line no-console
  console.warn('[Locra] DEV: skipping model integrity verification (SHA-256 + size checks).');
  onProgress?.({ bytesRead: 1, totalBytes: 1, progress: 1 });
  return true;
}

// Locra's writable model directory. The Qwen bundle (language GGUF + projector)
// is downloaded here; llama.rn loads the artifacts from these exact paths.
const MODEL_DOWNLOAD_DIR = `${(documentDirectory ?? '').replace(/^file:\/\//, '')}locra-models/`;
const MODEL_VERIFICATION_RECORD_KEY = 'model:qwen3-vl-2b:verification-v1';

setConfig({
  showNotificationsEnabled: true,
  notificationsGrouping: {
    enabled: true,
    mode: 'summaryOnly',
    texts: {
      downloadTitle: 'Locra',
      downloadStarting: 'Preparing your on-device AI…',
      downloadProgress: 'Downloading AI model · {progress}%',
      downloadPaused: 'Download paused',
      downloadFinished: 'Download complete — open Locra to verify',
      groupTitle: 'Locra',
      groupText: 'Setting up your on-device AI',
    },
  },
});

/** The last path segment of a URL/path, ignoring any query string. */
function filenameFromUri(uri: string): string {
  const withoutQuery = uri.split('?')[0];
  return withoutQuery.split(/[\\/]/).at(-1) ?? withoutQuery;
}

function destinationForUrl(url: string): string {
  return `${MODEL_DOWNLOAD_DIR}${filenameFromUri(url)}`;
}

const qwenBackgroundFetcher = new BackgroundDownloadFetcher({
  createDownloadTask: (cfg) =>
    toBgDownloadTask(createDownloadTask({ id: cfg.id, url: cfg.url, destination: cfg.destination })),
  destinationForUrl,
  fileExists: (absolutePath) => new File(toFileUri(absolutePath)).exists,
  deleteFileIfExists: async (absolutePath) => {
    const file = new File(toFileUri(absolutePath));
    if (file.exists) {
      file.delete();
    }
  },
  listDownloadedFiles: () => {
    const dir = new Directory(toFileUri(MODEL_DOWNLOAD_DIR));
    if (!dir.exists) {
      return Promise.resolve([]);
    }
    const files = dir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => file.uri.replace(/^file:\/\//, ''));
    return Promise.resolve(files);
  },
  ensureDownloadDir: () => {
    const dir = new Directory(toFileUri(MODEL_DOWNLOAD_DIR));
    if (!dir.exists) {
      dir.create();
    }
    return Promise.resolve();
  },
  getExistingDownloadTasks: async () => {
    const tasks = await getExistingDownloadTasks();
    return tasks.map(toBgDownloadTask);
  },
  isModelArtifactFile: (absolutePath) => absolutePath.endsWith('.gguf'),
});

let manager: ModelDownloadManager | null = null;
let managerModelId: string | null = null;
let unsubscribeManager: (() => void) | null = null;

// Builds the exact-manifest Qwen bundle manager. Each pinned artifact carries its
// own SHA-256/size (no remote config fetch), verified independently. The aggregate
// ModelState remains product-facing; per-artifact state lives inside the manager.
function buildQwenManager(manifest: ModelArtifactBundleManifest): ModelDownloadManager {
  const artifacts: VerifiedArtifact[] = manifest.artifacts.map((artifact) => ({
    artifactId: artifact.artifactId,
    fileName: artifact.fileName,
    getExpectedIntegrity: () =>
      Promise.resolve({
        expectedSha256: artifact.expectedSha256,
        expectedSize: artifact.expectedSizeBytes,
      }),
  }));
  return new ModelDownloadManager({
    fetcher: qwenBackgroundFetcher,
    verifyIntegrity: __DEV__ ? devSkipIntegrityCheck : verifyModelIntegrity,
    getFileSize: (fileUri: string) => Promise.resolve(new File(toFileUri(fileUri)).size),
    sources: manifest.artifacts.map((artifact) => artifact.sourceUri),
    artifacts,
    modelId: manifest.activeModelId,
    verificationRecord: __DEV__ ? undefined : {
      read: () => Promise.resolve(storage.getString(MODEL_VERIFICATION_RECORD_KEY) ?? null),
      write: (value) => {
        storage.set(MODEL_VERIFICATION_RECORD_KEY, value);
        return Promise.resolve();
      },
      clear: () => {
        storage.remove(MODEL_VERIFICATION_RECORD_KEY);
        return Promise.resolve();
      },
    },
  });
}

/** Mounts the Qwen bundle as the active (and only) model lifecycle. */
function initializeQwenBundle(): void {
  if (manager !== null && managerModelId === QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId) {
    return;
  }
  unsubscribeManager?.();
  manager = buildQwenManager(QWEN3_VL_2B_INSTRUCT_BUNDLE);
  managerModelId = QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId;
  useModelStore.setState({
    ...INITIAL_MODEL_STATE,
    selectedModelId: QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId as ModelCandidateId,
  });
  unsubscribeManager = manager.subscribe(syncManagerState);
}

// Local on-disk paths for the Qwen artifacts, resolved to the exact destinations
// the background fetcher writes to. Consumed by the Qwen host to load the runtime.
export function getQwenArtifactPaths(): { modelPath: string; projectorPath: string } {
  const [languageArtifact, projectorArtifact] = QWEN3_VL_2B_INSTRUCT_BUNDLE.artifacts;
  return {
    modelPath: destinationForUrl(languageArtifact.sourceUri),
    projectorPath: destinationForUrl(projectorArtifact.sourceUri),
  };
}

// Qwen readiness is the exact manifest verified independently — never "any GGUF
// exists" on disk.
function isQwenReady(): boolean {
  if (manager === null || managerModelId !== QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId) {
    return false;
  }
  return isQwenBundleReady({
    activeModelId: managerModelId,
    manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
    artifactStates: manager.getArtifactStates(),
  });
}

function requireManager(): ModelDownloadManager {
  if (manager === null) {
    // The Qwen bundle is the only model; initialize it on demand.
    initializeQwenBundle();
  }
  return manager as ModelDownloadManager;
}

function syncManagerState(state: ModelState): void {
  useModelStore.setState({
    setupPhase: state.setupPhase,
    downloadStatus: state.downloadStatus,
    downloadProgress: state.downloadProgress,
    verificationProgress: state.verificationProgress,
    verificationArtifactProgress: state.verificationArtifactProgress,
    verificationArtifactName: state.verificationArtifactName,
    canRetryVerification: state.canRetryVerification,
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
  /** Mount the Qwen V1 artifact bundle as the active model lifecycle. */
  initialize: (model?: ModelCandidate) => void;
  initializeQwenBundle: () => void;
  checkDeviceCompatibility: () => DeviceCompatibilityResult;
  /** Device compatibility for the active runtime (Qwen shares the floor). */
  checkActiveModelCompatibility: () => DeviceCompatibilityResult;
  /** True when the Qwen bundle is not yet ready and the user must download it. */
  shouldRouteToQwenDownload: () => boolean;
  /** Reattach native background downloads that survived process death. */
  reattachExistingDownload: () => Promise<boolean>;
  /** Reconcile in-memory readiness against the model on disk (call once at launch). */
  reconcile: () => Promise<void>;
  /** Run or restart the native integrity check after fast reconciliation. */
  verifyPendingArtifacts: () => Promise<void>;
  /** Delete model artifacts and start a fresh gated download. */
  redownload: () => Promise<void>;
  failActiveCheck: (message: string) => void;
  startDownload: () => Promise<void>;
  confirmCellularDownload: () => Promise<void>;
  dismissCellularDownloadWarning: () => void;
  pauseDownload: () => Promise<void>;
  resumeDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  isReadyForInference: () => boolean;
  /** Text generation needs only the verified language GGUF, not the projector. */
  isReadyForTextInference: () => boolean;
  getInferenceReadiness: () => InferenceReadiness;
}

export const useModelStore = create<ModelStoreState>(() => ({
  ...INITIAL_MODEL_STATE,
  selectedModelId: null,
  cellularDownloadWarningVisible: false,
  // The single V1 model is Qwen; any `initialize()` call mounts the Qwen bundle.
  initialize: () => initializeQwenBundle(),
  initializeQwenBundle,
  checkDeviceCompatibility,
  checkActiveModelCompatibility: () =>
    checkActiveModelCompatibility(),
  shouldRouteToQwenDownload: () =>
    shouldRouteToQwenDownload({
      qwenReady: isQwenReady(),
    }),
  reattachExistingDownload: () => requireManager().reattachExistingDownload(),
  reconcile: () => requireManager().reconcile(),
  verifyPendingArtifacts: () => requireManager().verifyPendingArtifacts(),
  redownload: async () => {
    await requireManager().cancelDownload();
    await useModelStore.getState().startDownload();
  },
  failActiveCheck: (message) => requireManager().failActiveCheck(message),
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
  isReadyForTextInference: () => manager?.isReadyForInference() ?? false,
  getInferenceReadiness: () => getInferenceReadiness(manager?.getState() ?? INITIAL_MODEL_STATE),
}));

// The imperative IModelLifecycle surface for non-React consumers, e.g. the
// InferenceQueue's readiness gate.
export const modelLifecycle: IModelLifecycle = {
  checkDeviceCompatibility,
  getState: () => manager?.getState() ?? INITIAL_MODEL_STATE,
  subscribe: (listener) => requireManager().subscribe(listener),
  isReadyForInference: () => manager?.isReadyForInference() ?? false,
  getInferenceReadiness: () => getInferenceReadiness(manager?.getState() ?? INITIAL_MODEL_STATE),
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
