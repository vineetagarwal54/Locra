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

export function getResponseTokenBudget(mode: ResponseMode): number {
  return getResponseModeConfig(mode).answerTargetTokens;
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

export function getResponseModeInstruction(mode: ResponseMode): string {
  const detail = mode === 'Low'
    ? 'Be concise and focus only on the essential answer.'
    : mode === 'High'
      ? 'Give a thorough answer with useful detail and steps where appropriate.'
      : 'Give a balanced answer with the key explanation and useful details.';
  return `${detail} Finish the answer cleanly within ${getResponseTokenBudget(mode)} tokens; prioritize completeness over adding another section.`;
}
