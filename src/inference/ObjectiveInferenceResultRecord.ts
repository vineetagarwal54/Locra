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
}
