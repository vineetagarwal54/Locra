// ISP-compliant interfaces implemented by the Zustand stores in src/store/ —
// contract tests (tests/contract/*) assert against these, mirroring the plain
// module contracts in specs/001-camera-vlm-qa/contracts/*.contract.md.

import type {
  Conversation,
  ConversationRuntimeState,
  DeviceCompatibilityResult,
  Draft,
  InferenceRequest,
  InferenceState,
  MetricsSummary,
  ModelState,
} from './models';

export interface IInferenceQueue {
  submit(
    request: InferenceRequest,
    options?: {
      turn?: 'first' | 'followUp';
      canonicalTurns?: Array<{ question: string; answer: string }>;
    }
  ): Promise<void>;
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
  save(conversation: Conversation): void;
  get(id: string): Conversation | null;
  list(limit?: number, offset?: number): Conversation[];
  delete(id: string): void;
  clear(): void;
  setFlag(id: string, flagged: boolean, note?: string): void;
  getMetricsSummary(): MetricsSummary;
}

export interface IConversationStore {
  getConversationRuntimeState(conversationId: string): ConversationRuntimeState | null;
  subscribeToConversation(
    conversationId: string,
    listener: (state: ConversationRuntimeState | null) => void
  ): () => void;
  submit(
    conversationId: string | 'new',
    request: { question: string; imagePath: string | null }
  ): Promise<{
    conversationId: string;
    originatingUserMessageId: string;
    assistantMessageId: string;
  }>;
  retryFailedMessage(conversationId: string, assistantMessageId: string): Promise<void>;
  cancelActiveGeneration(conversationId: string): void;
  isAnyGenerationInFlight(): boolean;
  getActiveGenerationOwner(): string | null;
  getDraft(conversationId: string | 'new'): Draft;
  setDraftText(conversationId: string | 'new', text: string): void;
  setDraftImage(conversationId: string | 'new', imagePath: string | null): void;
  clearDraft(conversationId: string | 'new'): void;
  startNewConversation(): void;
}
