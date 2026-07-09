// Shared domain types — data-model.md is the source of truth for field shapes.

import type { InferenceTrace } from '../inference/InferenceTrace';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';

export type QASessionStatus = 'streaming' | 'completed' | 'cancelled' | 'errored';

export interface PerformanceMetrics {
  modelLoadTimeMs: number;
  preprocessingTimeMs: number;
  firstTokenLatencyMs: number;
  tokensPerSecond: number;
  totalWallTimeMs: number;
}

export interface QASession {
  id: string;
  createdAt: number;
  imagePath: string;
  question: string;
  answer: string;
  turns: Array<{ question: string; answer: string }>;
  pinnedExtraction: string | null;
  hiddenEvidence?: HiddenVisualEvidence | null;
  status: QASessionStatus;
  errorMessage: string | null;
  metrics: PerformanceMetrics | null;
  flagged: boolean;
  flagNote: string | null;
}

export type ModelDownloadStatus = 'not_started' | 'downloading' | 'paused' | 'downloaded' | 'failed';

export interface OnDeviceModel {
  modelName: string;
  downloadStatus: ModelDownloadStatus;
  downloadProgress: number;
  integrityVerified: boolean;
  lastVerifiedAt: number | null;
}

export interface DeviceCompatibilityResult {
  isSupported: boolean;
  totalMemoryBytes: number;
  osVersion: string;
  reason: string | null;
}

export type InferenceStatus =
  | 'idle'
  | 'preprocessing'
  | 'loading_model'
  | 'streaming'
  | 'completed'
  | 'cancelled'
  | 'errored';

export interface InferenceRequest {
  imagePath: string;
  question: string;
}

export interface InferenceState {
  status: InferenceStatus;
  response: string;
  metrics: PerformanceMetrics | null;
  error: string | null;
  limitWarning: string | null;
  pinnedExtraction: string | null;
  hiddenEvidence?: HiddenVisualEvidence | null;
  objectiveResult?: ObjectiveInferenceResultRecord | null;
  inferenceTrace?: InferenceTrace | null;
}

export interface ModelState {
  downloadStatus: ModelDownloadStatus;
  downloadProgress: number;
  integrityVerified: boolean;
  error: string | null;
}

export interface MetricsSummary {
  count: number;
  averageModelLoadTimeMs: number;
  averagePreprocessingTimeMs: number;
  averageFirstTokenLatencyMs: number;
  averageTokensPerSecond: number;
  averageTotalWallTimeMs: number;
}
