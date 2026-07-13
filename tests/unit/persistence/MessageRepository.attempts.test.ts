// T025 — immutable messages and safe retries (FR-008..014) against real SQLite.

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

function statusOf(driver: SqliteDriver, id: string): { text: string; status: string; is_active_attempt: number } {
  return driver.getFirstSync(
    'SELECT text, status, is_active_attempt FROM message WHERE id = ?',
    [id],
  )!;
}

describe('MessageRepository — immutable messages and retries', () => {
  let db: TestDatabase;
  let repo: MessageRepository;
  let clock: number;

  beforeEach(() => {
    db = createTestDatabase();
    createConversation(db.driver, 'c1');
    clock = 10;
    repo = new MessageRepository(db.driver, { now: () => (clock += 1) });
  });
  afterEach(() => db.close());

  it('keeps a submitted user message immutable (assistant-only mutators skip it)', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'original', createdAt: 1 });
    // Streaming/finalize target assistant rows only, so a user row cannot be mutated by them.
    repo.updateAssistantStreamingText('u1', 'tampered');
    repo.finalizeAttempt('u1', 'completed');
    expect(statusOf(db.driver, 'u1')).toMatchObject({ text: 'original', status: 'submitted' });
  });

  it('creates an assistant attempt, streams while generating, then freezes on finalize', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q', createdAt: 1 });
    const attempt = repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 2 });
    expect(attempt).toMatchObject({ attempt_number: 1, is_active_attempt: 1, status: 'generating' });

    repo.updateAssistantStreamingText('a1', 'partial answer');
    expect(statusOf(db.driver, 'a1').text).toBe('partial answer');

    repo.finalizeAttempt('a1', 'completed');
    expect(statusOf(db.driver, 'a1').status).toBe('completed');
    // Terminal — further streaming is a no-op.
    repo.updateAssistantStreamingText('a1', 'nope');
    expect(statusOf(db.driver, 'a1').text).toBe('partial answer');
  });

  it('retries by appending a new attempt (never overwriting) with an incremented number', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q', createdAt: 1 });
    const first = repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 2 });
    repo.updateAssistantStreamingText('a1', 'first try');
    repo.finalizeAttempt('a1', 'failed', 'boom');

    const second = repo.createAssistantAttempt('u1', { id: 'a2', createdAt: 3 });
    expect(first.attempt_number).toBe(1);
    expect(second.attempt_number).toBe(2);
    expect(second.reply_to_message_id).toBe('u1');

    // The earlier attempt is preserved verbatim.
    expect(statusOf(db.driver, 'a1')).toMatchObject({ text: 'first try', status: 'failed' });
    // Exactly one active attempt: the newest.
    expect(statusOf(db.driver, 'a1').is_active_attempt).toBe(0);
    expect(statusOf(db.driver, 'a2').is_active_attempt).toBe(1);
  });

  it('switches the active attempt as selection metadata only', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q', createdAt: 1 });
    repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 2 });
    repo.updateAssistantStreamingText('a1', 'answer one');
    repo.finalizeAttempt('a1', 'completed');
    repo.createAssistantAttempt('u1', { id: 'a2', createdAt: 3 });
    repo.updateAssistantStreamingText('a2', 'answer two');
    repo.finalizeAttempt('a2', 'completed');

    repo.setActiveAttempt('u1', 'a1');
    expect(statusOf(db.driver, 'a1')).toMatchObject({ text: 'answer one', is_active_attempt: 1 });
    expect(statusOf(db.driver, 'a2')).toMatchObject({ text: 'answer two', is_active_attempt: 0 });
  });

  it('projects only user messages and their active completed attempts', () => {
    // u1: failed then completed (active) → answer included
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q1', createdAt: 1 });
    repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 2 });
    repo.finalizeAttempt('a1', 'failed');
    repo.createAssistantAttempt('u1', { id: 'a2', createdAt: 3 });
    repo.updateAssistantStreamingText('a2', 'good answer');
    repo.finalizeAttempt('a2', 'completed');

    // u2: only a failed attempt → no answer in projection
    repo.appendUserMessage({ id: 'u2', conversationId: 'c1', text: 'q2', createdAt: 4 });
    repo.createAssistantAttempt('u2', { id: 'a3', createdAt: 5 });
    repo.finalizeAttempt('a3', 'failed');

    // u3: attempt still generating → excluded
    repo.appendUserMessage({ id: 'u3', conversationId: 'c1', text: 'q3', createdAt: 6 });
    repo.createAssistantAttempt('u3', { id: 'a4', createdAt: 7 });

    const projection = repo.getCanonicalProjection('c1').map((m) => m.id);
    expect(projection).toEqual(['u1', 'a2', 'u2', 'u3']);
  });

  it('lists every attempt for diagnostics regardless of status', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q', createdAt: 1 });
    repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 2 });
    repo.finalizeAttempt('a1', 'failed');
    repo.createAssistantAttempt('u1', { id: 'a2', createdAt: 3 });
    repo.finalizeAttempt('a2', 'completed');

    expect(repo.listAllAttempts('c1').map((m) => m.id)).toEqual(['a1', 'a2']);
  });

  it('projects the active attempt for UI while keeping every prior attempt diagnostic-only', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q', createdAt: 1 });
    repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 2 });
    repo.finalizeAttempt('a1', 'failed');
    repo.createAssistantAttempt('u1', { id: 'a2', createdAt: 3 });

    expect(repo.getMessage('a1')?.status).toBe('failed');
    expect(repo.getActiveProjection('c1').map((message) => message.id)).toEqual(['u1', 'a2']);
  });

  it('rejects an attempt reference from another user message', () => {
    repo.appendUserMessage({ id: 'u1', conversationId: 'c1', text: 'q1', createdAt: 1 });
    repo.appendUserMessage({ id: 'u2', conversationId: 'c1', text: 'q2', createdAt: 2 });
    repo.createAssistantAttempt('u1', { id: 'a1', createdAt: 3 });
    expect(() => repo.setActiveAttempt('u2', 'a1')).toThrow();
  });
});
