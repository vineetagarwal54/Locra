import type { RequestClassification } from './RequestClassifier';
import { getResponseModeConfig, type ResponseMode } from './ResponseMode';

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

export interface GenerationPlan {
  readonly softTarget: number;
  readonly effectiveHardLimit: number;
  readonly samplingProfile: SamplingProfile;
  readonly loopDetectionEligible: boolean;
  readonly diagnosticsId:
    | 'concise-text-v1'
    | 'concise-image-identification-v1'
    | 'bounded-visual-extraction-v1'
    | 'detailed-v1'
    | 'long-synthesis-v1';
  readonly detailed: boolean;
}

export function createGenerationPlan(
  mode: ResponseMode,
  question: string,
  classification: RequestClassification,
  taskModality: 'text' | 'image',
): GenerationPlan {
  const config = getResponseModeConfig(mode);
  const detailed = classification.requestsDetailedAnswer || hasDetailedRequestCue(question);
  if (detailed) {
    return plan(config.answerTargetTokens, config.generationLimit, 'detailed-v1', true);
  }
  if (classification.isLongContextRetrievalRequest || classification.isCrossChatEligible) {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      'long-synthesis-v1',
      true,
    );
  }
  if (taskModality === 'image' && isVisualExtractionRequest(question, classification)) {
    return plan(
      Math.min(config.answerTargetTokens, mode === 'High' ? 320 : mode === 'Medium' ? 256 : 160),
      Math.min(config.generationLimit, mode === 'High' ? 512 : mode === 'Medium' ? 384 : 256),
      'bounded-visual-extraction-v1',
      false,
    );
  }
  if (taskModality === 'image') {
    return plan(
      Math.min(config.answerTargetTokens, mode === 'Low' ? 96 : 128),
      Math.min(config.generationLimit, mode === 'Low' ? 128 : 192),
      'concise-image-identification-v1',
      false,
    );
  }
  return plan(
    resolveGenerationTarget(mode, classification),
    Math.min(config.generationLimit, mode === 'Low' ? 128 : mode === 'Medium' ? 160 : 192),
    'concise-text-v1',
    false,
  );
}

export function resolveGenerationTarget(
  mode: ResponseMode,
  classification: RequestClassification,
): number {
  const configuredTarget = getResponseModeConfig(mode).answerTargetTokens;
  if (classification.isLongContextRetrievalRequest) {
    return configuredTarget;
  }
  if (classification.isIndependentTextQuestion) {
    return Math.min(configuredTarget, mode === 'High' ? 160 : mode === 'Medium' ? 128 : 96);
  }
  if (
    classification.isTextFollowUp
    && !classification.isPixelDependent
    && !classification.isNewImageQuestion
    && !classification.isSameImageFollowUp
    && !classification.isOlderImageReference
  ) {
    return Math.min(configuredTarget, mode === 'High' ? 256 : mode === 'Medium' ? 192 : 128);
  }
  return configuredTarget;
}

function plan(
  softTarget: number,
  effectiveHardLimit: number,
  diagnosticsId: GenerationPlan['diagnosticsId'],
  detailed: boolean,
): GenerationPlan {
  return {
    softTarget,
    effectiveHardLimit,
    samplingProfile: QWEN_VISIBLE_SAMPLING_PROFILE,
    loopDetectionEligible: true,
    diagnosticsId,
    detailed,
  };
}

function hasDetailedRequestCue(question: string): boolean {
  return /\b(?:step[- ]by[- ]step|comprehensive|in[- ]depth|detailed|thorough|explain all|cover all|include examples?|every (?:detail|item|step|option)|full (?:explanation|breakdown|comparison))\b/i
    .test(question);
}

function isVisualExtractionRequest(
  question: string,
  classification: RequestClassification,
): boolean {
  return classification.isPixelDependent || (
    /\b(?:read|transcribe|extract|list|count|how many|serial|code|date|price|total|label)\b/i
      .test(question) &&
    classification.hasVisualReference
  );
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
