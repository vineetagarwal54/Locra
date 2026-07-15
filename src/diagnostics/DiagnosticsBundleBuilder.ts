import type { ContextSelectionDiagnostics } from '../inference/ContextOrchestrator';
import type { InferenceTraceStage } from '../inference/InferenceTrace';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import type { Conversation, ConversationMessage } from '../types/models';

import type { DiagnosticTurnRecord } from './DiagnosticsTraceStore';

const TITLE_MAX_CHARS = 60;

export interface AppDiagnosticsInfo {
  readonly modelId: string;
  readonly generationConfigId: string;
  readonly pipelineVariantId: string;
  readonly appBuildId: string;
  readonly deviceNameModel: string;
  readonly exportedAt: string;
  readonly modelDownloadStatus: string;
  readonly modelDownloadProgress: number;
  readonly modelIntegrityVerified: boolean;
  readonly storageAvailableBytes: number;
  readonly storageTotalBytes: number;
  readonly activeResourceOperation: string | null;
}

export interface DiagnosticsMessageJson {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly status: string;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly attachments: ReadonlyArray<{ kind: string; path: string }>;
}

export interface DiagnosticsConversationJson {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<DiagnosticsMessageJson>;
}

export interface DiagnosticsTurnJson {
  readonly conversationId: string;
  readonly originatingUserMessageId: string;
  readonly assistantMessageId: string;
  readonly capturedAt: string;
  readonly stages: ReadonlyArray<InferenceTraceStage>;
  readonly finalResponse: string | null;
  readonly refusalRecoveryTriggered: boolean;
  readonly objectiveResult: ObjectiveInferenceResultRecord | null;
  readonly contextDiagnostics: ContextSelectionDiagnostics | null;
}

export interface DiagnosticsBundleJson {
  readonly appInfo: AppDiagnosticsInfo;
  readonly conversations: ReadonlyArray<DiagnosticsConversationJson>;
  readonly turns: ReadonlyArray<DiagnosticsTurnJson>;
}

export function buildDiagnosticsMarkdown(conversations: ReadonlyArray<Conversation>): string {
  if (conversations.length === 0) {
    return '# Locra diagnostics export\n\nNo conversations selected.\n';
  }

  const sections = conversations.map(buildConversationMarkdown);
  return `# Locra diagnostics export\n\n${sections.join('\n\n---\n\n')}\n`;
}

export function buildDiagnosticsBundleJson(input: {
  conversations: ReadonlyArray<Conversation>;
  turns: ReadonlyArray<DiagnosticTurnRecord>;
  appInfo: AppDiagnosticsInfo;
}): DiagnosticsBundleJson {
  return {
    appInfo: input.appInfo,
    conversations: input.conversations.map(toConversationJson),
    turns: input.turns.map(toTurnJson),
  };
}

function buildConversationMarkdown(conversation: Conversation): string {
  const lines = [
    `## ${conversationTitle(conversation)}`,
    `- id: ${conversation.id}`,
    `- status: ${conversation.status}`,
    `- created: ${isoTimestamp(conversation.createdAt)}`,
    `- updated: ${isoTimestamp(conversation.updatedAt)}`,
    '',
  ];
  for (const message of conversation.messages) {
    lines.push(formatMessageLine(message));
  }
  return lines.join('\n');
}

function formatMessageLine(message: ConversationMessage): string {
  const speaker = message.role === 'user' ? '**User**' : '**Locra**';
  const attachments =
    message.attachments.length > 0
      ? ' [image omitted]'
      : '';
  const error = message.errorMessage !== null
    ? ` (error: ${sanitizeLocalPaths(message.errorMessage)})`
    : '';
  const text = message.text.trim() === '' ? '(empty)' : sanitizeLocalPaths(message.text);
  return `${speaker} [${isoTimestamp(message.createdAt)}] (${message.status})${attachments}${error}: ${text}`;
}

function conversationTitle(conversation: Conversation): string {
  const firstUser = conversation.messages.find((message) => message.role === 'user');
  const raw = firstUser?.text.trim() ?? '';
  if (raw === '') {
    return `Conversation ${conversation.id}`;
  }
  const title = raw.length > TITLE_MAX_CHARS ? `${raw.slice(0, TITLE_MAX_CHARS)}…` : raw;
  return sanitizeLocalPaths(title);
}

function toConversationJson(conversation: Conversation): DiagnosticsConversationJson {
  return {
    id: conversation.id,
    status: conversation.status,
    createdAt: isoTimestamp(conversation.createdAt),
    updatedAt: isoTimestamp(conversation.updatedAt),
    messages: conversation.messages.map(toMessageJson),
  };
}

function toMessageJson(message: ConversationMessage): DiagnosticsMessageJson {
  return {
    id: message.id,
    role: message.role,
    text: sanitizeLocalPaths(message.text),
    status: message.status,
    errorMessage: message.errorMessage === null ? null : sanitizeLocalPaths(message.errorMessage),
    createdAt: isoTimestamp(message.createdAt),
    attachments: [],
  };
}

function toTurnJson(turn: DiagnosticTurnRecord): DiagnosticsTurnJson {
  return {
    conversationId: turn.conversationId,
    originatingUserMessageId: turn.originatingUserMessageId,
    assistantMessageId: turn.assistantMessageId,
    capturedAt: isoTimestamp(turn.capturedAt),
    stages: turn.trace.stages.map((stage) => ({
      ...stage,
      modelInput: stage.modelInput.map((message) => ({
        role: message.role,
        content: sanitizeLocalPaths(message.content),
      })),
      rawOutput: sanitizeLocalPaths(stage.rawOutput),
      parsedOutput: sanitizeUnknown(stage.parsedOutput),
      processedOutput: stage.processedOutput === undefined
        ? undefined
        : sanitizeLocalPaths(stage.processedOutput),
    })),
    finalResponse: turn.trace.finalResponse === null
      ? null
      : sanitizeLocalPaths(turn.trace.finalResponse),
    refusalRecoveryTriggered: turn.trace.stages.some((stage) => stage.refusalRetry === true),
    objectiveResult: turn.objectiveResult,
    contextDiagnostics: turn.contextDiagnostics,
  };
}

function isoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function sanitizeLocalPaths(value: string): string {
  return value.replace(
    /(?:file:\/\/|[A-Za-z]:\\|\/(?:data|storage|cache|tmp|var)\/)[^\s"'<>]+/g,
    '[local path omitted]',
  );
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeLocalPaths(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeUnknown);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeUnknown(item)]),
    );
  }
  return value;
}
