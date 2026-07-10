import type {
  CanonicalContextTurn,
  CanonicalConversationContext,
  ConversationMessage,
} from '../types/models';

import { LOCRA_FOLLOW_UP_INSTRUCTION, LOCRA_SYSTEM_PROMPT } from './SystemPrompt';

export type ContextTurn = CanonicalContextTurn;
export type { CanonicalConversationContext };

export type ModelRequestRole = 'system' | 'user' | 'assistant';

export interface ModelRequestMessage {
  role: ModelRequestRole;
  content: string;
  mediaPath?: string;
}

export interface BuildCanonicalContextInput {
  conversationContext: CanonicalConversationContext;
  currentQuestion: string;
  recentTurnLimit?: number;
}

export interface BuildConversationContextInput {
  messages: ConversationMessage[];
  currentUserMessageId: string;
  recentTurnLimit?: number;
}

export interface BuildImageAnswerContextInput extends BuildConversationContextInput {
  answerPrompt: string;
}

export const DEFAULT_RECENT_TURN_LIMIT = 12;
export const MAX_CANONICAL_CONTEXT_CHARS = 14_400;

const CONTEXT_TURN_OVERHEAD_CHARS = 32;
const CONTEXT_SHORTENED_MARKER = '\n[... context shortened ...]\n';

const INTERNAL_PERCEPTION_SYSTEM_PROMPT =
  'You are Locra internal visual evidence extraction. Return only the requested structured evidence.';

export function buildCanonicalModelMessages(
  input: BuildCanonicalContextInput
): ModelRequestMessage[] {
  const contextTurns = boundedTurns(
    input.conversationContext.turns,
    input.recentTurnLimit,
  );
  return [
    answerSystemMessage(contextTurns.length > 0),
    ...contextTurns.flatMap(turnToMessages),
    userMessage(input.currentQuestion),
  ];
}

export function createCanonicalConversationContext(
  turns: ReadonlyArray<ContextTurn>,
): CanonicalConversationContext {
  return {
    version: 'canonical-conversation-v1',
    turns: turns.map((turn) => ({
      question: turn.question,
      answer: turn.answer,
    })),
  };
}

export function buildCanonicalConversationContextBeforeMessage(
  messages: ConversationMessage[],
  currentUserMessageId: string,
): CanonicalConversationContext {
  return createCanonicalConversationContext(
    buildContextTurnsBeforeMessage(messages, currentUserMessageId),
  );
}

export function buildCanonicalModelMessagesForConversation(
  input: BuildConversationContextInput
): ModelRequestMessage[] {
  const currentMessage = findUserMessage(input.messages, input.currentUserMessageId);
  return buildCanonicalModelMessages({
    conversationContext: buildCanonicalConversationContextBeforeMessage(
      input.messages,
      input.currentUserMessageId,
    ),
    currentQuestion: currentMessage.text,
    recentTurnLimit: input.recentTurnLimit,
  });
}

export function buildImageAnswerModelMessages(
  input: BuildImageAnswerContextInput
): ModelRequestMessage[] {
  const contextTurns = boundedTurns(
    buildCanonicalConversationContextBeforeMessage(
      input.messages,
      input.currentUserMessageId,
    ).turns,
    input.recentTurnLimit,
  );
  return [
    answerSystemMessage(contextTurns.length > 0),
    ...contextTurns.flatMap(turnToMessages),
    userMessage(input.answerPrompt),
  ];
}

export function buildSingleUserModelMessages(content: string): ModelRequestMessage[] {
  return [systemMessage(LOCRA_SYSTEM_PROMPT), userMessage(content)];
}

export function buildPerceptionModelMessages(
  content: string,
  imagePath: string
): ModelRequestMessage[] {
  return [
    systemMessage(INTERNAL_PERCEPTION_SYSTEM_PROMPT),
    { ...userMessage(content), mediaPath: imagePath },
  ];
}

export function buildPerceptionRetryModelMessages(content: string): ModelRequestMessage[] {
  return [systemMessage(INTERNAL_PERCEPTION_SYSTEM_PROMPT), userMessage(content)];
}

export function shouldRunPerceptionForMessage(message: ConversationMessage): boolean {
  return message.role === 'user' && getImageAttachmentPath(message) !== null;
}

export function getImageAttachmentPath(message: ConversationMessage): string | null {
  const attachment = message.attachments.find((item) => item.kind === 'image');
  return attachment?.path ?? null;
}

