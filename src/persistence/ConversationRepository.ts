// T018 — conversation reads/writes over the canonical SQL store. Every list query
// is bounded and keyset-paginated on (updated_at DESC, id DESC); deletion is one
// transaction that cascades to all children (FR-001/003/004, SC-014).

import type { ConversationRow, StoredResponseMode } from '../types/models';

import { clampLimit, toPage } from './paging';
import { runInTransaction } from './sqlite/Transactions';
import { type Keyset, type Page, type SqliteDriver } from './types';

export interface CreateConversationInput {
  id?: string;
  title?: string | null;
  /** Overrides the copied global default (still stored lowercase). */
  responseMode?: StoredResponseMode;
}

export interface UpdateConversationPatch {
  title?: string | null;
  responseMode?: StoredResponseMode;
  /** When true, bumps `updated_at` so the conversation re-sorts to the top. */
  touch?: boolean;
}

export interface ConversationRepositoryDeps {
  now?: () => number;
  createId?: () => string;
  /** Copied into new conversations (FR-034). */
  getDefaultResponseMode?: () => StoredResponseMode;
  /** Invoked with local paths of image files that became unreferenced by a delete. */
  onUnlinkImageFiles?: (paths: ReadonlyArray<string>) => void;
}

/** Deterministic title normalization for candidate lookup (US7) and dedup. */
export function normalizeTitle(title: string | null | undefined): string | null {
  if (title === null || title === undefined) {
    return null;
  }
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized === '' ? null : normalized;
}

export class ConversationRepository {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly getDefaultResponseMode: () => StoredResponseMode;
  private readonly onUnlinkImageFiles: ((paths: ReadonlyArray<string>) => void) | null;

  constructor(private readonly driver: SqliteDriver, deps: ConversationRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? defaultCreateId;
    this.getDefaultResponseMode = deps.getDefaultResponseMode ?? ((): StoredResponseMode => 'medium');
    this.onUnlinkImageFiles = deps.onUnlinkImageFiles ?? null;
  }

  /** One bounded page of non-deleted conversations, newest first. */
  listConversations(cursor: { before?: Keyset; limit: number }): Page<ConversationRow> {
    const limit = clampLimit(cursor.limit);
    const rows = cursor.before === undefined
      ? this.driver.getAllSync<ConversationRow>(
          `SELECT * FROM conversation
             WHERE deleted_at IS NULL
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
          [limit + 1],
        )
      : this.driver.getAllSync<ConversationRow>(
          `SELECT * FROM conversation
             WHERE deleted_at IS NULL
               AND (updated_at < ? OR (updated_at = ? AND id < ?))
             ORDER BY updated_at DESC, id DESC
             LIMIT ?`,
          [cursor.before.ts, cursor.before.ts, cursor.before.id, limit + 1],
        );
    return toPage(rows, limit, (row) => ({ ts: row.updated_at, id: row.id }));
  }

  getConversation(id: string): ConversationRow | null {
    return this.driver.getFirstSync<ConversationRow>(
      'SELECT * FROM conversation WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
  }

  createConversation(input: CreateConversationInput = {}): ConversationRow {
    const id = input.id ?? this.createId();
    const timestamp = this.now();
    const title = input.title ?? null;
    const row: ConversationRow = {
      id,
      title,
      normalized_title: normalizeTitle(title),
      response_mode: input.responseMode ?? this.getDefaultResponseMode(),
      created_at: timestamp,
      updated_at: timestamp,
      deleted_at: null,
    };
    this.driver.runSync(
      `INSERT INTO conversation
         (id, title, normalized_title, response_mode, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      [row.id, row.title, row.normalized_title, row.response_mode, row.created_at, row.updated_at],
    );
    return row;
  }

  updateConversation(id: string, patch: UpdateConversationPatch): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (patch.title !== undefined) {
      sets.push('title = ?', 'normalized_title = ?');
      params.push(patch.title, normalizeTitle(patch.title));
    }
    if (patch.responseMode !== undefined) {
      sets.push('response_mode = ?');
      params.push(patch.responseMode);
    }
    if (patch.touch === true) {
      sets.push('updated_at = ?');
      params.push(this.now());
    }
    if (sets.length === 0) {
      return;
    }
    params.push(id);
    this.driver.runSync(
      `UPDATE conversation SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
  }

  /** Per-conversation mode (US6). Stored lowercase; does not re-sort the list. */
  setResponseMode(id: string, mode: StoredResponseMode): void {
    this.driver.runSync('UPDATE conversation SET response_mode = ? WHERE id = ?', [mode, id]);
  }

  /**
   * Deletes a conversation and every child row in one transaction (FK cascade),
   * then hands the now-unreferenced image file paths to the unlink hook. Because
   * image assets are conversation-scoped, deleting the conversation makes all of
   * its image files unreferenced.
   */
  deleteConversation(id: string): void {
    const paths = runInTransaction(this.driver, () => {
      const assetPaths = this.driver
        .getAllSync<{ local_path: string }>(
          'SELECT local_path FROM image_asset WHERE conversation_id = ?',
          [id],
        )
        .map((row) => row.local_path);
      this.driver.runSync('DELETE FROM conversation WHERE id = ?', [id]);
      return assetPaths;
    });
    if (paths.length > 0 && this.onUnlinkImageFiles !== null) {
      this.onUnlinkImageFiles(paths);
    }
  }
}

function defaultCreateId(): string {
  return `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
