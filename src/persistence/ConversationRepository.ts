// T018 — conversation reads/writes over the canonical SQL store. Every list query
// is bounded and keyset-paginated on (updated_at DESC, id DESC); deletion is one
// transaction that cascades to all children (FR-001/003/004, SC-014).

import type { ConversationRow, StoredResponseMode } from '../types/models';

import { clampLimit, toPage } from './paging';
import { runInTransaction } from './sqlite/Transactions';
import { type Keyset, type Page, type SqliteDriver } from './types';
import { MAX_PAGE_SIZE } from './types';

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

export interface ConversationTargetCandidateRow {
  readonly id: string;
  readonly title: string;
  readonly normalized_title: string;
  readonly created_at: number;
  readonly updated_at: number;
}

const CONVERSATION_SELECT = `
  SELECT conversation.*,
    COALESCE(
      (
        SELECT CASE
          WHEN message.role = 'assistant' THEN NULLIF(TRIM(message.text), '')
          ELSE NULLIF(TRIM(message.text), '')
        END
        FROM message
        WHERE message.conversation_id = conversation.id
          AND (
            message.role = 'user'
            OR (message.role = 'assistant' AND message.is_active_attempt = 1 AND message.status = 'completed')
          )
        ORDER BY message.created_at DESC,
          CASE WHEN message.role = 'assistant' THEN 1 ELSE 0 END DESC,
          message.id DESC
        LIMIT 1
      ),
      (
        SELECT NULLIF(TRIM(message.text), '')
        FROM message
        WHERE message.conversation_id = conversation.id AND message.role = 'user'
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ),
      conversation.title
    ) AS latest_message_preview,
    EXISTS (
      SELECT 1
      FROM message_image
      JOIN message ON message.id = message_image.message_id
      WHERE message.conversation_id = conversation.id
    ) AS has_image
  FROM conversation`;

/** Deterministic title normalization for candidate lookup (US7) and dedup. */
export function normalizeTitle(title: string | null | undefined): string | null {
  if (title === null || title === undefined) {
    return null;
  }
  const normalized = title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
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
          `${CONVERSATION_SELECT}
             WHERE conversation.deleted_at IS NULL
             ORDER BY conversation.updated_at DESC, conversation.id DESC
             LIMIT ?`,
          [limit + 1],
        )
      : this.driver.getAllSync<ConversationRow>(
          `${CONVERSATION_SELECT}
             WHERE conversation.deleted_at IS NULL
               AND (conversation.updated_at < ? OR (conversation.updated_at = ? AND conversation.id < ?))
             ORDER BY conversation.updated_at DESC, conversation.id DESC
             LIMIT ?`,
          [cursor.before.ts, cursor.before.ts, cursor.before.id, limit + 1],
        );
    return toPage(rows, limit, (row) => ({ ts: row.updated_at, id: row.id }));
  }

  /** Bounded SQL search across titles and canonical searchable messages. */
  searchConversations(query: string, limit = MAX_PAGE_SIZE): ConversationRow[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery === '') {
      return [];
    }
    const pattern = `%${normalizedQuery}%`;
    return this.driver.getAllSync<ConversationRow>(
      `${CONVERSATION_SELECT}
       WHERE conversation.deleted_at IS NULL
         AND (
           LOWER(COALESCE(conversation.title, '')) LIKE ?
           OR EXISTS (
             SELECT 1 FROM message
             WHERE message.conversation_id = conversation.id
               AND message.role = 'user'
               AND LOWER(message.text) LIKE ?
           )
           OR EXISTS (
             SELECT 1 FROM message
             WHERE message.conversation_id = conversation.id
               AND message.role = 'assistant'
               AND message.is_active_attempt = 1
               AND message.status = 'completed'
               AND LOWER(message.text) LIKE ?
           )
         )
       ORDER BY conversation.updated_at DESC, conversation.id DESC
       LIMIT ?`,
      [pattern, pattern, pattern, clampLimit(limit)],
    );
  }

  getConversation(id: string): ConversationRow | null {
    return this.driver.getFirstSync<ConversationRow>(
      `${CONVERSATION_SELECT} WHERE conversation.id = ? AND conversation.deleted_at IS NULL`,
      [id],
    );
  }

  /**
   * The single most recently updated conversation other than `activeId` — the
   * referent of a natural "our previous chat" / "last time" request (US7). Returns
   * null when the active conversation is the only one.
   */
  getMostRecentOther(activeId: string): ConversationTargetCandidateRow | null {
    return this.driver.getFirstSync<ConversationTargetCandidateRow>(
      `SELECT id, title, normalized_title, created_at, updated_at FROM conversation
       WHERE deleted_at IS NULL AND id != ?
       ORDER BY updated_at DESC, id DESC LIMIT 1`,
      [activeId],
    );
  }

  findTargetCandidates(tokens: readonly string[], limit = 10): ConversationTargetCandidateRow[] {
    const boundedLimit = Math.min(10, Math.max(1, Math.floor(limit)));
    const normalizedTokens = tokens.map((token) => normalizeTitle(token)).filter(
      (token): token is string => token !== null,
    );
    if (normalizedTokens.length === 0) {
      return this.driver.getAllSync<ConversationTargetCandidateRow>(
        `SELECT id, title, normalized_title, created_at, updated_at FROM conversation
         WHERE deleted_at IS NULL AND normalized_title IS NOT NULL
         ORDER BY updated_at DESC, id DESC LIMIT ?`, [boundedLimit],
      );
    }
    const conditions = normalizedTokens.map(() => 'normalized_title LIKE ?').join(' AND ');
    return this.driver.getAllSync<ConversationTargetCandidateRow>(
      `SELECT id, title, normalized_title, created_at, updated_at FROM conversation
       WHERE deleted_at IS NULL AND normalized_title IS NOT NULL AND ${conditions}
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      [...normalizedTokens.map((token) => `%${token}%`), boundedLimit],
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
      latest_message_preview: null,
      has_image: 0,
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
