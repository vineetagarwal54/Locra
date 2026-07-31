export const RESPONSE_MODES = ['Low', 'Medium', 'High'] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];
export type StoredResponseMode = 'low' | 'medium' | 'high';

export interface ResponseModeConfig {
  readonly recentExactTurns: number;
  /** Tier-1 estimated tokens available to the selected-context pool. */
  readonly contextBudgetUnits: number;
  readonly sameChatRetrievalLimit: number;
  readonly answerTargetTokens: number;
  readonly generationLimit: number;
}

export const DEFAULT_RESPONSE_MODE: ResponseMode = 'Medium';
export const QWEN_CONTEXT_TOKEN_LIMIT = 4096;

const RESPONSE_MODE_CONFIGS: Readonly<Record<ResponseMode, ResponseModeConfig>> = {
  Low: {
    recentExactTurns: 6,
    contextBudgetUnits: 1_334,
    sameChatRetrievalLimit: 2,
    answerTargetTokens: 192,
    generationLimit: 320,
  },
  Medium: {
    recentExactTurns: 10,
    contextBudgetUnits: 2_334,
    sameChatRetrievalLimit: 4,
    answerTargetTokens: 384,
    generationLimit: 640,
  },
  High: {
    recentExactTurns: 16,
    contextBudgetUnits: 3_667,
    sameChatRetrievalLimit: 6,
    answerTargetTokens: 768,
    generationLimit: 1_024,
  },
};

export function isResponseMode(value: string): value is ResponseMode {
  return RESPONSE_MODES.some((mode) => mode === value);
}

/**
 * Prompt-level soft target for how long an answer should aim to be. This is the
 * length the model is *asked* to aim for — never the hard stop. The hard stop is
 * {@link getResponseGenerationLimit}, wired to the runtime's `n_predict`.
 */
export function getResponseTokenBudget(mode: ResponseMode): number {
  return getResponseModeConfig(mode).answerTargetTokens;
}

/**
 * Emergency output ceiling handed to the Qwen runtime as `n_predict`.
 * Generation cannot exceed it. Reaching it is reported as length-truncated only
 * when the emitted answer has not reached semantic/structural completion.
 * Always >= the soft {@link getResponseTokenBudget}.
 */
export function getResponseGenerationLimit(mode: ResponseMode): number {
  return getResponseModeConfig(mode).generationLimit;
}

export function getResponseModeConfig(mode: ResponseMode): ResponseModeConfig {
  return RESPONSE_MODE_CONFIGS[mode];
}

export function toStoredMode(mode: ResponseMode): StoredResponseMode {
  if (mode === 'Low') {
    return 'low';
  }
  if (mode === 'High') {
    return 'high';
  }
  return 'medium';
}

export function fromStoredMode(value: string): ResponseMode {
  if (value === 'low') {
    return 'Low';
  }
  if (value === 'high') {
    return 'High';
  }
  return 'Medium';
}

export function getResponseModeInstruction(
  mode: ResponseMode,
  config: ResponseModeConfig = getResponseModeConfig(mode),
): string {
  const detail = MODE_INSTRUCTIONS[mode];
  // answerTargetTokens is a SOFT target: the model should aim for roughly this
  // length but must never pad to reach it, and must finish the current sentence
  // or section cleanly rather than stop mid-thought as it approaches the length.
  return (
    `${detail} Aim for roughly ${config.answerTargetTokens} tokens as a soft target, ` +
    'not a quota — never add filler, repetition, or extra sections just to reach it. ' +
    'Complete every item and structure the user requested, including closing lists, code ' +
    'blocks, and structured data. If output space is running low, omit optional detail, ' +
    'compress the remaining required points, and finish the current sentence, paragraph, ' +
    'and section cleanly.'
  );
}

const MODE_INSTRUCTIONS: Readonly<Record<ResponseMode, string>> = {
  Low:
    'Answer in the briefest useful form. Give the direct answer first and include only ' +
    'the essential reasoning. Skip introductions, restating the question, repetition, ' +
    'optional details, and unnecessary sections. Use at most a few short bullets when they ' +
    'genuinely help.',
  Medium:
    'Give the direct answer, then the key explanation and any actionable steps. Include ' +
    'context that is genuinely useful, but leave out repetition, filler, and unrelated edge ' +
    'cases.',
  High:
    'Give a comprehensive, well-structured answer: the direct answer, the relevant reasoning ' +
    'and steps, any assumptions you make, and the important edge cases. Stay focused on the ' +
    'question and do not add sections merely to make the response longer.',
};
