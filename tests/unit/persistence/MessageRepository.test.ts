// T016 — MessageRepository against a real (node:sqlite) database.

import { MessageRepository } from '../../../src/persistence/MessageRepository';
import type { SqliteDriver } from '../../../src/persistence/types';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

function createConversation(driver: SqliteDriver, id: string): void {
  driver.runSync(
    `INSERT INTO conversation (id, title, normalized_title, response_mode, created_at, updated_at, deleted_at)
     VALUES (?, NULL, NULL, 'medium', 1, 1, NULL)`,
    [id],
  );
}

function insertAssistantAttempt(driver: SqliteDriver, id: string, conversationId: string, userId: string): void {
  driver.runSync(
    `INSERT INTO message (id, conversation_id, role, reply_to_message_id, attempt_number,
       is_active_attempt, text, status, error_message, finalized_at, created_at)
     VALUES (?, ?, 'assistant', ?, 1, 1, '', 'generating', NULL, NULL, 2)`,
    [id, conversationId, userId],
  );
}

describe('MessageRepository', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
    createConversation(db.driver, 'c1');
  });
  afterEach(() => db.close());

  it('appends immutable user messages and counts them', () => {
    const repo = new MessageRepository(db.driver, { now: () => 5 });
    const row = repo.appendUserMessage({ id: 'm1', conversationId: 'c1', text: 'hello' });
    expect(row.role).toBe('user');
    expect(row.status).toBe('submitted');
    expect(row.reply_to_message_id).toBeNull();
    expect(repo.countMessages('c1')).toBe(1);
  });

  it('pages messages newest-first via bounded keyset pagination', () => {
    const repo = new MessageRepository(db.driver);
    for (let i = 0; i < 7; i += 1) {
      repo.appendUserMessage({ id: `m${i}`, conversationId: 'c1', text: `q${i}`, createdAt: i + 1 });
    }

    const first = repo.listMessages({ conversationId: 'c1', limit: 3 });
    expect(first.items.map((m) => m.id)).toEqual(['m6', 'm5', 'm4']);
    expect(first.nextCursor).not.toBeNull();

    const second = repo.listMessages({ conversationId: 'c1', before: first.nextCursor!, limit: 3 });
    expect(second.items.map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);

    const third = repo.listMessages({ conversationId: 'c1', before: second.nextCursor!, limit: 3 });
    expect(third.items.map((m) => m.id)).toEqual(['m0']);
    expect(third.nextCursor).toBeNull();
  });

  it('isolates messages to their conversation', () => {
    createConversation(db.driver, 'c2');
    const repo = new MessageRepository(db.driver);
    repo.appendUserMessage({ id: 'a', conversationId: 'c1', text: 'x', createdAt: 1 });
    repo.appendUserMessage({ id: 'b', conversationId: 'c2', text: 'y', createdAt: 1 });

    expect(repo.listMessages({ conversationId: 'c1', limit: 50 }).items.map((m) => m.id)).toEqual(['a']);
    expect(repo.countMessages('c2')).toBe(1);
  });

  it('streams assistant text only while generating, then freezes on finalize', () => {
    const repo = new MessageRepository(db.driver, { now: () => 99 });
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q', createdAt: 1 });
    insertAssistantAttempt(db.driver, 'a1', 'c1', 'u1');

    repo.updateAssistantStreamingText('a1', 'partial');
    let row = db.driver.getFirstSync<{ text: string; status: string }>(
      'SELECT text, status FROM message WHERE id = ?',
      ['a1'],
    );
    expect(row?.text).toBe('partial');

    repo.finalizeAttempt('a1', 'completed');
    row = db.driver.getFirstSync('SELECT text, status FROM message WHERE id = ?', ['a1']);
    expect(row?.status).toBe('completed');

    // A terminal attempt is immutable — further streaming updates are no-ops.
    repo.updateAssistantStreamingText('a1', 'should-not-apply');
    row = db.driver.getFirstSync('SELECT text, status FROM message WHERE id = ?', ['a1']);
    expect(row?.text).toBe('partial');
  });
});
