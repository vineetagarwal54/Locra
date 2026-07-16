// T019 — message read/paginate surface over the canonical SQL store. Messages
// page by (created_at DESC, id DESC) within a conversation so a long chat never
// loads its full history into memory (FR-002/003). User rows are immutable on
// insert; assistant streaming text is mutable only while `generating`, and
// terminal states freeze (FR-008/009/010) — the attempt lifecycle (create/
// activate/projection) lands in US2 (T026/T027).

import type { AttemptStatus, GenerationFinishReason, MessageRow } from '../types/models';

import { clampLimit, toPage } from './paging';
import { runInTransaction } from './sqlite/Transactions';
import { type Keyset, type Page, type SqliteDriver } from './types';

export interface AppendUserMessageInput {
  id?: string;
  conversationId: string;
  text: string;
  createdAt?: number;
}

export interface CreateAssistantAttemptInput {
  id?: string;
  createdAt?: number;
}

export interface MessageRepositoryDeps {
  now?: () => number;
  createId?: () => string;
}

export class MessageRepository {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly driver: SqliteDriver, deps: MessageRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? (() => `message-${Math.random().toString(36).slice(2, 12)}`);
  }

  /** One bounded page of a conversation's messages, newest first. */
  listMessages(cursor: { conversationId: string; before?: Keyset; limit: number }): Page<MessageRow> {
    const limit = clampLimit(cursor.limit);
    const rows = cursor.before === undefined
      ? this.driver.getAllSync<MessageRow>(
          `SELECT * FROM message
             WHERE conversation_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
          [cursor.conversationId, limit + 1],
        )
      : this.driver.getAllSync<MessageRow>(
          `SELECT * FROM message
             WHERE conversation_id = ?
               AND (created_at < ? OR (created_at = ? AND id < ?))
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
          [cursor.conversationId, cursor.before.ts, cursor.before.ts, cursor.before.id, limit + 1],
        );
    return toPage(rows, limit, (row) => ({ ts: row.created_at, id: row.id }));
  }

  countMessages(conversationId: string): number {
    const row = this.driver.getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM message WHERE conversation_id = ?',
      [conversationId],
    );
    return row?.n ?? 0;
  }

  /** Converts rows left generating by a terminated process into recoverable attempts. */
  reconcileGeneratingAttempts(errorMessage = 'Response interrupted before completion.'): number {
    return this.driver.runSync(
      `UPDATE message
       SET status = 'interrupted', error_message = ?, finish_reason = 'cancelled', finalized_at = ?
       WHERE role = 'assistant' AND status = 'generating'`,
      [errorMessage, this.now()],
    ).changes;
  }

  getMessage(id: string): MessageRow | null {
    return this.driver.getFirstSync<MessageRow>('SELECT * FROM message WHERE id = ?', [id]);
  }

  /** Inserts an immutable user message (`status = 'submitted'`). */
  appendUserMessage(input: AppendUserMessageInput): MessageRow {
    const timestamp = input.createdAt ?? this.now();
    const row: MessageRow = {
      id: input.id ?? this.createId(),
      conversation_id: input.conversationId,
      role: 'user',
      reply_to_message_id: null,
      attempt_number: null,
      is_active_attempt: 0,
      text: input.text,
      status: 'submitted',
      error_message: null,
      finish_reason: null,
      finalized_at: null,
      created_at: timestamp,
    };
    this.driver.runSync(
      `INSERT INTO message
         (id, conversation_id, role, reply_to_message_id, attempt_number, is_active_attempt,
          text, status, error_message, finish_reason, finalized_at, created_at)
       VALUES (?, ?, 'user', NULL, NULL, 0, ?, 'submitted', NULL, NULL, NULL, ?)`,
      [row.id, row.conversation_id, row.text, row.created_at],
    );
    return row;
  }

  /** Appends streaming text to an assistant attempt — only while it is generating. */
  updateAssistantStreamingText(attemptId: string, text: string): void {
    this.driver.runSync(
      `UPDATE message SET text = ?
         WHERE id = ? AND role = 'assistant' AND status = 'generating'`,
      [text, attemptId],
    );
  }

  /** Freezes an assistant attempt into a terminal status. Only a generating row transitions. */
  finalizeAttempt(
    attemptId: string,
    status: Exclude<AttemptStatus, 'submitted' | 'generating'>,
    errorMessage: string | null = null,
    finishReason: GenerationFinishReason | null = null,
  ): void {
    this.driver.runSync(
      `UPDATE message SET status = ?, error_message = ?, finish_reason = ?, finalized_at = ?
         WHERE id = ? AND role = 'assistant' AND status = 'generating'`,
      [status, errorMessage, finishReason, this.now(), attemptId],
    );
  }

  /**
   * Creates a new assistant attempt for a user message (a retry appends rather
   * than overwrites, FR-011). The new attempt gets the next `attempt_number` and
   * becomes the active attempt; any prior active attempt for the same user
   * message is cleared first so the one-active partial unique index holds.
   */
  createAssistantAttempt(
    replyToUserMessageId: string,
    input: CreateAssistantAttemptInput = {},
  ): MessageRow {
    return runInTransaction(this.driver, () => {
      const user = this.driver.getFirstSync<{ conversation_id: string }>(
        `SELECT conversation_id FROM message WHERE id = ? AND role = 'user'`,
        [replyToUserMessageId],
      );
      if (user === null) {
        throw new Error(`User message ${replyToUserMessageId} was not found.`);
      }
      const maxRow = this.driver.getFirstSync<{ n: number | null }>(
        `SELECT MAX(attempt_number) AS n FROM message WHERE reply_to_message_id = ?`,
        [replyToUserMessageId],
      );
      const attemptNumber = (maxRow?.n ?? 0) + 1;
      this.driver.runSync(
        `UPDATE message SET is_active_attempt = 0
           WHERE reply_to_message_id = ? AND is_active_attempt = 1`,
        [replyToUserMessageId],
      );
      const row: MessageRow = {
        id: input.id ?? this.createId(),
        conversation_id: user.conversation_id,
        role: 'assistant',
        reply_to_message_id: replyToUserMessageId,
        attempt_number: attemptNumber,
        is_active_attempt: 1,
        text: '',
        status: 'generating',
        error_message: null,
        finish_reason: null,
        finalized_at: null,
        created_at: input.createdAt ?? this.now(),
      };
      this.driver.runSync(
        `INSERT INTO message
           (id, conversation_id, role, reply_to_message_id, attempt_number, is_active_attempt,
            text, status, error_message, finish_reason, finalized_at, created_at)
         VALUES (?, ?, 'assistant', ?, ?, 1, '', 'generating', NULL, NULL, NULL, ?)`,
        [row.id, row.conversation_id, row.reply_to_message_id, row.attempt_number, row.created_at],
      );
      return row;
    });
  }

  /**
   * Marks a different existing attempt active for its user message. Selection
   * metadata only — never mutates any attempt's text or status (FR-012).
   */
  setActiveAttempt(replyToUserMessageId: string, attemptId: string): void {
    runInTransaction(this.driver, () => {
      const belongs = this.driver.getFirstSync<{ id: string }>(
        `SELECT id FROM message
           WHERE id = ? AND reply_to_message_id = ? AND role = 'assistant'`,
        [attemptId, replyToUserMessageId],
      );
      if (belongs === null) {
        throw new Error(`Attempt ${attemptId} is not an attempt of ${replyToUserMessageId}.`);
      }
      this.driver.runSync(
        `UPDATE message SET is_active_attempt = 0 WHERE reply_to_message_id = ?`,
        [replyToUserMessageId],
      );
      this.driver.runSync(`UPDATE message SET is_active_attempt = 1 WHERE id = ?`, [attemptId]);
    });
  }

  /**
   * Canonical conversation projection (FR-013): user messages in order, each
   * followed by its active assistant attempt only when that attempt is
   * `completed`. Failed, interrupted, generating, and superseded attempts are
   * excluded from normal context.
   */
  getCanonicalProjection(conversationId: string): MessageRow[] {
    const users = this.driver.getAllSync<MessageRow>(
      `SELECT * FROM message
         WHERE conversation_id = ? AND role = 'user'
         ORDER BY created_at ASC, id ASC`,
      [conversationId],
    );
    const answers = this.driver.getAllSync<MessageRow>(
      `SELECT * FROM message
         WHERE conversation_id = ? AND role = 'assistant'
           AND is_active_attempt = 1 AND status = 'completed'`,
      [conversationId],
    );
    const answerByReply = new Map<string, MessageRow>();
    for (const answer of answers) {
      if (answer.reply_to_message_id !== null) {
        answerByReply.set(answer.reply_to_message_id, answer);
      }
    }
    const projection: MessageRow[] = [];
    for (const user of users) {
      projection.push(user);
      const answer = answerByReply.get(user.id);
      if (answer !== undefined) {
        projection.push(answer);
      }
    }
    return projection;
  }

  /** User rows plus the selected attempt in any state for bounded UI rendering. */
  getActiveProjection(conversationId: string): MessageRow[] {
    const users = this.driver.getAllSync<MessageRow>(
      `SELECT * FROM message WHERE conversation_id = ? AND role = 'user'
       ORDER BY created_at ASC, id ASC`,
      [conversationId],
    );
    const attempts = this.driver.getAllSync<MessageRow>(
      `SELECT * FROM message WHERE conversation_id = ? AND role = 'assistant'
         AND is_active_attempt = 1`,
      [conversationId],
    );
    const byReply = new Map<string, MessageRow>();
    for (const attempt of attempts) {
      if (attempt.reply_to_message_id !== null) {
        byReply.set(attempt.reply_to_message_id, attempt);
      }
    }
    return users.flatMap((user) => {
      const attempt = byReply.get(user.id);
      return attempt === undefined ? [user] : [user, attempt];
    });
  }

  /** All assistant attempts (every status) for diagnostics — never used for normal context (FR-014). */
  listAllAttempts(conversationId: string): MessageRow[] {
    return this.driver.getAllSync<MessageRow>(
      `SELECT * FROM message
         WHERE conversation_id = ? AND role = 'assistant'
         ORDER BY reply_to_message_id ASC, attempt_number ASC`,
      [conversationId],
    );
  }
}
