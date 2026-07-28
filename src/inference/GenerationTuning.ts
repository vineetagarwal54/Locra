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

export type GenerationTaskKind =
  | 'concise-prose'
  | 'detailed-prose'
  | 'visual-description'
  | 'visual-extraction'
  | 'long-synthesis'
  | 'continuation'
  | 'structured-extraction';

export interface GenerationPlan {
  readonly softTargetTokens: number;
  readonly hardSafetyLimitTokens: number;
  readonly samplingProfile: SamplingProfile;
  readonly loopDetectionEligible: boolean;
  readonly diagnosticsId: string;
  readonly taskKind: GenerationTaskKind;
}

export function createGenerationPlan(
  mode: ResponseMode,
  question: string,
  classification: RequestClassification,
  taskModality: 'text' | 'image',
  explicitTaskKind?: GenerationTaskKind,
): GenerationPlan {
  const config = getResponseModeConfig(mode);
  if (explicitTaskKind === 'continuation') {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      'continuation-v1',
      'continuation',
      config.generationLimit,
    );
  }
  const detailed = classification.requestsDetailedAnswer || hasDetailedRequestCue(question);
  if (detailed) {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      'detailed-prose-v2',
      'detailed-prose',
      config.generationLimit,
    );
  }
  if (classification.isLongContextRetrievalRequest || classification.isCrossChatEligible) {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      'long-synthesis-v2',
      'long-synthesis',
      config.generationLimit,
    );
  }
  if (isStructurallyBoundedRequest(question, taskModality)) {
    const softTarget = Math.min(config.answerTargetTokens, mode === 'Low' ? 64 : 96);
    return plan(
      softTarget,
      Math.min(config.generationLimit, softTarget + 128),
      'structured-extraction-v1',
      'structured-extraction',
      config.generationLimit,
    );
  }
  if (taskModality === 'image' && isVisualExtractionRequest(question, classification)) {
    return plan(
      Math.min(config.answerTargetTokens, mode === 'High' ? 320 : mode === 'Medium' ? 256 : 160),
      config.generationLimit,
      'visual-extraction-v2',
      'visual-extraction',
      config.generationLimit,
    );
  }
  if (taskModality === 'image') {
    return plan(
      Math.min(config.answerTargetTokens, mode === 'Low' ? 96 : 128),
      config.generationLimit,
      'visual-description-v2',
      'visual-description',
      config.generationLimit,
    );
  }
  return plan(
    resolveGenerationTarget(mode, classification),
    config.generationLimit,
    'concise-prose-v2',
    'concise-prose',
    config.generationLimit,
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
  requestedSoftTarget: number,
  requestedHardLimit: number,
  diagnosticsId: string,
  taskKind: GenerationTaskKind,
  responseModeMaximum: number,
): GenerationPlan {
  const hardSafetyLimitTokens = Math.max(
    1,
    Math.min(responseModeMaximum, requestedHardLimit),
  );
  const requiredHeadroom = Math.min(128, Math.max(0, hardSafetyLimitTokens - 1));
  const softTargetTokens = Math.max(
    1,
    Math.min(requestedSoftTarget, hardSafetyLimitTokens - requiredHeadroom),
  );
  return {
    softTargetTokens,
    hardSafetyLimitTokens,
    samplingProfile: QWEN_VISIBLE_SAMPLING_PROFILE,
    loopDetectionEligible: true,
    diagnosticsId,
    taskKind,
  };
}

function isStructurallyBoundedRequest(
  question: string,
  taskModality: 'text' | 'image',
): boolean {
  const normalized = question.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(?:yes or no|one word|single word)\b/.test(normalized)) {
    return true;
  }
  if (
    /\b(?:return|output|respond with)\b.*\bjson\b.*\b(?:fields?|keys?|schema)\b/
      .test(normalized)
  ) {
    return true;
  }
  if (/\b(?:exactly|at most|no more than)\s+\d+\s+(?:items?|values?|words?|bullets?|lines?)\b/.test(normalized)) {
    return true;
  }
  return taskModality === 'image' &&
    /\b(?:what is|read|give|report)\s+(?:the\s+)?(?:single|one)\s+(?:visible\s+)?(?:value|date|serial number|code)\b/
      .test(normalized);
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
