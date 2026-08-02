/** Stage the turn was in when a cancellation was requested. Observe-only. */
export type CancellationStage =
  | 'preprocessing'
  | 'model_loading'
  | 'perception'
  | 'context_assembly'
  | 'visible_generation';

/**
 * How the image was resolved into inference for a turn. Diagnostics-only; it never
 * influences routing or answer generation. Historical-image selection is currently
 * unsupported, so `source` is only ever `current-attachment` or `none`.
 */
export interface ImageExecutionProvenance {
  /** Whether image pixels were actually supplied to inference for this turn. */
  pixelsSupplied: boolean;
  /** Selected image path or stable asset identifier when available, else null. */
  imageIdentifier: string | null;
  source: 'current-attachment' | 'none';
}

/**
 * Raw native completion signals as reported by llama.rn, recorded verbatim for
 * diagnostics. These do NOT change finish-reason interpretation; each flag is
 * `null` when the native runtime did not expose it.
 */
export interface NativeCompletionDiagnostics {
  stoppedEos: boolean | null;
  stoppedWord: boolean | null;
  stoppedLimit: boolean | null;
  truncated: boolean | null;
  generatedTokenCount: number;
  generationLimit: number;
}

export const OBJECTIVE_INFERENCE_RESULT_RECORD_FIELDS = [
  'answerText',
  'perceptionLatencyMs',
  'answerTtftMs',
  'answerGenerationLatencyMs',
  'totalEndToEndLatencyMs',
  'generatedTokens',
  'promptTokens',
  'truncated',
  'looping',
  'timestamp',
  'modelId',
  'generationConfigId',
  'pipelineVariantId',
  'deviceNameModel',
  'appBuildId',
] as const;

export type ObjectiveInferenceResultRecordField =
  (typeof OBJECTIVE_INFERENCE_RESULT_RECORD_FIELDS)[number];

export interface ObjectiveInferenceResultRecord {
  answerText: string;
  perceptionLatencyMs: number;
  answerTtftMs: number;
  answerGenerationLatencyMs: number;
  totalEndToEndLatencyMs: number;
  generatedTokens: number;
  promptTokens?: number;
  truncated: boolean;
  looping: boolean;
  timestamp: string;
  modelId: string;
  generationConfigId: string;
  pipelineVariantId: string;
  deviceNameModel: string;
  appBuildId: string;
  responseMode?: import('./ResponseMode').ResponseMode;
  targetTokenCount?: number;
  generationLimit?: number;
  samplingProfile?: import('./GenerationTuning').SamplingProfile;
  /** Image execution provenance for this turn (diagnostics-only). */
  imageProvenance?: ImageExecutionProvenance;
  /** Raw native completion signals for this turn (diagnostics-only). */
  nativeCompletion?: NativeCompletionDiagnostics;
}
