import type {
  CanonicalContextTurn,
  CanonicalConversationContext,
  Conversation,
  ConversationMessage,
} from '../types/models';

import {
  ContextOrchestrator,
  createCanonicalConversationSnapshot,
  formatMediaEvidence,
  formatMemoryFact,
} from './ContextOrchestrator';
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
}

export interface BuildConversationContextInput {
  messages: ConversationMessage[];
  currentUserMessageId: string;
}

export interface BuildImageAnswerContextInput extends BuildConversationContextInput {
  answerPrompt: string;
}

const INTERNAL_PERCEPTION_SYSTEM_PROMPT =
  'You are Locra internal visual evidence extraction. Return only the requested structured evidence.';
const defaultContextOrchestrator = new ContextOrchestrator();

export function buildCanonicalModelMessages(
  input: BuildCanonicalContextInput
): ModelRequestMessage[] {
  return [
    answerSystemMessage(input.conversationContext),
    ...input.conversationContext.recentTurns.flatMap(turnToMessages),
    userMessage(input.currentQuestion),
  ];
}

export function createCanonicalConversationContext(
  turns: ReadonlyArray<ContextTurn>,
): CanonicalConversationContext {
  const recentTurns = turns.map((turn) => ({
    question: turn.question,
    answer: turn.answer,
  }));
  const usedUnits = recentTurns.reduce(
    (total, turn) => total + turn.question.length + (turn.answer?.length ?? 0),
    0,
  );
  return {
    version: 'canonical-conversation-v2',
    recentTurns,
    mediaEvidence: [],
    importantFacts: [],
    olderSummary: null,
    budget: {
      policyId: 'preselected-context-v1',
      maximumUnits: usedUnits,
      usedUnits,
    },
  };
}

export function buildCanonicalModelMessagesForConversation(
  input: BuildConversationContextInput
): ModelRequestMessage[] {
  const currentMessage = findUserMessage(input.messages, input.currentUserMessageId);
  const conversationContext = defaultContextOrchestrator.orchestrate(
    createCanonicalConversationSnapshot(
      conversationForContextBuilder(input.messages),
      input.currentUserMessageId,
    ),
  ).context;
  return buildCanonicalModelMessages({
    conversationContext,
    currentQuestion: currentMessage.text,
  });
}

export function buildImageAnswerModelMessages(
  input: BuildImageAnswerContextInput
): ModelRequestMessage[] {
  const conversationContext = defaultContextOrchestrator.orchestrate(
    createCanonicalConversationSnapshot(
      conversationForContextBuilder(input.messages),
      input.currentUserMessageId,
    ),
  ).context;
  return [
    answerSystemMessage(conversationContext),
    ...conversationContext.recentTurns.flatMap(turnToMessages),
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

function conversationForContextBuilder(messages: ConversationMessage[]): Conversation {
  const createdAt = messages[0]?.createdAt ?? 0;
  return {
    id: 'context-builder-conversation',
    createdAt,
    updatedAt: messages.at(-1)?.createdAt ?? createdAt,
    messages,
    status: 'completed',
    errorMessage: null,
    metrics: null,
    flagged: false,
    flagNote: null,
    contextMemory: null,
  };
}

function turnToMessages(turn: ContextTurn): ModelRequestMessage[] {
  const messages: ModelRequestMessage[] = [userMessage(turn.question)];
  if (turn.answer !== null && turn.answer.trim() !== '') {
    messages.push(assistantMessage(turn.answer));
  }
  return messages;
}

function systemMessage(content: string): ModelRequestMessage {
  return { role: 'system', content };
}

function answerSystemMessage(context: CanonicalConversationContext): ModelRequestMessage {
  if (!hasConversationContext(context)) {
    return systemMessage(LOCRA_SYSTEM_PROMPT);
  }

  const derivedMemory = formatDerivedMemory(context);
  const memorySuffix = derivedMemory === ''
    ? ''
    : `\n\nDerived conversation memory for reference only:\n${derivedMemory}`;
  return systemMessage(
    `${LOCRA_SYSTEM_PROMPT}\n\n${LOCRA_FOLLOW_UP_INSTRUCTION}${memorySuffix}`,
  );
}

function userMessage(content: string): ModelRequestMessage {
  return { role: 'user', content: content.trim() };
}

function assistantMessage(content: string): ModelRequestMessage {
  return { role: 'assistant', content: content.trim() };
}

function hasConversationContext(context: CanonicalConversationContext): boolean {
  return (
    context.recentTurns.length > 0 ||
    context.mediaEvidence.length > 0 ||
    context.importantFacts.length > 0 ||
    context.olderSummary !== null
  );
}

function formatDerivedMemory(context: CanonicalConversationContext): string {
  const sections: string[] = [];
  if (context.mediaEvidence.length > 0) {
    sections.push(
      `Relevant prior media evidence:\n${context.mediaEvidence
        .map(formatMediaEvidence)
        .join('\n\n')}`,
    );
  }
  if (context.importantFacts.length > 0) {
    sections.push(
      `Relevant user-provided details:\n${context.importantFacts
        .map((fact) => `- ${formatMemoryFact(fact)}`)
        .join('\n')}`,
    );
  }
  if (context.olderSummary !== null) {
    sections.push(`Older conversation summary:\n${context.olderSummary}`);
  }
  return sections.join('\n\n');
}
