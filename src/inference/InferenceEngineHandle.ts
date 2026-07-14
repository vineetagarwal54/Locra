import type { InferenceState } from '../types/models';

import type { ModelRequestMessage } from './ContextBuilder';

/** Plain runtime handle registered by the selected React host. */
export interface InferenceEngineHandle {
  /** Stateless model request. The caller supplies the full bounded context. */
  generate(request: EngineGenerateRequest): Promise<string>;
  /** Interrupts the in-flight generation. */
  cancel(): void;
  /** Cumulative streamed response so far. */
  getResponse(): string;
  /** Whether a generation is currently in flight. */
  isGenerating(): boolean;
  /** Whether the model is loaded and ready to accept a request. */
  isReady(): boolean;
  /** Tokens generated so far in the current generation. */
  getGeneratedTokenCount(): number;
  /** Prompt tokens consumed by the current/last generation. */
  getPromptTokenCount(): number;
  /** Prompt + generated tokens consumed by the current/last generation. */
  getTotalTokenCount(): number;
  /** Runtime-managed history length; expected to stay empty. */
  getMessageHistoryLength(): number;
  /** Clears request-local native state left by older runtime paths. */
  clearHistory(): void;
  /** Human-readable load/generation error, or null. */
  getError(): string | null;
  /** Fires on every streaming-relevant state change; returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface EngineGenerateRequest {
  messages: ModelRequestMessage[];
  responseMode: import('./ResponseMode').ResponseMode;
  kind?: 'extraction' | 'extractionRetry' | 'answer' | 'chat' | 'compaction';
  originalQuestion?: string;
}

export interface EngineGenerateResult {
  response: string;
  tokenCount: number;
  promptTokenCount?: number;
  totalTokenCount?: number;
  pinnedExtraction?: string | null;
  hiddenEvidence?: InferenceState['hiddenEvidence'];
}

/** Runtime-neutral contract consumed by the single-flight inference queue. */
export interface InferenceEngineAdapter {
  loadModel(): Promise<void>;
  generate(
    request: EngineGenerateRequest,
    onToken: (cumulativeResponse: string, generatedTokenCount?: number) => void,
    signal: AbortSignal,
  ): Promise<EngineGenerateResult>;
}
