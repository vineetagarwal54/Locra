import type { ConversationMessage } from '../types/models';

import { LOCRA_SYSTEM_PROMPT } from './SystemPrompt';

export interface ContextTurn {
  question: string;
  answer: string;
}

export type ModelRequestRole = 'system' | 'user' | 'assistant';

export interface ModelRequestMessage {
  role: ModelRequestRole;
  content: string;
  mediaPath?: string;
}

export interface BuildCanonicalContextInput {
  turns: ContextTurn[];
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

export const DEFAULT_RECENT_TURN_LIMIT = 6;
export const MAX_CONTEXT_MESSAGE_CHARS = 1200;

const INTERNAL_PERCEPTION_SYSTEM_PROMPT =
  'You are Locra internal visual evidence extraction. Return only the requested structured evidence.';

export function buildCanonicalModelMessages(
  input: BuildCanonicalContextInput
): ModelRequestMessage[] {
  return [
    systemMessage(LOCRA_SYSTEM_PROMPT),
    ...boundedTurns(input.turns, input.recentTurnLimit).flatMap(turnToMessages),
    userMessage(input.currentQuestion),
  ];
}

export function buildCanonicalModelMessagesForConversation(
  input: BuildConversationContextInput
): ModelRequestMessage[] {
  const currentMessage = findUserMessage(input.messages, input.currentUserMessageId);
  return buildCanonicalModelMessages({
    turns: buildContextTurnsBeforeMessage(input.messages, input.currentUserMessageId),
    currentQuestion: currentMessage.text,
    recentTurnLimit: input.recentTurnLimit,
  });
}

export function buildImageAnswerModelMessages(
  input: BuildImageAnswerContextInput
): ModelRequestMessage[] {
  return [
    systemMessage(LOCRA_SYSTEM_PROMPT),
    ...boundedTurns(
      buildContextTurnsBeforeMessage(input.messages, input.currentUserMessageId),
      input.recentTurnLimit,
    ).flatMap(turnToMessages),
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

function buildContextTurnsBeforeMessage(
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
      if (assistant?.role !== 'assistant') {
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

function boundedTurns(turns: ContextTurn[], recentTurnLimit: number | undefined): ContextTurn[] {
  return turns.slice(-resolveRecentTurnLimit(recentTurnLimit));
}

function resolveRecentTurnLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_RECENT_TURN_LIMIT;
  }
  return Math.max(0, Math.floor(limit));
}

function turnToMessages(turn: ContextTurn): ModelRequestMessage[] {
  return [
    userMessage(truncateContextText(turn.question)),
    assistantMessage(truncateContextText(turn.answer)),
  ];
}

function systemMessage(content: string): ModelRequestMessage {
  return { role: 'system', content };
}

function userMessage(content: string): ModelRequestMessage {
  return { role: 'user', content: content.trim() };
}

function assistantMessage(content: string): ModelRequestMessage {
  return { role: 'assistant', content: content.trim() };
}

function truncateContextText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_CONTEXT_MESSAGE_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_CONTEXT_MESSAGE_CHARS).trimEnd()}...`;
}
