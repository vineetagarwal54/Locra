import type { ModelRequestMessage } from './ContextBuilder';
import {
  getResponseTokenBudget,
  QWEN_CONTEXT_TOKEN_LIMIT,
  type ResponseMode,
} from './ResponseMode';

const CONTEXT_SAFETY_TOKENS = 128;
const MESSAGE_OVERHEAD_TOKENS = 6;
const IMAGE_RESERVE_TOKENS = 768;

export function estimateMessageTokens(message: ModelRequestMessage): number {
  const textTokens = Math.ceil(message.content.length / 3);
  const imageTokens = message.mediaPath === undefined ? 0 : IMAGE_RESERVE_TOKENS;
  return MESSAGE_OVERHEAD_TOKENS + textTokens + imageTokens;
}

export function trimMessagesToContext(
  messages: ReadonlyArray<ModelRequestMessage>,
  responseMode: ResponseMode,
): ModelRequestMessage[] {
  if (messages.length < 2) {
    return messages.map(cloneMessage);
  }

  const inputBudget = QWEN_CONTEXT_TOKEN_LIMIT
    - getResponseTokenBudget(responseMode)
    - CONTEXT_SAFETY_TOKENS;
  const system = messages[0];
  const currentQuestion = messages.at(-1);
  if (system === undefined || currentQuestion === undefined) {
    return [];
  }

  const boundedQuestion = capMessageToTokenBudget(
    currentQuestion,
    Math.max(0, inputBudget - estimateMessageTokens(system)),
  );
  const selected: ModelRequestMessage[] = [boundedQuestion];
  let used = estimateMessageTokens(system) + estimateMessageTokens(boundedQuestion);
  const history = messages.slice(1, -1);

  for (let index = history.length - 1; index >= 0;) {
    const last = history[index];
    if (last === undefined) break;
    const group = last.role === 'assistant' && history[index - 1]?.role === 'user'
      ? [history[index - 1] as ModelRequestMessage, last]
      : [last];
    const cost = group.reduce((total, message) => total + estimateMessageTokens(message), 0);
    if (used + cost <= inputBudget) {
      selected.unshift(...group.map(cloneMessage));
      used += cost;
    }
    index -= group.length;
  }

  return [cloneMessage(system), ...selected];
}

function cloneMessage(message: ModelRequestMessage): ModelRequestMessage {
  return { ...message };
}

function capMessageToTokenBudget(
  message: ModelRequestMessage,
  maximumTokens: number,
): ModelRequestMessage {
  if (estimateMessageTokens(message) <= maximumTokens) {
    return cloneMessage(message);
  }
  const imageTokens = message.mediaPath === undefined ? 0 : IMAGE_RESERVE_TOKENS;
  const maximumCodeUnits = Math.max(
    0,
    (maximumTokens - MESSAGE_OVERHEAD_TOKENS - imageTokens) * 3,
  );
  let content = message.content.slice(0, maximumCodeUnits);
  const lastCodeUnit = content.charCodeAt(content.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    content = content.slice(0, -1);
  }
  return { ...message, content };
}
