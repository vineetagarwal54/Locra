import { parseCompaction } from '../../../src/inference/CompactionParser';

describe('CompactionParser', () => {
  it('parses one summary and source-linked facts', () => {
    const parsed = parseCompaction(JSON.stringify({
      summary: { text: 'Trip planning summary', sourceMessageIds: ['m1', 'm2'] },
      facts: [{
        normalizedKey: 'trip date', valueText: 'September 3', factType: 'fact',
        sourceMessageIds: ['m1'],
      }],
    }), new Set(['m1', 'm2']));

    expect(parsed.summary.text).toBe('Trip planning summary');
    expect(parsed.facts[0]).toEqual(expect.objectContaining({ normalizedKey: 'trip date' }));
  });

  it('rejects every source reference outside the immutable range', () => {
    expect(() => parseCompaction(JSON.stringify({
      summary: { text: 'Summary', sourceMessageIds: ['missing'] }, facts: [],
    }), new Set(['m1']))).toThrow(/unknown message ID/i);
  });
});

