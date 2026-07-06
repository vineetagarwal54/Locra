export const RESPONSE_TOKEN_BUDGET = 1536;
export const RESPONSE_LIMIT_WARNING_TOKEN_THRESHOLD = Math.floor(RESPONSE_TOKEN_BUDGET * 0.9);

export const RESPONSE_LIMIT_WARNING_MESSAGE =
  'This answer may be shortened because the photo or chat is close to the model context limit.';

export function getResponseLimitWarning(generatedTokenCount: number): string | null {
  return generatedTokenCount >= RESPONSE_LIMIT_WARNING_TOKEN_THRESHOLD
    ? RESPONSE_LIMIT_WARNING_MESSAGE
    : null;
}
