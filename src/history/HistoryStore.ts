import { storage } from '../storage/mmkv';
import type { IHistoryStore } from '../types/interfaces';
import type {
  Conversation,
  ConversationMessage,
  ConversationStatus,
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

  save(conversation: Conversation | QASession): void {
    const normalized = normalizeConversationInput(conversation);
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

function normalizeConversationInput(conversation: Conversation | QASession): Conversation {
  if ('messages' in conversation) {
    return {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        attachments: message.attachments ?? [],
        errorMessage: message.errorMessage ?? null,
      })),
      errorMessage: conversation.errorMessage ?? null,
      metrics: conversation.metrics ?? null,
      flagNote: conversation.flagNote ?? null,
    };
  }

  return sessionToConversation(conversation);
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

export function conversationToSession(conversation: Conversation): QASession {
  const firstUser = conversation.messages.find((message) => message.role === 'user');
  const lastAssistant = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  const turns = toLegacyTurns(conversation.messages);

  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    imagePath: firstUser?.attachments.find((attachment) => attachment.kind === 'image')?.path ?? '',
    question: firstUser?.text ?? '',
    answer: lastAssistant?.text ?? '',
    turns,
    pinnedExtraction: null,
    hiddenEvidence: null,
    status: conversationStatusToSessionStatus(conversation.status),
    errorMessage: conversation.errorMessage,
    metrics: conversation.metrics,
    flagged: conversation.flagged,
    flagNote: conversation.flagNote ?? null,
  };
}

function normalizedTurns(session: QASession): Array<{ question: string; answer: string }> {
  return session.turns.length > 0
    ? session.turns
    : [{ question: session.question, answer: session.answer }];
}

function toLegacyTurns(messages: ConversationMessage[]): Array<{ question: string; answer: string }> {
  const turns: Array<{ question: string; answer: string }> = [];
  let pendingQuestion: string | null = null;

  for (const message of messages) {
    if (message.role === 'user') {
      pendingQuestion = message.text;
      continue;
    }

    if (pendingQuestion !== null) {
      turns.push({ question: pendingQuestion, answer: message.text });
      pendingQuestion = null;
    }
  }

  return turns;
}

function sessionStatusToConversationStatus(status: QASession['status']): ConversationStatus {
  return status;
}

function conversationStatusToSessionStatus(status: ConversationStatus): QASession['status'] {
  return status === 'idle' ? 'completed' : status;
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
