import { storage } from '../storage/mmkv';
import type { IHistoryStore } from '../types/interfaces';
import type { MetricsSummary, QASession } from '../types/models';

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

  save(session: QASession): void {
    this.store.set(toSessionKey(session.id), JSON.stringify(session));
    this.writeIds(this.mergeIds(session.id));
  }

  get(id: string): QASession | null {
    return readSession(this.store.getString(toSessionKey(id)));
  }

  list(limit?: number, offset?: number): QASession[] {
    const start = Math.max(0, offset ?? 0);
    const count = limit === undefined ? undefined : Math.max(0, limit);
    const sessions = this.readIds()
      .map((id) => this.get(id))
      .filter((session): session is QASession => session !== null)
      .sort((a, b) => b.createdAt - a.createdAt);

    return count === undefined ? sessions.slice(start) : sessions.slice(start, start + count);
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
    const session = this.get(id);
    if (session === null) {
      return;
    }

    this.save({
      ...session,
      flagged,
      flagNote: note ?? null,
    });
  }

  getMetricsSummary(): MetricsSummary {
    const completedWithMetrics = this.list().filter((session) => session.metrics !== null);
    if (completedWithMetrics.length === 0) {
      return { ...EMPTY_METRICS_SUMMARY };
    }

    const totals = completedWithMetrics.reduce(
      (acc, session) => {
        const metrics = session.metrics;
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

function readSession(rawSession: string | undefined): QASession | null {
  if (rawSession === undefined) {
    return null;
  }
  try {
    return JSON.parse(rawSession) as QASession;
  } catch {
    return null;
  }
}
