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
