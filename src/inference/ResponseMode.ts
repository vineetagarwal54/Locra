export const RESPONSE_MODES = ['Low', 'Medium', 'High'] as const;

export type ResponseMode = (typeof RESPONSE_MODES)[number];

export const DEFAULT_RESPONSE_MODE: ResponseMode = 'Medium';
export const QWEN_CONTEXT_TOKEN_LIMIT = 4096;

const RESPONSE_TOKEN_BUDGETS: Record<ResponseMode, number> = {
  Low: 192,
  Medium: 384,
  High: 768,
};

export function isResponseMode(value: string): value is ResponseMode {
  return RESPONSE_MODES.some((mode) => mode === value);
}

export function getResponseTokenBudget(mode: ResponseMode): number {
  return RESPONSE_TOKEN_BUDGETS[mode];
}

export function getResponseModeInstruction(mode: ResponseMode): string {
  const detail = mode === 'Low'
    ? 'Be concise and focus only on the essential answer.'
    : mode === 'High'
      ? 'Give a thorough answer with useful detail and steps where appropriate.'
      : 'Give a balanced answer with the key explanation and useful details.';
  return `${detail} Finish the answer cleanly within ${getResponseTokenBudget(mode)} tokens; prioritize completeness over adding another section.`;
}
