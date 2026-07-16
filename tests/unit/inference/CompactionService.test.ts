import {
  COMPACTION_CHARACTER_TRIGGER,
  COMPACTION_MESSAGE_TRIGGER,
  CompactionService,
  meetsCompactionTrigger,
  selectCompactionRange,
  shouldStaleSummary,
} from '../../../src/inference/CompactionService';
import type { MessageRow, SummaryRow } from '../../../src/types/models';

function message(index: number, text = `message ${index}`): MessageRow {
  return {
    id: `m${index}`, conversation_id: 'c1', role: index % 2 === 0 ? 'assistant' : 'user',
    reply_to_message_id: null, attempt_number: null, is_active_attempt: 0, text,
    status: index % 2 === 0 ? 'completed' : 'submitted', error_message: null,
    finish_reason: null, finalized_at: null, created_at: index,
  };
}

describe('CompactionService', () => {
  it('pins deterministic triggers and selects one older contiguous range', () => {
    expect(COMPACTION_MESSAGE_TRIGGER).toBe(24);
    expect(COMPACTION_CHARACTER_TRIGGER).toBe(6_000);
    expect(meetsCompactionTrigger(Array.from({ length: 24 }, (_, i) => message(i)))).toBe(true);
    expect(meetsCompactionTrigger([message(1, 'x'.repeat(6_000))])).toBe(true);
    expect(selectCompactionRange(Array.from({ length: 56 }, (_, i) => message(i)))?.messages)
      .toHaveLength(24);
  });

  it('keeps appended turns valid and stales only covered changes or version changes', () => {
    const summary = {
      first_source_message_id: 'm1', last_source_message_id: 'm4', summarizer_version: 'v1',
    } as SummaryRow;
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
    expect(shouldStaleSummary(summary, ids, { kind: 'append', messageId: 'm6' }, 'v1')).toBe(false);
    expect(shouldStaleSummary(summary, ids, { kind: 'source-view', messageId: 'm3' }, 'v1')).toBe(true);
    expect(shouldStaleSummary(summary, ids, { kind: 'active-attempt', messageId: 'm5' }, 'v1')).toBe(false);
    expect(shouldStaleSummary(summary, ids, { kind: 'summarizer-version', version: 'v2' }, 'v2')).toBe(true);
  });

  it('resource-locks one isolated request and persists validated output', async () => {
    const projection = Array.from({ length: 56 }, (_, i) => message(i));
    const release = jest.fn();
    const summaries = { getNewestReady: jest.fn(() => null), save: jest.fn(), markStale: jest.fn() };
    const facts = { upsert: jest.fn() };
    const service = new CompactionService({
      messages: { getCanonicalProjection: jest.fn(() => projection) },
      summaries,
      facts,
      generator: { generate: jest.fn(async () => JSON.stringify({
        summary: { text: 'summary', sourceMessageIds: ['m0', 'm23'] },
        facts: [{ normalizedKey: 'key', valueText: 'value', factType: 'fact', sourceMessageIds: ['m1'] }],
      })) },
      resourcePolicy: {
        acquire: jest.fn(async () => ({ operation: 'qwen-compaction' as const, release })),
        tryAcquire: jest.fn(() => null), isBusy: jest.fn(() => false), current: jest.fn(() => null),
      },
      summarizerVersion: 'v1',
    });

    await expect(service.maybeRun('c1')).resolves.toBe(true);
    expect(summaries.save).toHaveBeenCalledWith(expect.objectContaining({
      firstSourceMessageId: 'm0', lastSourceMessageId: 'm23', summarizerVersion: 'v1',
    }));
    expect(facts.upsert).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
});
