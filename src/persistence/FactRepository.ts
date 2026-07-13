import type { DurableFactRow, DurableFactType } from '../types/models';

import { runInTransaction } from './sqlite/Transactions';
import type { SqliteDriver } from './types';

export interface UpsertFactInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly normalizedKey: string;
  readonly valueText: string;
  readonly factType: DurableFactType;
  readonly extractionVersion: string;
  readonly sourceViewHash: string;
  readonly sourceMessageIds: readonly string[];
}

export interface FactRepositoryDeps {
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class FactRepository {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly driver: SqliteDriver, deps: FactRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => `fact-${Math.random().toString(36).slice(2, 12)}`);
  }

  upsert(input: UpsertFactInput): DurableFactRow {
    const normalizedKey = normalizeFactKey(input.normalizedKey);
    if (normalizedKey === '' || input.sourceMessageIds.length === 0) {
      throw new Error('A durable fact requires a normalized key and at least one source.');
    }
    return runInTransaction(this.driver, () => {
      const existing = this.driver.getFirstSync<DurableFactRow>(
        `SELECT * FROM durable_fact WHERE conversation_id = ? AND normalized_key = ?
           AND status = 'ready' LIMIT 1`,
        [input.conversationId, normalizedKey],
      );
      if (existing !== null && existing.value_text === input.valueText) {
        this.linkSources(existing.id, input.sourceMessageIds);
        return existing;
      }
      const now = this.now();
      if (existing !== null) {
        this.driver.runSync(
          "UPDATE durable_fact SET status = 'superseded', updated_at = ? WHERE id = ?",
          [now, existing.id],
        );
      }
      const row: DurableFactRow = {
        id: input.id ?? this.createId(),
        conversation_id: input.conversationId,
        normalized_key: normalizedKey,
        value_text: input.valueText,
        fact_type: input.factType,
        extraction_version: input.extractionVersion,
        status: 'ready',
        supersedes_fact_id: existing?.id ?? null,
        source_view_hash: input.sourceViewHash,
        created_at: now,
        updated_at: now,
      };
      this.driver.runSync(
        `INSERT INTO durable_fact
           (id, conversation_id, normalized_key, value_text, fact_type, extraction_version,
            status, supersedes_fact_id, source_view_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
        [row.id, row.conversation_id, row.normalized_key, row.value_text, row.fact_type,
          row.extraction_version, row.supersedes_fact_id, row.source_view_hash,
          row.created_at, row.updated_at],
      );
      this.linkSources(row.id, input.sourceMessageIds);
      return row;
    });
  }

  getReadyFacts(conversationId: string): DurableFactRow[] {
    return this.driver.getAllSync<DurableFactRow>(
      `SELECT * FROM durable_fact WHERE conversation_id = ? AND status = 'ready'
       ORDER BY updated_at DESC, id ASC LIMIT 100`, [conversationId],
    );
  }

  getSourceMessageIds(factId: string): string[] {
    return this.driver.getAllSync<{ message_id: string }>(
      'SELECT message_id FROM durable_fact_source WHERE fact_id = ? ORDER BY message_id ASC',
      [factId],
    ).map((row) => row.message_id);
  }

  markStale(id: string): void {
    this.driver.runSync(
      "UPDATE durable_fact SET status = 'stale', updated_at = ? WHERE id = ? AND status = 'ready'",
      [this.now(), id],
    );
  }

  private linkSources(factId: string, messageIds: readonly string[]): void {
    for (const messageId of [...new Set(messageIds)]) {
      this.driver.runSync(
        'INSERT OR IGNORE INTO durable_fact_source (fact_id, message_id) VALUES (?, ?)',
        [factId, messageId],
      );
    }
  }
}

export function normalizeFactKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

