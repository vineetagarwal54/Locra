export const RESPONSE_MODES = ['Low', 'Medium', 'High'] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];
export type StoredResponseMode = 'low' | 'medium' | 'high';

export interface ResponseModeConfig {
  readonly recentExactTurns: number;
  /** Character units measured by CharacterContextBudgetPolicy. */
  readonly contextBudgetUnits: number;
  readonly sameChatRetrievalLimit: number;
  readonly selectedChatRetrievalLimit: number;
  readonly answerTargetTokens: number;
  readonly generationLimit: number;
}

export const DEFAULT_RESPONSE_MODE: ResponseMode = 'Medium';
export const QWEN_CONTEXT_TOKEN_LIMIT = 4096;

const RESPONSE_MODE_CONFIGS: Readonly<Record<ResponseMode, ResponseModeConfig>> = {
  Low: {
    recentExactTurns: 6,
    contextBudgetUnits: 4_000,
    sameChatRetrievalLimit: 2,
    selectedChatRetrievalLimit: 1,
    answerTargetTokens: 192,
    generationLimit: 320,
  },
  Medium: {
    recentExactTurns: 10,
    contextBudgetUnits: 7_000,
    sameChatRetrievalLimit: 4,
    selectedChatRetrievalLimit: 3,
    answerTargetTokens: 384,
    generationLimit: 640,
  },
  High: {
    recentExactTurns: 16,
    contextBudgetUnits: 11_000,
    sameChatRetrievalLimit: 6,
    selectedChatRetrievalLimit: 5,
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
 * Hard output cap handed to the Qwen runtime as `n_predict`. Generation cannot
 * exceed this; when it is reached the answer is reported as length-truncated.
 * Always >= the soft {@link getResponseTokenBudget} so the model has room to
 * finish the current sentence/section past its soft target.
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
    'Finish the current sentence and section cleanly rather than stopping mid-thought.'
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
