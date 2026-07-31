export const OBJECTIVE_INFERENCE_RESULT_RECORD_FIELDS = [
  'answerText',
  'perceptionLatencyMs',
  'answerTtftMs',
  'answerGenerationLatencyMs',
  'totalEndToEndLatencyMs',
  'generatedTokens',
  'extractionGeneratedTokens',
  'visibleGeneratedTokens',
  'extractionSchemaMode',
  'extractionSchemaVersion',
  'extractionAttemptLimitsTokens',
  'promptTokens',
  'estimatedPromptTokens',
  'finalNativePromptTokens',
  'targetTokenBudget',
  'emergencyHardCeilingTokens',
  'semanticCompletionReached',
  'gracefulCompletionModeEntered',
  'actualStopReason',
  'softTargetTokens',
  'responseModeHardMaximum',
  'effectiveNativeGenerationLimit',
  'generationPlanId',
  'generationTaskKind',
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
  extractionGeneratedTokens?: number;
  visibleGeneratedTokens?: number;
  extractionSchemaMode?: import('./InferenceEngineHandle').StructuredOutputSchemaMode;
  extractionSchemaVersion?: string | null;
  extractionAttemptLimitsTokens?: readonly number[];
  promptTokens?: number;
  estimatedPromptTokens?: number;
  finalNativePromptTokens?: number;
  targetTokenBudget?: number;
  emergencyHardCeilingTokens?: number;
  semanticCompletionReached?: boolean;
  gracefulCompletionModeEntered?: boolean;
  actualStopReason?: import('./GenerationTuning').GenerationActualStopReason;
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
  softTargetTokens?: number;
  responseModeHardMaximum?: number;
  effectiveNativeGenerationLimit?: number;
  generationPlanId?: string;
  generationTaskKind?: import('./GenerationTuning').GenerationTaskKind;
  samplingProfile?: import('./GenerationTuning').SamplingProfile;
}
