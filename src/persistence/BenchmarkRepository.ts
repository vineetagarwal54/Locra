// Persists the timing of every SUCCESSFULLY completed assistant attempt so the
// user-facing Benchmarks screen can chart real device performance. Never records
// failed, interrupted, or cancelled attempts (the store only calls `record` on a
// completed turn), and never participates in context/retrieval or generation.

import type { BenchmarkKind, BenchmarkRunRow, PerformanceMetrics } from '../types/models';

import { clampLimit } from './paging';
import { type SqliteDriver } from './types';

export interface RecordBenchmarkInput {
  conversationId: string;
  messageId: string | null;
  kind: BenchmarkKind;
  metrics: PerformanceMetrics;
  createdAt?: number;
}

export interface BenchmarkRepositoryDeps {
  now?: () => number;
  createId?: () => string;
}

/** Optional kind filter for the Benchmarks screen's Text/Image toggle. */
export type BenchmarkFilter = BenchmarkKind | 'all';

export class BenchmarkRepository {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly driver: SqliteDriver, deps: BenchmarkRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => `benchmark-${Math.random().toString(36).slice(2, 12)}`);
  }

  /** Inserts one run from a completed attempt's measured metrics. */
  record(input: RecordBenchmarkInput): BenchmarkRunRow {
    const row: BenchmarkRunRow = {
      id: this.createId(),
      conversation_id: input.conversationId,
      message_id: input.messageId,
      kind: input.kind,
      model_load_time_ms: input.metrics.modelLoadTimeMs,
      preprocessing_time_ms: input.metrics.preprocessingTimeMs,
      first_token_latency_ms: input.metrics.firstTokenLatencyMs,
      tokens_per_second: input.metrics.tokensPerSecond,
      total_wall_time_ms: input.metrics.totalWallTimeMs,
      created_at: input.createdAt ?? this.now(),
    };
    this.driver.runSync(
      `INSERT INTO benchmark_run
         (id, conversation_id, message_id, kind, model_load_time_ms, preprocessing_time_ms,
          first_token_latency_ms, tokens_per_second, total_wall_time_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.conversation_id,
        row.message_id,
        row.kind,
        row.model_load_time_ms,
        row.preprocessing_time_ms,
        row.first_token_latency_ms,
        row.tokens_per_second,
        row.total_wall_time_ms,
        row.created_at,
      ],
    );
    return row;
  }

  /** Newest-first runs, optionally filtered by kind, bounded to `limit` (≤50). */
  listRecent(filter: BenchmarkFilter = 'all', limit = 50): BenchmarkRunRow[] {
    const bounded = clampLimit(limit);
    if (filter === 'all') {
      return this.driver.getAllSync<BenchmarkRunRow>(
        `SELECT * FROM benchmark_run ORDER BY created_at DESC, id DESC LIMIT ?`,
        [bounded],
      );
    }
    return this.driver.getAllSync<BenchmarkRunRow>(
      `SELECT * FROM benchmark_run WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [filter, bounded],
    );
  }

  /** Count of successful runs (used to gate the empty state). */
  count(filter: BenchmarkFilter = 'all'): number {
    const row = filter === 'all'
      ? this.driver.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM benchmark_run')
      : this.driver.getFirstSync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM benchmark_run WHERE kind = ?',
          [filter],
        );
    return row?.n ?? 0;
  }
}
