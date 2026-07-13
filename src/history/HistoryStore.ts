import { storage } from '../storage/mmkv';
import type { IHistoryStore } from '../types/interfaces';
import type {
  Conversation,
  ConversationContextMemory,
  ConversationMessage,
  ConversationStatus,
  ContextMediaEvidence,
  ContextMemoryFact,
  ContextRollingSummary,
  ContextSummaryEntry,
  MetricsSummary,
  QASession,
} from '../types/models';

export interface HistoryStorage {
  set(key: string, value: string | number | boolean | ArrayBuffer): void;
  getString(key: string): string | undefined;
  getAllKeys(): string[];
  remove(key: string): boolean;
}

const IDS_KEY = 'history:ids';
const SESSION_KEY_PREFIX = 'history:session:';

const EMPTY_METRICS_SUMMARY: MetricsSummary = {
  count: 0,
  averageModelLoadTimeMs: 0,
  averagePreprocessingTimeMs: 0,
  averageFirstTokenLatencyMs: 0,
  averageTokensPerSecond: 0,
  averageTotalWallTimeMs: 0,
};

export class HistoryStore implements IHistoryStore {
  constructor(private readonly store: HistoryStorage = storage) {}

  save(conversation: Conversation): void {
    const normalized = normalizeConversation(conversation);
    if (normalized === null) {
      return;
    }
    this.store.set(toSessionKey(normalized.id), JSON.stringify(normalized));
    this.writeIds(this.mergeIds(normalized.id));
  }

  get(id: string): Conversation | null {
    return readConversation(this.store.getString(toSessionKey(id)));
  }

  list(limit?: number, offset?: number): Conversation[] {
    const start = Math.max(0, offset ?? 0);
    const count = limit === undefined ? undefined : Math.max(0, limit);
    const conversations = this.readIds()
      .map((id) => this.get(id))
      .filter((conversation): conversation is Conversation => conversation !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return count === undefined
      ? conversations.slice(start)
      : conversations.slice(start, start + count);
  }

  delete(id: string): void {
    this.store.remove(toSessionKey(id));
    this.writeIds(this.readIds().filter((existingId) => existingId !== id));
  }

  clear(): void {
    for (const key of this.store.getAllKeys()) {
      if (key === IDS_KEY || key.startsWith(SESSION_KEY_PREFIX)) {
        this.store.remove(key);
      }
    }
  }

  setFlag(id: string, flagged: boolean, note?: string): void {
    const conversation = this.get(id);
    if (conversation === null) {
      return;
    }

    this.save({
      ...conversation,
      flagged,
      flagNote: note ?? null,
    });
  }

  getMetricsSummary(): MetricsSummary {
    const completedWithMetrics = this.list().filter((conversation) => conversation.metrics !== null);
    if (completedWithMetrics.length === 0) {
      return { ...EMPTY_METRICS_SUMMARY };
    }

    const totals = completedWithMetrics.reduce(
      (acc, conversation) => {
        const metrics = conversation.metrics;
        if (metrics === null) {
          return acc;
        }
        return {
          modelLoadTimeMs: acc.modelLoadTimeMs + metrics.modelLoadTimeMs,
          preprocessingTimeMs: acc.preprocessingTimeMs + metrics.preprocessingTimeMs,
          firstTokenLatencyMs: acc.firstTokenLatencyMs + metrics.firstTokenLatencyMs,
          tokensPerSecond: acc.tokensPerSecond + metrics.tokensPerSecond,
          totalWallTimeMs: acc.totalWallTimeMs + metrics.totalWallTimeMs,
        };
      },
      {
        modelLoadTimeMs: 0,
        preprocessingTimeMs: 0,
        firstTokenLatencyMs: 0,
        tokensPerSecond: 0,
        totalWallTimeMs: 0,
      }
    );
    const count = completedWithMetrics.length;

    return {
      count,
      averageModelLoadTimeMs: totals.modelLoadTimeMs / count,
      averagePreprocessingTimeMs: totals.preprocessingTimeMs / count,
      averageFirstTokenLatencyMs: totals.firstTokenLatencyMs / count,
      averageTokensPerSecond: totals.tokensPerSecond / count,
      averageTotalWallTimeMs: totals.totalWallTimeMs / count,
    };
  }

  private mergeIds(id: string): string[] {
    const ids = this.readIds().filter((existingId) => existingId !== id);
    ids.push(id);
    return ids;
  }

  private readIds(): string[] {
    const rawIds = this.store.getString(IDS_KEY);
    if (rawIds === undefined) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(rawIds);
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private writeIds(ids: string[]): void {
    this.store.set(IDS_KEY, JSON.stringify(ids));
  }
}

function toSessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function readConversation(rawConversation: string | undefined): Conversation | null {
  if (rawConversation === undefined) {
    return null;
  }
  try {
    return normalizeConversation(JSON.parse(rawConversation));
  } catch {
    return null;
  }
}

function normalizeConversation(value: unknown): Conversation | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  if ('messages' in value) {
    return normalizeConversationInput(value as Conversation);
  }

  if ('turns' in value && 'question' in value && 'answer' in value) {
    return sessionToConversation(value as QASession);
  }

  return null;
}

function normalizeConversationInput(conversation: Conversation): Conversation {
  const normalized: Conversation = {
      id: conversation.id,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((message) => ({
        ...message,
        attachments: message.attachments ?? [],
        errorMessage: message.errorMessage ?? null,
      })),
      status: conversation.status,
      errorMessage: conversation.errorMessage ?? null,
      metrics: conversation.metrics ?? null,
      flagged: conversation.flagged,
      flagNote: conversation.flagNote ?? null,
    };
    const contextMemory = normalizeContextMemory(conversation.contextMemory);
  return contextMemory === undefined
    ? normalized
    : { ...normalized, contextMemory };
}

function normalizeContextMemory(
  value: unknown,
): ConversationContextMemory | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || value.version !== 'conversation-context-memory-v1') {
    return undefined;
  }

  return {
    version: 'conversation-context-memory-v1',
    sourceMessageCount: readNonNegativeNumber(value.sourceMessageCount),
    rollingSummary: normalizeRollingSummary(value.rollingSummary),
    importantFacts: readArray(value.importantFacts)
      .map(normalizeMemoryFact)
      .filter((item): item is ContextMemoryFact => item !== null),
    mediaEvidence: readArray(value.mediaEvidence)
      .map(normalizeMediaEvidence)
      .filter((item): item is ContextMediaEvidence => item !== null),
  };
}

