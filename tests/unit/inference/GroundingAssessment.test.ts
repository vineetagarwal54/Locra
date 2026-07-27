import {
  assessGrounding,
  createGroundingSourceSet,
  extractSpecificClaims,
} from '../../../src/inference/GroundingAssessment';
import type { HiddenVisualEvidence } from '../../../src/inference/OutputPipelineTypes';
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

function freshEvidence(visibleText: string[]): HiddenVisualEvidence {
  return {
    version: 'hidden-evidence-v1',
    imagePath: '/image.jpg',
    sourceQuestion: 'Read the image.',
    subjectObject: 'receipt',
    visibleFeatures: ['paper receipt'],
    visibleText,
    visibleCondition: 'readable',
    uncertainty: [],
    createdAt: '2026-07-26T00:00:00.000Z',
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

  it('uses fresh new-image evidence for a supported claim', () => {
    expect(assessGrounding(
      'The receipt total is $12.99.',
      context(null),
      freshEvidence(['TOTAL $12.99']),
    )).toBe('supported');
  });

  it('flags an unsupported new-image numeric claim', () => {
    expect(assessGrounding(
      'The receipt total is $18.99.',
      context(null),
      freshEvidence(['TOTAL $12.99']),
    )).toBe('unsupported');
  });

  it('uses fresh re-inferred OCR evidence without mutating selected context', () => {
    const selected = context(null);
    const before = JSON.stringify(selected);

    expect(assessGrounding(
      'The serial is ZX-418.',
      selected,
      freshEvidence(['SERIAL ZX-418']),
    )).toBe('supported');
    expect(JSON.stringify(selected)).toBe(before);
  });

  it('preserves stored, fresh, same-chat, and cross-chat provenance in an immutable source set', () => {
    const selected: CanonicalConversationContext = {
      ...context('TOTAL $12.99'),
      importantFacts: [
        {
          version: 'context-memory-fact-v1',
          id: 'retrieved:current:item',
          sourceMessageId: 'same-message',
          text: 'Order ID AX-22',
          createdAt: 1,
        },
        {
          version: 'context-memory-fact-v1',
          id: 'retrieved:other:item',
          sourceMessageId: 'other-message',
          text: '[Untrusted source: conversation other, message other-message] Date 2026-07-26',
          createdAt: 1,
        },
      ],
    };
    const before = JSON.stringify(selected);
    const sources = createGroundingSourceSet(selected, freshEvidence(['TOTAL $12.99']), 'current');

    expect(sources.sources.map((source) => source.kind)).toEqual(expect.arrayContaining([
      'stored-image-evidence',
      'fresh-image-evidence',
      'same-chat-retrieval',
      'cross-chat-retrieval',
    ]));
    expect(JSON.stringify(selected)).toBe(before);
  });
});
