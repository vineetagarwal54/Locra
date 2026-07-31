import type { GenerationFinishReason, InferenceState } from '../types/models';

import type { ModelRequestMessage } from './ContextBuilder';
import type {
  GenerationTaskKind,
  SamplingProfile,
} from './GenerationTuning';

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
  /** Deterministic estimator count before native reconciliation, when available. */
  getEstimatedPromptTokenCount?(): number | null;
  /** Final formatted native count proven to fit before completion, when available. */
  getFinalNativePromptTokenCount?(): number | null;
  /** Prompt + generated tokens consumed by the current/last generation. */
  getTotalTokenCount(): number;
  /** Why the last generation stopped, or null before any generation. */
  getFinishReason?(): GenerationFinishReason | null;
  /** Warning when the last generation's input was shortened to fit, or null. */
  getInputShortenedWarning?(): string | null;
  getSamplingProfile?(): SamplingProfile | null;
  getGenerationDiagnostics?(): GenerationRuntimeDiagnostics | null;
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
  /** Effective output cap selected for this task; passed to native `n_predict`. */
  softTargetTokens?: number;
  hardSafetyLimitTokens?: number;
  gracefulCompletionReserveTokens?: number;
  generationPlanId?: string;
  generationTaskKind?: GenerationTaskKind;
  loopDetectionEligible?: boolean;
  /** Request-scoped native phase events used only for latency diagnostics. */
  onRuntimeStage?: (event: GenerationRuntimeStageEvent) => void;
}

export interface EngineGenerateResult {
  response: string;
  tokenCount: number;
  promptTokenCount?: number;
  estimatedPromptTokenCount?: number;
  finalNativePromptTokenCount?: number;
  totalTokenCount?: number;
  pinnedExtraction?: string | null;
  hiddenEvidence?: InferenceState['hiddenEvidence'];
  /** Why generation stopped; `length` marks an output-cap (truncated) stop. */
  finishReason?: GenerationFinishReason | null;
  /** Set when the supplied input was shortened to fit the context window. */
  inputShortenedWarning?: string | null;
  samplingProfile?: SamplingProfile | null;
  generationDiagnostics?: GenerationRuntimeDiagnostics | null;
}

export interface GenerationRuntimeDiagnostics {
  readonly targetTokenBudget?: number;
  readonly emergencyHardCeilingTokens?: number;
  readonly semanticCompletionReached?: boolean;
  readonly gracefulCompletionModeEntered?: boolean;
  readonly actualStopReason?: import('./GenerationTuning').GenerationActualStopReason;
  readonly responseModeHardMaximum: number;
  readonly effectiveNativeGenerationLimit: number;
  readonly softTargetTokens: number;
  readonly generationPlanId: string;
  readonly taskKind: GenerationTaskKind;
}

export type GenerationRuntimeStage =
  | 'prompt-formatting'
  | 'prompt-tokenization'
  | 'media-tokenization'
  | 'prefill'
  | 'generation';

export interface GenerationRuntimeStageEvent {
  readonly stage: GenerationRuntimeStage;
  readonly status: 'started' | 'completed';
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
