export const GENERATION_CONFIG_IDS = [
  'qwen3-vl-2b-instruct-v1',
] as const;

export type GenerationConfigId = (typeof GENERATION_CONFIG_IDS)[number];

export const CURRENT_GENERATION_CONFIG_ID: GenerationConfigId = 'qwen3-vl-2b-instruct-v1';

export const PIPELINE_VARIANT_IDS = [
  'baseline-current',
  'recommended-sampling-v1',
  'two-stage-v1',
] as const;

export type PipelineVariantId = (typeof PIPELINE_VARIANT_IDS)[number];

export const CURRENT_PIPELINE_VARIANT_ID: PipelineVariantId = 'recommended-sampling-v1';

/**
 * App-level output cap (there is no native max-tokens setting to configure on
 * this library version). Once the engine reports this many generated tokens
 * mid-stream, InferenceQueue stops generation and completes with the partial
 * answer plus a visible notice.
 */
export const TRUNCATED_ANSWER_NOTICE =
  'This answer may have been cut off before it finished.';

export const LOOPING_ANSWER_NOTICE =
  'This answer started repeating itself, so Locra trimmed it.';
