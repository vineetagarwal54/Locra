import type { ModelRequestMessage } from './ContextBuilder';
import {
  getResponseGenerationLimit,
  QWEN_CONTEXT_TOKEN_LIMIT,
  type ResponseMode,
} from './ResponseMode';

const CONTEXT_SAFETY_TOKENS = 128;
const MESSAGE_OVERHEAD_TOKENS = 6;
const IMAGE_RESERVE_TOKENS = 768;

/**
 * Inserted where an oversized input was shortened so the user (and the model)
 * can see the middle was removed rather than the message ending abruptly. The
 * beginning and end are preserved because they usually carry the intent and the
 * actual question.
 */
export const INPUT_SHORTENED_MARKER = '\n\n[… input shortened to fit; middle omitted …]\n\n';

export interface BoundedInput {
  readonly messages: ModelRequestMessage[];
  /** Set when the current question was shortened to fit the context window. */
  readonly inputShortenedWarning: string | null;
}

export function estimateMessageTokens(message: ModelRequestMessage): number {
  const textTokens = Math.ceil(message.content.length / 3);
  const imageTokens = message.mediaPath === undefined ? 0 : IMAGE_RESERVE_TOKENS;
  return MESSAGE_OVERHEAD_TOKENS + textTokens + imageTokens;
}

export function trimMessagesToContext(
  messages: ReadonlyArray<ModelRequestMessage>,
  responseMode: ResponseMode,
): ModelRequestMessage[] {
  return trimMessagesToContextWithReport(messages, responseMode).messages;
}

/**
 * Same trimming as {@link trimMessagesToContext} but also reports whether the
 * current question had to be shortened to fit, so callers can surface a clear
 * input-shortened warning to the user.
 */
export function trimMessagesToContextWithReport(
  messages: ReadonlyArray<ModelRequestMessage>,
  responseMode: ResponseMode,
): BoundedInput {
  if (messages.length < 2) {
    return { messages: messages.map(cloneMessage), inputShortenedWarning: null };
  }

  // Reserve the HARD output cap (n_predict), not the soft target, so the model
  // always has room to generate a full-length answer without overflowing nCtx.
  const inputBudget = QWEN_CONTEXT_TOKEN_LIMIT
    - getResponseGenerationLimit(responseMode)
    - CONTEXT_SAFETY_TOKENS;
  const system = messages[0];
  const currentQuestion = messages.at(-1);
  if (system === undefined || currentQuestion === undefined) {
    return { messages: [], inputShortenedWarning: null };
  }

  const capped = capMessageToTokenBudget(
    currentQuestion,
    Math.max(0, inputBudget - estimateMessageTokens(system)),
  );
  const boundedQuestion = capped.message;
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

  return {
    messages: [cloneMessage(system), ...selected],
    inputShortenedWarning: capped.shortened
      ? 'Your message was long, so Locra kept the beginning and end and trimmed the middle to fit.'
      : null,
  };
}

function cloneMessage(message: ModelRequestMessage): ModelRequestMessage {
  return { ...message };
}

interface CappedMessage {
  readonly message: ModelRequestMessage;
  readonly shortened: boolean;
}

/**
 * Caps one message to a token budget while preserving BOTH the beginning and the
 * end of its content — a long paste usually carries the intent up front and the
 * actual question at the end, and silently dropping the tail (the old behavior)
 * routinely cut off the real question. When shortening is needed the middle is
 * removed and a visible marker inserted. Surrogate pairs are never split.
 */
function capMessageToTokenBudget(
  message: ModelRequestMessage,
  maximumTokens: number,
): CappedMessage {
  if (estimateMessageTokens(message) <= maximumTokens) {
    return { message: cloneMessage(message), shortened: false };
  }
  const imageTokens = message.mediaPath === undefined ? 0 : IMAGE_RESERVE_TOKENS;
  const maximumCodeUnits = Math.max(
    0,
    (maximumTokens - MESSAGE_OVERHEAD_TOKENS - imageTokens) * 3,
  );

  const content = message.content;
  const markerUnits = INPUT_SHORTENED_MARKER.length;
  if (maximumCodeUnits <= markerUnits) {
    // Not even room for head + marker + tail: fall back to a safe head slice.
    return {
      message: { ...message, content: sliceHeadOnSurrogateBoundary(content, maximumCodeUnits) },
      shortened: true,
    };
  }

  const keepUnits = maximumCodeUnits - markerUnits;
  const headUnits = Math.ceil(keepUnits / 2);
  const tailUnits = keepUnits - headUnits;
  const head = sliceHeadOnSurrogateBoundary(content, headUnits);
  const tail = sliceTailOnSurrogateBoundary(content, tailUnits);
  return {
    message: { ...message, content: `${head}${INPUT_SHORTENED_MARKER}${tail}` },
    shortened: true,
  };
}

/** Slices the first `units` code units without splitting a trailing surrogate pair. */
function sliceHeadOnSurrogateBoundary(content: string, units: number): string {
  let sliced = content.slice(0, Math.max(0, units));
  const lastCodeUnit = sliced.charCodeAt(sliced.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    sliced = sliced.slice(0, -1);
  }
  return sliced;
}

/** Slices the last `units` code units without splitting a leading surrogate pair. */
function sliceTailOnSurrogateBoundary(content: string, units: number): string {
  if (units <= 0) {
    return '';
  }
  let sliced = content.slice(content.length - units);
  const firstCodeUnit = sliced.charCodeAt(0);
  if (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff) {
    sliced = sliced.slice(1);
  }
  return sliced;
}
