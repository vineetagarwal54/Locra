// Shared domain types — data-model.md is the source of truth for field shapes.

import type { InferenceTrace } from '../inference/InferenceTrace';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';

export type QASessionStatus = 'streaming' | 'completed' | 'cancelled' | 'errored';
export type ConversationStatus = 'idle' | QASessionStatus;
export type AttachmentKind = 'image';
export type MessageStatus = 'generating' | 'completed' | 'failed' | 'interrupted';

export interface Attachment {
  kind: AttachmentKind;
  path: string;
}

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

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments: Attachment[];
  status: MessageStatus;
  errorMessage: string | null;
  createdAt: number;
}

export interface Conversation {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
  status: ConversationStatus;
  errorMessage: string | null;
  metrics: PerformanceMetrics | null;
  flagged: boolean;
  flagNote: string | null;
}

export interface Draft {
  conversationId: string | null;
  text: string;
  imagePath: string | null;
}

export interface ConversationRuntimeState {
  conversationId: string;
  originatingUserMessageId: string | null;
  assistantMessageId: string | null;
  streamingText: string;
  isOwnerOfActiveInference: boolean;
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
  requestId?: string;
  conversationId?: string;
  originatingUserMessageId?: string;
  assistantMessageId?: string;
  imagePath: string | null;
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
