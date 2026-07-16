// Shared domain types — data-model.md is the source of truth for field shapes.

import type { InferenceTrace } from '../inference/InferenceTrace';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';

export type QASessionStatus = 'streaming' | 'completed' | 'cancelled' | 'errored';
export type ConversationStatus = 'idle' | QASessionStatus;
export type AttachmentKind = 'image';
export type MessageStatus = 'generating' | 'completed' | 'failed' | 'interrupted';

/**
 * Why a generation stopped.
 * - `natural`: the model emitted a stop token / finished on its own.
 * - `length`: the hard `n_predict` output cap was reached — the answer is truncated
 *   and can be continued.
 * - `cancelled`: the user stopped generation.
 * - `failed`: generation errored before finishing.
 */
export type GenerationFinishReason = 'natural' | 'length' | 'cancelled' | 'failed';

export interface Attachment {
  kind: AttachmentKind;
  path: string;
  available?: boolean;
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
  /**
   * Assistant-only. Why generation stopped; `length` marks a truncated answer the
   * user can continue. Absent/null on user messages and older persisted rows.
   */
  finishReason?: GenerationFinishReason | null;
}

export interface Conversation {
  id: string;
  title?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ConversationMessage[];
  status: ConversationStatus;
  errorMessage: string | null;
  metrics: PerformanceMetrics | null;
  flagged: boolean;
  flagNote: string | null;
  contextMemory?: ConversationContextMemory | null;
  responseMode?: import('../inference/ResponseMode').ResponseMode;
  latestMessagePreview?: string | null;
  hasImage?: boolean;
}

export interface CanonicalContextTurn {
  readonly question: string;
  readonly answer: string | null;
}

export type ContextEvidenceModality = 'image' | 'screenshot' | 'document';

export interface ContextMediaEvidence {
  readonly version: 'context-media-evidence-v1';
  readonly id: string;
  readonly sourceMessageId: string;
  readonly modality: ContextEvidenceModality;
  readonly sourcePath: string;
  readonly summary: string;
  readonly facts: ReadonlyArray<string>;
  readonly extractedText: ReadonlyArray<string>;
  readonly uncertainty: ReadonlyArray<string>;
  readonly createdAt: number;
}

