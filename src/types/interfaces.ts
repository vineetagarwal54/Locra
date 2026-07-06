// ISP-compliant interfaces implemented by the Zustand stores in src/store/ —
// contract tests (tests/contract/*) assert against these, mirroring the plain
// module contracts in specs/001-camera-vlm-qa/contracts/*.contract.md.

import type {
  DeviceCompatibilityResult,
  InferenceRequest,
  InferenceState,
  MetricsSummary,
  ModelState,
  QASession,
} from './models';

export interface IInferenceQueue {
  submit(request: InferenceRequest): Promise<void>;
  cancel(): void;
  subscribe(listener: (state: InferenceState) => void): () => void;
  getState(): InferenceState;
}

export interface IModelLifecycle {
  checkDeviceCompatibility(): DeviceCompatibilityResult;
  getState(): ModelState;
  subscribe(listener: (state: ModelState) => void): () => void;
  isReadyForInference(): boolean;
  startDownload(): Promise<void>;
  pauseDownload(): Promise<void>;
  resumeDownload(): Promise<void>;
  cancelDownload(): Promise<void>;
}

export interface IHistoryStore {
  save(session: QASession): void;
  get(id: string): QASession | null;
  list(limit?: number, offset?: number): QASession[];
  delete(id: string): void;
  clear(): void;
  setFlag(id: string, flagged: boolean, note?: string): void;
  getMetricsSummary(): MetricsSummary;
}
