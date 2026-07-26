import type { ModelRequestMessage } from './ContextBuilder';
import {
  getResponseGenerationLimit,
  QWEN_CONTEXT_TOKEN_LIMIT,
  type ResponseMode,
} from './ResponseMode';

export const CONTEXT_SAFETY_TOKENS = 128;
export const MESSAGE_OVERHEAD_TOKENS = 6;
export const IMAGE_RESERVE_TOKENS = 768;
export const SYSTEM_INSTRUCTION_RESERVE_TOKENS = 256;
export const MAX_NATIVE_RECONCILIATION_PASSES = 4;

export interface ContextCapacityBuckets {
  readonly systemInstructions: number;
  readonly currentInput: number;
  readonly imageInput: number;
  readonly selectedContext: number;
  readonly generatedOutput: number;
  readonly safety: number;
}

export function getContextCapacityBuckets(
  responseMode: ResponseMode,
  currentInput: string,
  hasImage: boolean,
  requestedSelectedContext: number,
): ContextCapacityBuckets {
  const currentInputTokens = MESSAGE_OVERHEAD_TOKENS + Math.ceil(currentInput.length / 3);
  const imageInputTokens = hasImage ? IMAGE_RESERVE_TOKENS : 0;
  const generatedOutput = getResponseGenerationLimit(responseMode);
  const availableSelectedContext = Math.max(
    0,
    QWEN_CONTEXT_TOKEN_LIMIT
      - CONTEXT_SAFETY_TOKENS
      - SYSTEM_INSTRUCTION_RESERVE_TOKENS
      - currentInputTokens
      - imageInputTokens
      - generatedOutput,
  );
  return {
    systemInstructions: SYSTEM_INSTRUCTION_RESERVE_TOKENS,
    currentInput: currentInputTokens,
    imageInput: imageInputTokens,
    selectedContext: Math.min(requestedSelectedContext, availableSelectedContext),
    generatedOutput,
    safety: CONTEXT_SAFETY_TOKENS,
  };
}

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

export interface NativePromptReconciliation {
  readonly messages: ModelRequestMessage[];
  readonly estimatedPromptTokens: number;
  readonly finalNativePromptTokens: number;
  readonly passes: number;
  readonly currentInputShortened: boolean;
}

export class NativePromptLimitError extends Error {
  constructor() {
    super('The formatted prompt could not be reconciled safely to the Qwen context limit.');
    this.name = 'NativePromptLimitError';
  }
}

/**
 * Repeatedly measures the actual formatted Qwen prompt. Each pass either proves
 * the prompt fits, removes eligible history, or shortens the current request
 * using the measured native excess. The explicit pass cap guarantees termination.
 */
export async function reconcileMessagesWithNativeTokenizer(
  messages: ReadonlyArray<ModelRequestMessage>,
  responseMode: ResponseMode,
  measureNativePrompt: (
    candidate: ReadonlyArray<ModelRequestMessage>,
  ) => Promise<number>,
): Promise<NativePromptReconciliation> {
  const maximumInputTokens = maximumNativeInputTokens(responseMode);
  const estimatedPromptTokens = messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
  let selected = messages.map(cloneMessage);
  let currentInputShortened = false;

  for (let pass = 1; pass <= MAX_NATIVE_RECONCILIATION_PASSES; pass += 1) {
    const nativeTokens = await measureNativePrompt(selected);
    if (nativeTokens <= maximumInputTokens) {
      return {
        messages: selected,
        estimatedPromptTokens,
        finalNativePromptTokens: nativeTokens,
        passes: pass,
        currentInputShortened,
      };
    }
    if (pass === MAX_NATIVE_RECONCILIATION_PASSES) {
      throw new NativePromptLimitError();
    }

    const reducedHistory = reconcileMessagesToNativeTokenCount(
      selected,
      responseMode,
      nativeTokens,
    );
    if (reducedHistory.length < selected.length) {
      selected = reducedHistory;
      continue;
    }

    const current = selected.at(-1);
    if (current === undefined) {
      throw new NativePromptLimitError();
    }
    const measuredExcess = nativeTokens - maximumInputTokens;
    const targetTokens = Math.max(
      1,
      estimateMessageTokens(current) - measuredExcess - MESSAGE_OVERHEAD_TOKENS,
    );
    const capped = capMessageToTokenBudget(current, targetTokens);
    if (!capped.shortened || capped.message.content === current.content) {
      throw new NativePromptLimitError();
    }
    selected = [...selected.slice(0, -1), capped.message];
    currentInputShortened = true;
  }

  throw new NativePromptLimitError();
}

export function reconcileMessagesToNativeTokenCount(
  messages: ReadonlyArray<ModelRequestMessage>,
  responseMode: ResponseMode,
  nativeTokenCount: number,
): ModelRequestMessage[] {
  const maximumInputTokens = maximumNativeInputTokens(responseMode);
  if (nativeTokenCount <= maximumInputTokens || messages.length < 3) {
    return messages.map(cloneMessage);
  }

  const selected = messages.map(cloneMessage);
  let tokensToRemove = nativeTokenCount - maximumInputTokens;
  while (selected.length > 2 && tokensToRemove > 0) {
    const firstHistory = selected[1];
    const secondHistory = selected[2];
    if (firstHistory === undefined) break;
    const removeCount = firstHistory.role === 'user' && secondHistory?.role === 'assistant' ? 2 : 1;
    const removed = selected.splice(1, removeCount);
    tokensToRemove -= removed.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    );
  }
  return selected;
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
    const head = sliceHeadOnSurrogateBoundary(content, content.length > 0 ? 1 : 0);
    const tail = sliceTailOnSurrogateBoundary(content, content.length > 1 ? 1 : 0);
    return {
      message: { ...message, content: `${head}${INPUT_SHORTENED_MARKER}${tail}` },
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

function maximumNativeInputTokens(responseMode: ResponseMode): number {
  return QWEN_CONTEXT_TOKEN_LIMIT
    - getResponseGenerationLimit(responseMode)
    - CONTEXT_SAFETY_TOKENS;
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
