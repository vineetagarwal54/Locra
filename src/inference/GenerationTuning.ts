export const GENERATION_CONFIG_IDS = [
  'lfm2-vl-preset',
  'recommended-lfm2-vl-v1',
] as const;

export type GenerationConfigId = (typeof GENERATION_CONFIG_IDS)[number];

export const CURRENT_GENERATION_CONFIG_ID: GenerationConfigId = 'recommended-lfm2-vl-v1';

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
export const OUTPUT_TOKEN_BUDGET = 640;

export const OUTPUT_LIMIT_NOTICE =
  'Locra reached its length limit here - ask it to keep going for more.';

export const TRUNCATED_ANSWER_NOTICE =
  'This answer may have been cut off before it finished.';

export const LOOPING_ANSWER_NOTICE =
  'This answer started repeating itself, so Locra trimmed it.';
