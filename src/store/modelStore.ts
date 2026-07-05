import { File } from 'expo-file-system';
import { LFM2_5_VL_1_6B_QUANTIZED } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { create } from 'zustand';

import { checkDeviceCompatibility } from '../model/DeviceCompatibility';
import { ModelDownloadManager, type ResourceSource } from '../model/ModelDownloadManager';
import { verifyModelIntegrity } from '../model/ModelIntegrity';
import type { IModelLifecycle } from '../types/interfaces';
import type { DeviceCompatibilityResult, ModelState } from '../types/models';

// ─────────────────────────────────────────────────────────────────────────────
// The composition root for the model lifecycle (T025). It wires the real
// ExpoResourceFetcher + SHA-256 verifier + pinned model sources into the
// ModelDownloadManager, and composes that with the device-compatibility gate
// into the full IModelLifecycle contract. Screens read from THIS store only.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_SOURCES: ResourceSource[] = [
  LFM2_5_VL_1_6B_QUANTIZED.modelSource,
  LFM2_5_VL_1_6B_QUANTIZED.tokenizerSource,
  LFM2_5_VL_1_6B_QUANTIZED.tokenizerConfigSource,
];

// Pinned SHA-256 of the LFM2.5-VL-1.6B (quantized) `.pte`, taken from the model
// repo's Git-LFS object id at revision v0.9.0 (the LFS `oid` equals the
// sha256sum of the served file content). A downloaded file that does not hash to
// this value is treated as corrupt and never loaded (constitution Principle IV).
// If the pinned model revision changes, update this digest to match.
const MODEL_SHA256 = '5f942c856acfe1a4d0b5f8d30bd752b5552bcf20bc6dfa6f3253896b2456d0c4';

// Exact byte size of that same `.pte` (from the Git-LFS pointer's `size`). Used as
// a cheap, memory-safe launch-time guard against a partial/truncated download.
const MODEL_FILE_SIZE = 2_427_656_704;

const manager = new ModelDownloadManager({
  fetcher: ExpoResourceFetcher,
  verifyIntegrity: verifyModelIntegrity,
  getFileSize: (fileUri: string) => Promise.resolve(new File(fileUri).size),
  sources: MODEL_SOURCES,
  expectedSha256: MODEL_SHA256,
  expectedSize: MODEL_FILE_SIZE,
});

export interface ModelStoreState extends ModelState {
  checkDeviceCompatibility: () => DeviceCompatibilityResult;
  /** Reconcile in-memory readiness against the model on disk (call once at launch). */
  reconcile: () => Promise<void>;
  startDownload: () => Promise<void>;
  pauseDownload: () => Promise<void>;
  resumeDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  isReadyForInference: () => boolean;
}

export const useModelStore = create<ModelStoreState>(() => ({
  ...manager.getState(),
  checkDeviceCompatibility,
  reconcile: () => manager.reconcile(),
  startDownload: () => manager.startDownload(),
  pauseDownload: () => manager.pauseDownload(),
  resumeDownload: () => manager.resumeDownload(),
  cancelDownload: () => manager.cancelDownload(),
  isReadyForInference: () => manager.isReadyForInference(),
}));

// Mirror every manager transition into the store so the setup screen re-renders.
manager.subscribe((state: ModelState) => {
  useModelStore.setState({
    downloadStatus: state.downloadStatus,
    downloadProgress: state.downloadProgress,
    integrityVerified: state.integrityVerified,
    error: state.error,
  });
});

// The imperative IModelLifecycle surface (contracts/model-lifecycle.contract.md)
// for non-React consumers, e.g. the InferenceQueue's readiness gate (T027).
export const modelLifecycle: IModelLifecycle = {
  checkDeviceCompatibility,
  getState: () => manager.getState(),
  subscribe: (listener) => manager.subscribe(listener),
  isReadyForInference: () => manager.isReadyForInference(),
  startDownload: () => manager.startDownload(),
  pauseDownload: () => manager.pauseDownload(),
  resumeDownload: () => manager.resumeDownload(),
  cancelDownload: () => manager.cancelDownload(),
};
