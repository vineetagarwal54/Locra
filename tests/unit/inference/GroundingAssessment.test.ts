import {
  assessGrounding,
  extractSpecificClaims,
} from '../../../src/inference/GroundingAssessment';
import type { CanonicalConversationContext } from '../../../src/types/models';

function context(evidenceText: string | null): CanonicalConversationContext {
  return {
    version: 'canonical-conversation-v2',
    recentTurns: [],
    mediaEvidence: evidenceText === null ? [] : [{
      version: 'context-media-evidence-v1',
      id: 'evidence',
      sourceMessageId: 'user',
      modality: 'image',
      sourcePath: 'asset',
      summary: 'label',
      facts: [],
      extractedText: [evidenceText],
      uncertainty: [],
      createdAt: 1,
    }],
    importantFacts: [],
    olderSummary: null,
    budget: { policyId: 'test', maximumUnits: 1, usedUnits: 1 },
  };
}

describe('grounding assessment', () => {
  it('extracts deterministic specific claims', () => {
    expect(extractSpecificClaims('Code ZX-418 cost $12.99 on 2026-07-26.')).toEqual([
      '418',
      '$12.99',
      '2026-07-26',
      'ZX-418',
    ]);
  });

  it('reports supported and unsupported without changing answer text', () => {
    const answer = 'The label shows ZX-418 and costs $12.99.';

    expect(assessGrounding(answer, context('ZX-418 $12.99'))).toBe('supported');
    expect(assessGrounding(answer, context('ZX-418 $8.00'))).toBe('unsupported');
    expect(answer).toBe('The label shows ZX-418 and costs $12.99.');
  });

  it('returns null when no image or retrieved evidence was selected', () => {
    expect(assessGrounding('The answer is 42.', context(null))).toBeNull();
  });
});
