import {
  DEFAULT_RESPONSE_MODE,
  fromStoredMode,
  getResponseModeConfig,
  getResponseModeInstruction,
  getResponseTokenBudget,
  toStoredMode,
} from '../../../src/inference/ResponseMode';
import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { initializeSchema } from '../../../src/persistence/sqlite/Schema';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

describe('response modes', () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
    initializeSchema(database.driver);
  });

  afterEach(() => {
    database.close();
  });

  it('defaults to Medium and owns all Qwen output budgets', () => {
    expect(DEFAULT_RESPONSE_MODE).toBe('Medium');
    expect(getResponseTokenBudget('Low')).toBe(192);
    expect(getResponseTokenBudget('Medium')).toBe(384);
    expect(getResponseTokenBudget('High')).toBe(768);
  });

  it.each(['Low', 'Medium', 'High'] as const)('asks %s responses to finish cleanly', (mode) => {
    expect(getResponseModeInstruction(mode)).toMatch(/finish the answer cleanly/i);
    expect(getResponseModeInstruction(mode)).toContain(String(getResponseTokenBudget(mode)));
  });

  it('pins monotonic character-budget profiles', () => {
    expect(getResponseModeConfig('Low')).toEqual({
      recentExactTurns: 6,
      contextBudgetUnits: 4_000,
      sameChatRetrievalLimit: 2,
      selectedChatRetrievalLimit: 1,
      answerTargetTokens: 192,
      generationLimit: 320,
    });
    expect(getResponseModeConfig('Medium')).toEqual({
      recentExactTurns: 10,
      contextBudgetUnits: 7_000,
      sameChatRetrievalLimit: 4,
      selectedChatRetrievalLimit: 3,
      answerTargetTokens: 384,
      generationLimit: 640,
    });
    expect(getResponseModeConfig('High')).toEqual({
      recentExactTurns: 16,
      contextBudgetUnits: 11_000,
      sameChatRetrievalLimit: 6,
      selectedChatRetrievalLimit: 5,
      answerTargetTokens: 768,
      generationLimit: 1_024,
    });
  });

  it('owns the only lowercase storage conversion and defaults unknown values to Medium', () => {
    expect(toStoredMode('Low')).toBe('low');
    expect(toStoredMode('Medium')).toBe('medium');
    expect(toStoredMode('High')).toBe('high');
    expect(fromStoredMode('low')).toBe('Low');
    expect(fromStoredMode('medium')).toBe('Medium');
    expect(fromStoredMode('high')).toBe('High');
    expect(fromStoredMode('unexpected')).toBe('Medium');
  });

  it('copies the global default once, updates only one conversation, and preserves related state', () => {
    let globalDefault = toStoredMode('High');
    const repository = new ConversationRepository(database.driver, {
      now: () => 1_000,
      getDefaultResponseMode: () => globalDefault,
    });
    const first = repository.createConversation({ id: 'conversation-1' });
    globalDefault = toStoredMode('Low');
    const second = repository.createConversation({ id: 'conversation-2' });
    database.driver.runSync(
      `INSERT INTO message
         (id, conversation_id, role, reply_to_message_id, attempt_number, is_active_attempt,
          text, status, error_message, finalized_at, created_at)
       VALUES ('message-1', 'conversation-1', 'user', NULL, NULL, 0,
               'preserved', 'submitted', NULL, NULL, 1001)`,
    );
    database.driver.runSync(
      `INSERT INTO image_asset
         (id, conversation_id, local_path, available, content_hash, created_at)
       VALUES ('image-1', 'conversation-1', '/local/image.jpg', 1, NULL, 1001)`,
    );

    repository.setResponseMode(first.id, toStoredMode('Medium'));

    expect(repository.getConversation(first.id)?.response_mode).toBe('medium');
    expect(repository.getConversation(second.id)?.response_mode).toBe('low');
    expect(database.driver.getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM message WHERE conversation_id = ?', [first.id],
    )?.n).toBe(1);
    expect(database.driver.getFirstSync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM image_asset WHERE conversation_id = ?', [first.id],
    )?.n).toBe(1);
  });
});
