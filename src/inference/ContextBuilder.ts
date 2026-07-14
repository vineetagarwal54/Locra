import type {
  CanonicalContextTurn,
  CanonicalConversationContext,
} from '../types/models';

import { formatMediaEvidence, formatMemoryFact } from './ContextOrchestrator';
import {
  DEFAULT_RESPONSE_MODE,
  getResponseModeConfig,
  getResponseModeInstruction,
  type ResponseMode,
  type ResponseModeConfig,
} from './ResponseMode';
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
  responseMode?: ResponseMode;
  responseModeConfig?: ResponseModeConfig;
}

const INTERNAL_PERCEPTION_SYSTEM_PROMPT =
  'You are Locra internal visual evidence extraction. Return only the requested structured evidence.';

export function buildCanonicalModelMessages(
  input: BuildCanonicalContextInput
): ModelRequestMessage[] {
  const responseMode = input.responseMode ?? DEFAULT_RESPONSE_MODE;
  const responseModeConfig = input.responseModeConfig ?? getResponseModeConfig(responseMode);
  return [
    answerSystemMessage(input.conversationContext, responseMode, responseModeConfig),
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

export function buildDirectImageModelMessages(
  input: BuildCanonicalContextInput,
  imagePath: string,
): ModelRequestMessage[] {
  const messages = buildCanonicalModelMessages(input);
  const current = messages.at(-1);
  if (current === undefined) {
    throw new Error('The current image question is missing.');
  }
  return [...messages.slice(0, -1), { ...current, mediaPath: imagePath }];
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

function answerSystemMessage(
  context: CanonicalConversationContext,
  responseMode: ResponseMode,
  responseModeConfig: ResponseModeConfig,
): ModelRequestMessage {
  const modeInstruction = getResponseModeInstruction(responseMode, responseModeConfig);
  if (!hasConversationContext(context)) {
    return systemMessage(`${LOCRA_SYSTEM_PROMPT}\n\n${modeInstruction}`);
  }

  const derivedMemory = formatDerivedMemory(context);
  const memorySuffix = derivedMemory === ''
    ? ''
    : `\n\nDerived conversation memory for reference only:\n${derivedMemory}`;
  return systemMessage(
    `${LOCRA_SYSTEM_PROMPT}\n\n${modeInstruction}\n\n${LOCRA_FOLLOW_UP_INSTRUCTION}${memorySuffix}`,
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
      `Important prior facts and decisions:\n${context.importantFacts
        .map((fact) => `- ${formatMemoryFact(fact)}`)
        .join('\n')}`,
    );
  }
  if (context.olderSummary !== null) {
    sections.push(`Older conversation summary:\n${context.olderSummary}`);
  }
  return sections.join('\n\n');
}
