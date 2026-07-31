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
  | 'coding'
  | 'comparison'
  | 'multi-part-explanation'
  | 'detailed-instructions'
  | 'visual-description'
  | 'visual-extraction'
  | 'long-synthesis'
  | 'continuation'
  | 'structured-extraction';

export type GenerationActualStopReason =
  | 'model-eos'
  | 'semantic-completion'
  | 'emergency-ceiling'
  | 'loop-detected'
  | 'cancelled'
  | 'failed';

export interface GenerationPlan {
  /** Guidance for answer length; reaching it never directly stops generation. */
  readonly targetTokenBudget: number;
  /** Last-resort native ceiling used only to protect the device/runtime. */
  readonly emergencyHardCeilingTokens: number;
  /** Output headroom in which optional content should be shortened and closed cleanly. */
  readonly gracefulCompletionReserveTokens: number;
  /** Compatibility alias for targetTokenBudget. */
  readonly softTargetTokens: number;
  /** Compatibility alias for emergencyHardCeilingTokens. */
  readonly hardSafetyLimitTokens: number;
  readonly samplingProfile: SamplingProfile;
  readonly loopDetectionEligible: boolean;
  readonly diagnosticsId: string;
  readonly taskKind: GenerationTaskKind;
}

export type StructuredVisionRequestKind = 'extraction' | 'extractionRetry';

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
  if (isStructurallyBoundedRequest(question, taskModality)) {
    const target = Math.min(config.answerTargetTokens, mode === 'Low' ? 64 : 96);
    return plan(
      target,
      config.generationLimit,
      'structured-visible-v2',
      'structured-extraction',
      config.generationLimit,
    );
  }
  const requestedTaskKind = classifyRequestedTaskKind(question);
  if (requestedTaskKind !== null) {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      `${requestedTaskKind}-v1`,
      requestedTaskKind,
      config.generationLimit,
    );
  }
  const detailed = classification.requestsDetailedAnswer || hasDetailedRequestCue(question);
  if (detailed) {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      'detailed-prose-v3',
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
    const softTarget = Math.min(config.answerTargetTokens, mode === 'Low' ? 96 : 128);
    return plan(
      softTarget,
      config.generationLimit,
      'visual-description-v3',
      'visual-description',
      config.generationLimit,
    );
  }
  const softTarget = resolveGenerationTarget(mode, classification);
  return plan(
    softTarget,
    config.generationLimit,
    'concise-prose-v4',
    'concise-prose',
    config.generationLimit,
  );
}

export function createGenerationPlanFromTurnPlan(
  mode: ResponseMode,
  taskKind: import('../planning/types').GenerationTaskKind,
): GenerationPlan {
  const config = getResponseModeConfig(mode);
  if (taskKind === 'comparison') {
    return plan(
      config.answerTargetTokens,
      config.generationLimit,
      'turn-plan-comparison-v2',
      'comparison',
      config.generationLimit,
    );
  }
  if (taskKind === 'extraction') {
    return plan(
      Math.min(config.answerTargetTokens, mode === 'High' ? 320 : mode === 'Medium' ? 256 : 160),
      config.generationLimit,
      'turn-plan-visual-extraction-v1',
      'visual-extraction',
      config.generationLimit,
    );
  }
  if (taskKind === 'clarification') {
    return plan(
      Math.min(config.answerTargetTokens, 96),
      config.generationLimit,
      'turn-plan-clarification-v2',
      'concise-prose',
      config.generationLimit,
    );
  }
  const softTarget = Math.min(config.answerTargetTokens, mode === 'Low' ? 96 : 128);
  return plan(
    softTarget,
    config.generationLimit,
    'turn-plan-image-answer-v2',
    'visual-description',
    config.generationLimit,
  );
}

export function createStructuredVisionGenerationPlan(
  kind: StructuredVisionRequestKind,
): GenerationPlan {
  return kind === 'extraction'
    ? plan(
        128,
        192,
        'structured-vision-extraction-v2',
        'structured-extraction',
        192,
      )
    : plan(
        64,
        96,
        'structured-vision-repair-v2',
        'structured-extraction',
        96,
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
  const emergencyHardCeilingTokens = Math.max(
    1,
    Math.min(responseModeMaximum, requestedHardLimit),
  );
  const gracefulCompletionReserveTokens = resolveGracefulCompletionReserve(
    emergencyHardCeilingTokens,
  );
  const targetTokenBudget = Math.max(
    1,
    Math.min(
      requestedSoftTarget,
      Math.max(1, emergencyHardCeilingTokens - gracefulCompletionReserveTokens),
    ),
  );
  return {
    targetTokenBudget,
    emergencyHardCeilingTokens,
    gracefulCompletionReserveTokens,
    softTargetTokens: targetTokenBudget,
    hardSafetyLimitTokens: emergencyHardCeilingTokens,
    samplingProfile: QWEN_VISIBLE_SAMPLING_PROFILE,
    loopDetectionEligible: true,
    diagnosticsId,
    taskKind,
  };
}

function resolveGracefulCompletionReserve(emergencyHardCeilingTokens: number): number {
  if (emergencyHardCeilingTokens <= 2) {
    return 0;
  }
  if (emergencyHardCeilingTokens <= 192) {
    return Math.min(24, emergencyHardCeilingTokens - 1);
  }
  if (emergencyHardCeilingTokens <= 320) {
    return 64;
  }
  if (emergencyHardCeilingTokens <= 640) {
    return 96;
  }
  return Math.min(
    128,
    emergencyHardCeilingTokens - 1,
  );
}

function classifyRequestedTaskKind(question: string): GenerationTaskKind | null {
  if (isComparisonRequest(question)) {
    return 'comparison';
  }
  if (isCodingRequest(question)) {
    return 'coding';
  }
  if (isDetailedInstructionRequest(question)) {
    return 'detailed-instructions';
  }
  if (isMultiPartRequest(question)) {
    return 'multi-part-explanation';
  }
  return null;
}

function isCodingRequest(question: string): boolean {
  return (
    /```/.test(question)
    || /\b(?:write|implement|create|generate|provide|show|refactor|debug|fix|complete|review)\b[\s\S]{0,80}\b(?:code|function|class|method|script|program|query|regex|component|api|typescript|javascript|python|java|kotlin|sql)\b/i
      .test(question)
  );
}

function isComparisonRequest(question: string): boolean {
  return /\b(?:compare|comparison|contrast|versus|vs\.?|differences?|trade-?offs?|pros and cons)\b/i
    .test(question);
}

function isDetailedInstructionRequest(question: string): boolean {
  return (
    /\b(?:step[- ]by[- ]step|detailed instructions?|setup guide|walk me through)\b/i.test(question)
    || /\b(?:how (?:do|can|should) i|how to)\b[\s\S]{0,100}\b(?:install|configure|set up|build|deploy|migrate|repair|troubleshoot)\b/i
      .test(question)
    || /\b(?:instructions?|guide)\b[\s\S]{0,80}\b(?:install|configure|set up|build|deploy|migrate|repair|troubleshoot)\b/i
      .test(question)
  );
}

function isMultiPartRequest(question: string): boolean {
  if ((question.match(/\?/g) ?? []).length >= 2) {
    return true;
  }
  if (/\b(?:address|answer|cover|explain|describe)\s+(?:all|each|both|the following)\b/i.test(question)) {
    return true;
  }
  const asksForExplanation = /\b(?:address|answer|cover|explain|describe|include)\b/i.test(question);
  const commaSeparatedItems = (question.match(/,/g) ?? []).length >= 2;
  return asksForExplanation && commaSeparatedItems && /\b(?:and|plus)\b/i.test(question);
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