export interface ContextMemoryFact {
  readonly version: 'context-memory-fact-v1';
  readonly id: string;
  readonly sourceMessageId: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface ContextSummaryEntry {
  readonly version: 'context-summary-entry-v1';
  readonly sourceUserMessageId: string;
  readonly sourceAssistantMessageId: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface ContextRollingSummary {
  readonly version: 'rolling-summary-v1';
  readonly coveredThroughMessageId: string;
  readonly sourceMessageIds: ReadonlyArray<string>;
  readonly entries: ReadonlyArray<ContextSummaryEntry>;
}

export interface ConversationContextMemory {
  readonly version: 'conversation-context-memory-v1';
  readonly sourceMessageCount: number;
  readonly rollingSummary: ContextRollingSummary | null;
  readonly importantFacts: ReadonlyArray<ContextMemoryFact>;
  readonly mediaEvidence: ReadonlyArray<ContextMediaEvidence>;
}

export interface CanonicalConversationSnapshot {
  readonly version: 'canonical-conversation-snapshot-v1';
  readonly conversationId: string;
  readonly priorMessages: ReadonlyArray<ConversationMessage>;
  readonly currentMessage: ConversationMessage;
  readonly contextMemory: ConversationContextMemory | null;
}

export interface ContextBudgetMetadata {
  readonly policyId: string;
  readonly maximumUnits: number;
  readonly usedUnits: number;
}

export interface CanonicalConversationContext {
  readonly version: 'canonical-conversation-v2';
  readonly recentTurns: ReadonlyArray<CanonicalContextTurn>;
  readonly mediaEvidence: ReadonlyArray<ContextMediaEvidence>;
  readonly importantFacts: ReadonlyArray<ContextMemoryFact>;
  readonly olderSummary: string | null;
  readonly budget: ContextBudgetMetadata;
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
  /**
   * Transient notice about the most recent turn in this conversation — e.g. the
   * input was shortened to fit, or the answer was cut off. Cleared when the next
   * generation starts. Not persisted; durable truncation is read from the
   * assistant message's `finishReason`.
   */
  limitWarning?: string | null;
}

export type ModelDownloadStatus = 'not_started' | 'downloading' | 'paused' | 'downloaded' | 'failed';
export type ModelSetupPhase =
  | 'checking'
  | 'not_installed'
  | 'preparing'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'failed';

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
  // A stop was requested but the native generation and resource lease have not
  // settled yet; no new generation may start until this clears to 'idle'.
  | 'cancelling'
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
  /** Why the generation stopped; null until a terminal state resolves it. */
  finishReason?: GenerationFinishReason | null;
  pinnedExtraction: string | null;
  hiddenEvidence?: HiddenVisualEvidence | null;
  objectiveResult?: ObjectiveInferenceResultRecord | null;
  inferenceTrace?: InferenceTrace | null;
}

export interface ModelState {
  setupPhase: ModelSetupPhase;
  downloadStatus: ModelDownloadStatus;
  downloadProgress: number;
  verificationProgress: number;
  verificationArtifactProgress: number;
  verificationArtifactName: string | null;
  canRetryVerification: boolean;
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

// ---------------------------------------------------------------------------
// Spec 006 — SQL canonical store entity types (data-model.md).
// These describe rows in the SQLite store; they are separate from the legacy
// MMKV in-memory shapes above, which remain for the existing pipeline.
// ---------------------------------------------------------------------------

/** Response mode as stored in SQL (lowercase). Runtime union is `ResponseMode`. */
export type StoredResponseMode = 'low' | 'medium' | 'high';

export type MessageRole = 'user' | 'assistant';

/** Lifecycle status of a message row: 'submitted' for user rows; the rest for assistant attempts. */
export type AttemptStatus = 'submitted' | 'generating' | 'completed' | 'failed' | 'interrupted';

export interface ConversationRow {
  id: string;
  title: string | null;
  normalized_title: string | null;
  response_mode: StoredResponseMode;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  latest_message_preview: string | null;
  has_image: number;
}

/** Kind of a benchmarked turn: image turns include preparation time, text turns don't. */
export type BenchmarkKind = 'text' | 'image';

/** One SUCCESSFULLY completed assistant attempt's timings (user-facing Benchmarks). */
export interface BenchmarkRunRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  kind: BenchmarkKind;
  model_load_time_ms: number;
  preprocessing_time_ms: number;
  first_token_latency_ms: number;
  tokens_per_second: number;
  total_wall_time_ms: number;
  created_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: MessageRole;
  /** Assistant attempt → source user message; NULL for user rows. */
  reply_to_message_id: string | null;
  /** Assistant only; 1-based per source user message. */
  attempt_number: number | null;
  /** Assistant only; 1 = canonical visible attempt. */
  is_active_attempt: number;
  text: string;
  status: AttemptStatus;
  error_message: string | null;
  /** Assistant-only; why generation stopped (`length` = truncated). NULL otherwise. */
  finish_reason: GenerationFinishReason | null;
  finalized_at: number | null;
  created_at: number;
}

export interface ImageAssetRow {
  id: string;
  conversation_id: string;
  local_path: string;
  available: number;
  content_hash: string | null;
  created_at: number;
}

export interface MessageImageRow {
  message_id: string;
  image_asset_id: string;
  ordinal: number;
  created_at: number;
}

export interface VisualEvidenceRow {
  id: string;
  conversation_id: string;
  source_message_id: string;
  image_asset_id: string;
  evidence_version: string;
  subject_object: string;
  visible_features_json: string;
  visible_text_json: string;
  visible_condition: string;
  uncertainty_json: string;
  source_revision: string;
  created_at: number;
}

export interface ChunkRow {
  id: string;
  conversation_id: string;
  source_message_id: string;
  image_asset_id: string | null;
  chunk_version: string;
  ordinal: number;
  start_offset: number;
  end_offset: number;
  text: string;
  source_revision: string;
  created_at: number;
}

export type EmbeddingState = 'pending' | 'ready' | 'stale' | 'failed' | 'rebuilding';

export interface EmbeddingRow {
  id: string;
  conversation_id: string;
  chunk_id: string | null;
  message_id: string | null;
  evidence_id: string | null;
  fact_id: string | null;
  model_id: string;
  model_artifact_hash: string;
  embedding_version: string;
  dimensions: number;
  source_revision: string;
  vector: Uint8Array;
  state: EmbeddingState;
  created_at: number;
  updated_at: number;
}

export type SummaryStatus = 'ready' | 'stale' | 'superseded' | 'failed';

export interface SummaryRow {
  id: string;
  conversation_id: string;
  first_source_message_id: string;
  last_source_message_id: string;
  source_view_hash: string;
  summarizer_version: string;
  text: string;
  status: SummaryStatus;
  version: number;
  created_at: number;
  updated_at: number;
}

export type DurableFactStatus = 'ready' | 'stale' | 'superseded' | 'failed';
export type DurableFactType = 'fact' | 'decision';

export interface DurableFactRow {
  id: string;
  conversation_id: string;
  normalized_key: string;
  value_text: string;
  fact_type: DurableFactType;
  extraction_version: string;
  status: DurableFactStatus;
  supersedes_fact_id: string | null;
  source_view_hash: string;
  created_at: number;
  updated_at: number;
}

export interface DurableFactSourceRow {
  fact_id: string;
  message_id: string;
}
