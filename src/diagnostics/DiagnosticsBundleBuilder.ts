import type { ContextSelectionDiagnostics } from '../inference/ContextOrchestrator';
import type { InferenceTraceStage } from '../inference/InferenceTrace';
import type { ObjectiveInferenceResultRecord } from '../inference/ObjectiveInferenceResultRecord';
import type { Conversation, ConversationMessage } from '../types/models';

import type { DiagnosticTurnRecord } from './DiagnosticsTraceStore';
import type { ProductionDiagnosticTurnSummary } from './DiagnosticsTraceStore';

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
  readonly imageAttachmentCount: number;
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
  readonly summary: ProductionDiagnosticTurnSummary | null;
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
    appInfo: sanitizeAppInfo(input.appInfo),
    conversations: input.conversations.map(toConversationJson),
    turns: input.turns.map(toTurnJson),
  };
}

/** Runs the free-text metadata fields through the same secret/path sanitizer. */
function sanitizeAppInfo(appInfo: AppDiagnosticsInfo): AppDiagnosticsInfo {
  return {
    ...appInfo,
    modelId: sanitizeSensitive(appInfo.modelId),
    generationConfigId: sanitizeSensitive(appInfo.generationConfigId),
    pipelineVariantId: sanitizeSensitive(appInfo.pipelineVariantId),
    appBuildId: sanitizeSensitive(appInfo.appBuildId),
    deviceNameModel: sanitizeSensitive(appInfo.deviceNameModel),
    activeResourceOperation:
      appInfo.activeResourceOperation === null
        ? null
        : sanitizeSensitive(appInfo.activeResourceOperation),
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
    ? ` (error: ${sanitizeSensitive(message.errorMessage)})`
    : '';
  const text = message.text.trim() === '' ? '(empty)' : sanitizeSensitive(message.text);
  return `${speaker} [${isoTimestamp(message.createdAt)}] (${message.status})${attachments}${error}: ${text}`;
}

function conversationTitle(conversation: Conversation): string {
  const firstUser = conversation.messages.find((message) => message.role === 'user');
  const raw = firstUser?.text.trim() ?? '';
  if (raw === '') {
    return `Conversation ${conversation.id}`;
  }
  const title = raw.length > TITLE_MAX_CHARS ? `${raw.slice(0, TITLE_MAX_CHARS)}…` : raw;
  return sanitizeSensitive(title);
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
    text: sanitizeSensitive(message.text),
    status: message.status,
    errorMessage: message.errorMessage === null ? null : sanitizeSensitive(message.errorMessage),
    createdAt: isoTimestamp(message.createdAt),
    imageAttachmentCount: message.attachments.filter((attachment) => attachment.kind === 'image').length,
  };
}

function toTurnJson(turn: DiagnosticTurnRecord): DiagnosticsTurnJson {
  const trace = turn.trace;
  return {
    conversationId: turn.conversationId,
    originatingUserMessageId: turn.originatingUserMessageId,
    assistantMessageId: turn.assistantMessageId,
    capturedAt: isoTimestamp(turn.capturedAt),
    stages: (trace?.stages ?? []).map((stage) => ({
      ...stage,
      modelInput: stage.modelInput.map((message) => ({
        role: message.role,
        content: sanitizeSensitive(message.content),
      })),
      rawOutput: sanitizeSensitive(stage.rawOutput),
      parsedOutput: sanitizeUnknown(stage.parsedOutput),
      processedOutput: stage.processedOutput === undefined
        ? undefined
        : sanitizeSensitive(stage.processedOutput),
    })),
    finalResponse: trace?.finalResponse == null
      ? null
      : sanitizeSensitive(trace.finalResponse),
    refusalRecoveryTriggered: trace?.stages.some((stage) => stage.refusalRetry === true) ?? false,
    objectiveResult: turn.objectiveResult,
    contextDiagnostics: turn.contextDiagnostics,
    summary: turn.summary ?? null,
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

// Ordered redactions applied before local-path stripping. Each targets a class of
// secret so a diagnostics bundle never carries credentials, tokens, or keys even
// when they leak into model I/O, error strings, or metadata.
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization headers / bearer tokens: "Authorization: Bearer <token>".
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 [redacted]'],
  // JWT-style tokens (three base64url segments).
  [/\beyJ[A-Za-z0-9._-]{10,}\b/g, '[redacted token]'],
  // key/value style secrets: token=..., api_key: ..., secret="...", password ...
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|auth[_-]?token|client[_-]?secret|private[_-]?key)\b(\s*[:=]\s*|\s+)["']?[^\s"'<>&]{4,}["']?/gi,
    '$1=[redacted]',
  ],
];

/**
 * Sanitizes free text before it is written to a diagnostics bundle: first redacts
 * credential-like secrets/tokens, then strips absolute local file paths. Applied to
 * every user/model string, error message, and string metadata value.
 */
export function sanitizeSensitive(value: string): string {
  const withoutSecrets = SECRET_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
  return sanitizeLocalPaths(withoutSecrets);
}

function sanitizeUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeSensitive(value);
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
