export const GENERATION_CONFIG_IDS = [
  'qwen3-vl-2b-instruct-v1',
] as const;

export type GenerationConfigId = (typeof GENERATION_CONFIG_IDS)[number];

export const CURRENT_GENERATION_CONFIG_ID: GenerationConfigId = 'qwen3-vl-2b-instruct-v1';

export const PIPELINE_VARIANT_IDS = [
  'baseline-current',
  'qwen-visible-sampling-v2',
  'two-stage-v1',
] as const;

export type PipelineVariantId = (typeof PIPELINE_VARIANT_IDS)[number];

export const CURRENT_PIPELINE_VARIANT_ID: PipelineVariantId = 'qwen-visible-sampling-v2';

export interface SamplingProfile {
  readonly id: string;
  readonly temperature: number;
  readonly topP: number;
  readonly topK: number;
}

/** Qwen's published visible VL sampling values, using llama.rn 0.12.5 names at the native boundary. */
export const QWEN_VISIBLE_SAMPLING_PROFILE: SamplingProfile = {
  id: 'qwen3-vl-visible-official-v1',
  temperature: 0.7,
  topP: 0.8,
  topK: 20,
};

/** Low-variance profile for JSON extraction/compaction; never applied to visible prose. */
export const QWEN_EXTRACTION_SAMPLING_PROFILE: SamplingProfile = {
  id: 'qwen3-vl-structured-extraction-v1',
  temperature: 0,
  topP: 1,
  topK: 1,
};

export function samplingProfileForRequestKind(
  kind: 'extraction' | 'extractionRetry' | 'answer' | 'chat' | 'compaction' | undefined,
): SamplingProfile {
  return kind === 'extraction' || kind === 'extractionRetry' || kind === 'compaction'
    ? QWEN_EXTRACTION_SAMPLING_PROFILE
    : QWEN_VISIBLE_SAMPLING_PROFILE;
}

/**
 * Visible notice used when native `n_predict` or quality assessment shows that
 * an answer ended before completing its thought.
 */
export const TRUNCATED_ANSWER_NOTICE =
  'This answer may have been cut off before it finished.';

export const LOOPING_ANSWER_NOTICE =
  'This answer started repeating itself, so Locra trimmed it.';
