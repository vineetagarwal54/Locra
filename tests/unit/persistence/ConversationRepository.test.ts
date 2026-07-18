// T015 — ConversationRepository against a real (node:sqlite) database.

import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { MessageRepository } from '../../../src/persistence/MessageRepository';
import type { SqliteDriver } from '../../../src/persistence/types';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

function seedImageBearingConversation(driver: SqliteDriver, conversationId: string): string[] {
  const messageId = `${conversationId}-user`;
  const assetId = `${conversationId}-asset`;
  const localPath = `/images/${conversationId}.jpg`;
  driver.runSync(
    `INSERT INTO message (id, conversation_id, role, reply_to_message_id, attempt_number,
       is_active_attempt, text, status, error_message, finalized_at, created_at)
     VALUES (?, ?, 'user', NULL, NULL, 0, 'hi', 'submitted', NULL, NULL, 1)`,
    [messageId, conversationId],
  );
  driver.runSync(
    `INSERT INTO image_asset (id, conversation_id, local_path, available, content_hash, created_at)
     VALUES (?, ?, ?, 1, NULL, 1)`,
    [assetId, conversationId, localPath],
  );
  driver.runSync(
    `INSERT INTO message_image (message_id, image_asset_id, ordinal, created_at)
     VALUES (?, ?, 0, 1)`,
    [messageId, assetId],
  );
  return [localPath];
}

describe('ConversationRepository', () => {
  let db: TestDatabase;

  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it('creates a conversation copying the global default mode (lowercase)', () => {
    const repo = new ConversationRepository(db.driver, {
      getDefaultResponseMode: () => 'high',
      now: () => 100,
    });
    const created = repo.createConversation({ id: 'c1', title: 'Trip' });
    expect(created.response_mode).toBe('high');
    expect(created.normalized_title).toBeNull();

    const fetched = repo.getConversation('c1');
    expect(fetched).not.toBeNull();
    expect(fetched?.response_mode).toBe('high');
    expect(fetched?.created_at).toBe(100);
  });

  it('lists conversations newest-first via bounded keyset pagination', () => {
    let clock = 0;
    const repo = new ConversationRepository(db.driver, { now: () => (clock += 1) });
    for (let i = 0; i < 7; i += 1) {
      repo.createConversation({ id: `c${i}`, title: `t${i}` });
    }

    const first = repo.listConversations({ limit: 3 });
    expect(first.items.map((c) => c.id)).toEqual(['c6', 'c5', 'c4']);
    expect(first.nextCursor).not.toBeNull();

    const second = repo.listConversations({ before: first.nextCursor!, limit: 3 });
    expect(second.items.map((c) => c.id)).toEqual(['c3', 'c2', 'c1']);

    const third = repo.listConversations({ before: second.nextCursor!, limit: 3 });
    expect(third.items.map((c) => c.id)).toEqual(['c0']);
    expect(third.nextCursor).toBeNull();
  });

  it('caps page size at the maximum of 50', () => {
    const repo = new ConversationRepository(db.driver, { now: () => Date.now() });
    for (let i = 0; i < 60; i += 1) {
      repo.createConversation({ id: `x${String(i).padStart(3, '0')}` });
    }
    const page = repo.listConversations({ limit: 1000 });
    expect(page.items.length).toBe(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it('returns canonical previews and image metadata, and searches canonical SQL content', () => {
    const repo = new ConversationRepository(db.driver, { now: () => 1 });
    const messages = new MessageRepository(db.driver);
    repo.createConversation({ id: 'answer', title: 'Answer chat' });
    const answerUser = messages.appendUserMessage({ id: 'answer-user', conversationId: 'answer', text: 'question' });
    const answer = messages.createAssistantAttempt(answerUser.id, { id: 'answer-assistant' });
    messages.updateAssistantStreamingText(answer.id, 'canonical answer');
    messages.finalizeAttempt(answer.id, 'completed');
    db.driver.runSync(
      `INSERT INTO image_asset (id, conversation_id, local_path, available, content_hash, created_at)
       VALUES ('answer-asset', 'answer', '/images/answer.jpg', 1, NULL, 1)`,
    );
    db.driver.runSync(
      `INSERT INTO message_image (message_id, image_asset_id, ordinal, created_at)
       VALUES ('answer-user', 'answer-asset', 0, 1)`,
    );

    repo.createConversation({ id: 'user', title: 'User chat' });
    messages.appendUserMessage({ id: 'user-message', conversationId: 'user', text: 'needle in user text' });

    repo.createConversation({ id: 'failed', title: 'Failed chat' });
    const failedUser = messages.appendUserMessage({ id: 'failed-user', conversationId: 'failed', text: 'visible user' });
    const failed = messages.createAssistantAttempt(failedUser.id, { id: 'failed-assistant' });
    messages.updateAssistantStreamingText(failed.id, 'do-not-search-this');
    messages.finalizeAttempt(failed.id, 'failed');

    const answerRow = repo.listConversations({ limit: 50 }).items.find((row) => row.id === 'answer');
    expect(answerRow?.latest_message_preview).toBe('canonical answer');
    expect(answerRow?.has_image).toBe(1);

    expect(repo.searchConversations('needle').map((row) => row.id)).toEqual(['user']);
    expect(repo.searchConversations('canonical').map((row) => row.id)).toEqual(['answer']);
    expect(repo.searchConversations('do-not-search-this')).toEqual([]);
  });

  it('deletes a conversation and cascades to all child rows, unlinking image files', () => {
    const unlinked: string[][] = [];
    const repo = new ConversationRepository(db.driver, {
      now: () => 1,
      onUnlinkImageFiles: (paths) => unlinked.push([...paths]),
    });
    repo.createConversation({ id: 'c1', title: 'has image' });
    const paths = seedImageBearingConversation(db.driver, 'c1');

    repo.deleteConversation('c1');

    expect(repo.getConversation('c1')).toBeNull();
    expect(db.driver.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM message')?.n).toBe(0);
    expect(db.driver.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM image_asset')?.n).toBe(0);
    expect(db.driver.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM message_image')?.n).toBe(0);
    expect(unlinked).toEqual([paths]);
  });

  it('updateConversation touches updated_at only when asked', () => {
    let clock = 10;
    const repo = new ConversationRepository(db.driver, { now: () => (clock += 10) });
    repo.createConversation({ id: 'c1', title: 'old' });
    const before = repo.getConversation('c1')!;

    repo.updateConversation('c1', { title: 'renamed' }); // no touch
    expect(repo.getConversation('c1')?.updated_at).toBe(before.updated_at);
    expect(repo.getConversation('c1')?.title).toBe('renamed');

    repo.updateConversation('c1', { touch: true });
    expect(repo.getConversation('c1')?.updated_at).toBeGreaterThan(before.updated_at);
  });
});