function normalizeRollingSummary(value: unknown): ContextRollingSummary | null {
  if (
    !isRecord(value) ||
    value.version !== 'rolling-summary-v1' ||
    typeof value.coveredThroughMessageId !== 'string'
  ) {
    return null;
  }

  return {
    version: 'rolling-summary-v1',
    coveredThroughMessageId: value.coveredThroughMessageId,
    sourceMessageIds: readArray(value.sourceMessageIds).filter(
      (item): item is string => typeof item === 'string',
    ),
    entries: readArray(value.entries)
      .map(normalizeSummaryEntry)
      .filter((item): item is ContextSummaryEntry => item !== null),
  };
}

function normalizeSummaryEntry(value: unknown): ContextSummaryEntry | null {
  if (
    !isRecord(value) ||
    value.version !== 'context-summary-entry-v1' ||
    typeof value.sourceUserMessageId !== 'string' ||
    typeof value.sourceAssistantMessageId !== 'string' ||
    typeof value.text !== 'string'
  ) {
    return null;
  }
  return {
    version: 'context-summary-entry-v1',
    sourceUserMessageId: value.sourceUserMessageId,
    sourceAssistantMessageId: value.sourceAssistantMessageId,
    text: value.text,
    createdAt: readNonNegativeNumber(value.createdAt),
  };
}

function normalizeMemoryFact(value: unknown): ContextMemoryFact | null {
  if (
    !isRecord(value) ||
    value.version !== 'context-memory-fact-v1' ||
    typeof value.id !== 'string' ||
    typeof value.sourceMessageId !== 'string' ||
    typeof value.text !== 'string'
  ) {
    return null;
  }
  return {
    version: 'context-memory-fact-v1',
    id: value.id,
    sourceMessageId: value.sourceMessageId,
    text: value.text,
    createdAt: readNonNegativeNumber(value.createdAt),
  };
}

function normalizeMediaEvidence(value: unknown): ContextMediaEvidence | null {
  if (
    !isRecord(value) ||
    value.version !== 'context-media-evidence-v1' ||
    typeof value.id !== 'string' ||
    typeof value.sourceMessageId !== 'string' ||
    !isEvidenceModality(value.modality) ||
    typeof value.sourcePath !== 'string' ||
    typeof value.summary !== 'string'
  ) {
    return null;
  }
  return {
    version: 'context-media-evidence-v1',
    id: value.id,
    sourceMessageId: value.sourceMessageId,
    modality: value.modality,
    sourcePath: value.sourcePath,
    summary: value.summary,
    facts: readStringArray(value.facts),
    extractedText: readStringArray(value.extractedText),
    uncertainty: readStringArray(value.uncertainty),
    createdAt: readNonNegativeNumber(value.createdAt),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return readArray(value).filter((item): item is string => typeof item === 'string');
}

function readNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function isEvidenceModality(
  value: unknown,
): value is ContextMediaEvidence['modality'] {
  return value === 'image' || value === 'screenshot' || value === 'document';
}

export function sessionToConversation(session: QASession): Conversation {
  const turns = normalizedTurns(session);
  const messages: ConversationMessage[] = turns.flatMap((turn, index) => {
    const createdAt = session.createdAt + index * 2;
    return [
      {
        id: `${session.id}:user:${index}`,
        role: 'user',
        text: turn.question,
        attachments:
          index === 0 && session.imagePath !== ''
            ? [{ kind: 'image', path: session.imagePath }]
            : [],
        status: 'completed',
        errorMessage: null,
        createdAt,
      },
      {
        id: `${session.id}:assistant:${index}`,
        role: 'assistant',
        text: turn.answer,
        attachments: [],
        status: messageStatusFromSessionStatus(session.status),
        errorMessage: session.errorMessage,
        createdAt: createdAt + 1,
      },
    ];
  });

  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.createdAt,
    messages,
    status: sessionStatusToConversationStatus(session.status),
    errorMessage: session.errorMessage,
    metrics: session.metrics,
    flagged: session.flagged,
    flagNote: session.flagNote ?? null,
  };
}

function normalizedTurns(session: QASession): Array<{ question: string; answer: string }> {
  return session.turns.length > 0
    ? session.turns
    : [{ question: session.question, answer: session.answer }];
}

function sessionStatusToConversationStatus(status: QASession['status']): ConversationStatus {
  return status;
}

function messageStatusFromSessionStatus(status: QASession['status']): ConversationMessage['status'] {
  if (status === 'cancelled') {
    return 'interrupted';
  }
  if (status === 'errored') {
    return 'failed';
  }
  if (status === 'streaming') {
    return 'generating';
  }
  return 'completed';
}