export function buildContextTurnsBeforeMessage(
  messages: ConversationMessage[],
  currentUserMessageId: string,
): ContextTurn[] {
  const currentIndex = messages.findIndex((message) => message.id === currentUserMessageId);
  if (currentIndex < 0) {
    throw new Error(`Conversation message not found: ${currentUserMessageId}`);
  }

  return messages
    .slice(0, currentIndex)
    .reduce<ContextTurn[]>((turns, message, index, priorMessages) => {
      if (message.role !== 'user') {
        return turns;
      }

      const assistant = priorMessages[index + 1];
      // Only completed pairs carry answer text worth feeding back as context —
      // failed/interrupted/still-generating assistants have empty or partial text.
      if (assistant?.role !== 'assistant' || assistant.status !== 'completed') {
        return turns;
      }

      turns.push({
        question: message.text,
        answer: assistant.text,
      });
      return turns;
    }, []);
}

function findUserMessage(
  messages: ConversationMessage[],
  currentUserMessageId: string,
): ConversationMessage {
  const message = messages.find((item) => item.id === currentUserMessageId);
  if (message === undefined || message.role !== 'user') {
    throw new Error(`User conversation message not found: ${currentUserMessageId}`);
  }

  return message;
}

function boundedTurns(
  turns: ReadonlyArray<ContextTurn>,
  recentTurnLimit: number | undefined,
): ContextTurn[] {
  const turnLimit = resolveRecentTurnLimit(recentTurnLimit);
  if (turnLimit === 0) {
    return [];
  }

  const candidates = turns.slice(-turnLimit);
  const selected: ContextTurn[] = [];
  let remainingChars = MAX_CANONICAL_CONTEXT_CHARS;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = normalizedTurn(candidates[index]);
    const turnChars = contextTurnChars(turn);
    if (turnChars <= remainingChars) {
      selected.unshift(turn);
      remainingChars -= turnChars;
      continue;
    }

    if (selected.length === 0 && remainingChars > CONTEXT_TURN_OVERHEAD_CHARS) {
      selected.unshift(shortenTurnToBudget(turn, remainingChars));
    }
    break;
  }

  return selected;
}

function resolveRecentTurnLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_RECENT_TURN_LIMIT;
  }
  return Math.max(0, Math.floor(limit));
}

function turnToMessages(turn: ContextTurn): ModelRequestMessage[] {
  return [
    userMessage(turn.question),
    assistantMessage(turn.answer),
  ];
}

function systemMessage(content: string): ModelRequestMessage {
  return { role: 'system', content };
}

function answerSystemMessage(hasPriorContext: boolean): ModelRequestMessage {
  if (!hasPriorContext) {
    return systemMessage(LOCRA_SYSTEM_PROMPT);
  }

  return systemMessage(`${LOCRA_SYSTEM_PROMPT}\n\n${LOCRA_FOLLOW_UP_INSTRUCTION}`);
}

function userMessage(content: string): ModelRequestMessage {
  return { role: 'user', content: content.trim() };
}

function assistantMessage(content: string): ModelRequestMessage {
  return { role: 'assistant', content: content.trim() };
}

function normalizedTurn(turn: ContextTurn): ContextTurn {
  return {
    question: turn.question.trim(),
    answer: turn.answer.trim(),
  };
}

function contextTurnChars(turn: ContextTurn): number {
  return turn.question.length + turn.answer.length + CONTEXT_TURN_OVERHEAD_CHARS;
}

function shortenTurnToBudget(turn: ContextTurn, budget: number): ContextTurn {
  const contentBudget = Math.max(0, budget - CONTEXT_TURN_OVERHEAD_CHARS);
  const totalChars = turn.question.length + turn.answer.length;
  if (totalChars <= contentBudget) {
    return turn;
  }

  const questionShare = totalChars === 0
    ? 0
    : Math.round(contentBudget * (turn.question.length / totalChars));
  return {
    question: shortenContextText(turn.question, questionShare),
    answer: shortenContextText(turn.answer, contentBudget - questionShare),
  };
}

function shortenContextText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 0) {
    return '';
  }
  if (maxChars <= 3) {
    return value.slice(-maxChars);
  }
  if (maxChars <= CONTEXT_SHORTENED_MARKER.length + 2) {
    return `...${value.slice(-(maxChars - 3))}`;
  }

  const remainingChars = maxChars - CONTEXT_SHORTENED_MARKER.length;
  const headChars = Math.ceil(remainingChars / 2);
  const tailChars = remainingChars - headChars;
  return `${value.slice(0, headChars).trimEnd()}${CONTEXT_SHORTENED_MARKER}${value
    .slice(-tailChars)
    .trimStart()}`;
}
