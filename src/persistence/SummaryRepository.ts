import type { SummaryRow } from '../types/models';

import { runInTransaction } from './sqlite/Transactions';
import type { SqliteDriver } from './types';

export interface SaveSummaryInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly firstSourceMessageId: string;
  readonly lastSourceMessageId: string;
  readonly sourceViewHash: string;
  readonly summarizerVersion: string;
  readonly text: string;
}

export interface SummaryRepositoryDeps {
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class SummaryRepository {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly driver: SqliteDriver, deps: SummaryRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => `summary-${Math.random().toString(36).slice(2, 12)}`);
  }

  save(input: SaveSummaryInput): SummaryRow {
    return runInTransaction(this.driver, () => this.saveInTransaction(input));
  }

  private saveInTransaction(input: SaveSummaryInput): SummaryRow {
    const now = this.now();
    const prior = this.getNewestReady(input.conversationId);
    const version = (this.driver.getFirstSync<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM summary WHERE conversation_id = ?',
      [input.conversationId],
    )?.version ?? 0) + 1;
    if (prior !== null) {
      this.driver.runSync(
        "UPDATE summary SET status = 'superseded', updated_at = ? WHERE id = ?",
        [now, prior.id],
      );
    }
    const row: SummaryRow = {
      id: input.id ?? this.createId(),
      conversation_id: input.conversationId,
      first_source_message_id: input.firstSourceMessageId,
      last_source_message_id: input.lastSourceMessageId,
      source_view_hash: input.sourceViewHash,
      summarizer_version: input.summarizerVersion,
      text: input.text,
      status: 'ready',
      version,
      created_at: now,
      updated_at: now,
    };
    this.driver.runSync(
      `INSERT INTO summary
         (id, conversation_id, first_source_message_id, last_source_message_id,
          source_view_hash, summarizer_version, text, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
      [row.id, row.conversation_id, row.first_source_message_id, row.last_source_message_id,
        row.source_view_hash, row.summarizer_version, row.text, row.version,
        row.created_at, row.updated_at],
    );
    return row;
  }

  getNewestReady(conversationId: string, summarizerVersion?: string): SummaryRow | null {
    return summarizerVersion === undefined
      ? this.driver.getFirstSync<SummaryRow>(
          `SELECT * FROM summary WHERE conversation_id = ? AND status = 'ready'
           ORDER BY version DESC, created_at DESC, id ASC LIMIT 1`, [conversationId],
        )
      : this.driver.getFirstSync<SummaryRow>(
          `SELECT * FROM summary WHERE conversation_id = ? AND status = 'ready'
             AND summarizer_version = ?
           ORDER BY version DESC, created_at DESC, id ASC LIMIT 1`,
          [conversationId, summarizerVersion],
        );
  }

  markStale(id: string): void {
    this.driver.runSync(
      "UPDATE summary SET status = 'stale', updated_at = ? WHERE id = ? AND status = 'ready'",
      [this.now(), id],
    );
  }
}
