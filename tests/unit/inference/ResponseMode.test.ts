import {
  DEFAULT_RESPONSE_MODE,
  fromStoredMode,
  getResponseGenerationLimit,
  getResponseModeConfig,
  getResponseModeInstruction,
  getResponseTokenBudget,
  toStoredMode,
} from '../../../src/inference/ResponseMode';
import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { initializeSchema } from '../../../src/persistence/sqlite/Migrations';
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

  it('exposes the hard generation limit separately from the soft target', () => {
    // n_predict is the hard cap; it is always >= the soft prompt-level target so
    // the model has room to finish past the target.
    expect(getResponseGenerationLimit('Low')).toBe(320);
    expect(getResponseGenerationLimit('Medium')).toBe(640);
    expect(getResponseGenerationLimit('High')).toBe(1_024);
    for (const mode of ['Low', 'Medium', 'High'] as const) {
      expect(getResponseGenerationLimit(mode)).toBeGreaterThan(getResponseTokenBudget(mode));
    }
  });

  it.each(['Low', 'Medium', 'High'] as const)(
    'treats %s answerTargetTokens as a soft target and asks to finish cleanly',
    (mode) => {
      const instruction = getResponseModeInstruction(mode);
      expect(instruction).toContain(String(getResponseTokenBudget(mode)));
      expect(instruction).toMatch(/soft target/i);
      expect(instruction).toMatch(/finish the current sentence and section cleanly/i);
      // A soft target must never read as a requirement to fill space.
      expect(instruction).toMatch(/never add filler/i);
    },
  );

  it('gives each mode a distinct focus', () => {
    expect(getResponseModeInstruction('Low')).toMatch(/briefest|essential/i);
    expect(getResponseModeInstruction('Medium')).toMatch(/actionable steps/i);
    expect(getResponseModeInstruction('High')).toMatch(/comprehensive|edge cases/i);
  });

  it('pins monotonic character-budget profiles', () => {
    expect(getResponseModeConfig('Low')).toEqual({
      recentExactTurns: 6,
      contextBudgetUnits: 4_000,
      sameChatRetrievalLimit: 2,
      answerTargetTokens: 192,
      generationLimit: 320,
    });
    expect(getResponseModeConfig('Medium')).toEqual({
      recentExactTurns: 10,
      contextBudgetUnits: 7_000,
      sameChatRetrievalLimit: 4,
      answerTargetTokens: 384,
      generationLimit: 640,
    });
    expect(getResponseModeConfig('High')).toEqual({
      recentExactTurns: 16,
      contextBudgetUnits: 11_000,
      sameChatRetrievalLimit: 6,
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
