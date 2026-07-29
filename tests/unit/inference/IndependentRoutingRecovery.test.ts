import { ContextOrchestrator } from '../../../src/inference/ContextOrchestrator';
import {
  recoverIndependentRoutingSources,
  type IndependentRecoveryCandidate,
} from '../../../src/inference/IndependentRoutingRecovery';

function candidate(
  id: string,
  kind: IndependentRecoveryCandidate['kind'],
  exactOrDirect = true,
): IndependentRecoveryCandidate {
  return {
    id,
    kind,
    sourceMessageId: `message-${id}`,
    content: `content-${id}`,
    exactOrDirect,
  };
}

describe('IndependentRoutingRecovery', () => {
  it.each([
    'explicit-memory',
    'same-chat-lexical',
    'direct-entity',
    'attached-image',
    'explicit-image-reference',
    'user-fact',
    'active-comparison-target',
  ] as const)('protects an exact/direct %s candidate from a false independent label', (kind) => {
    const result = recoverIndependentRoutingSources({
      enabled: true,
      classifiedIndependent: true,
      candidates: [candidate(kind, kind)],
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0]?.kind).toBe(kind);
  });

  it('does nothing when the gate is disabled or the request is not independent', () => {
    expect(recoverIndependentRoutingSources({
      enabled: false,
      classifiedIndependent: true,
      candidates: [candidate('memory', 'explicit-memory')],
    }).recovered).toEqual([]);
    expect(recoverIndependentRoutingSources({
      enabled: true,
      classifiedIndependent: false,
      candidates: [candidate('memory', 'explicit-memory')],
    }).recovered).toEqual([]);
  });

  it('rejects unrelated and ambiguous candidates without semantic regex routing', () => {
    const result = recoverIndependentRoutingSources({
      enabled: true,
      classifiedIndependent: true,
      candidates: [
        candidate('unrelated', 'same-chat-lexical', false),
        {
          ...candidate('ambiguous-image', 'explicit-image-reference'),
          ambiguous: true,
        },
      ],
    });

    expect(result.recovered).toEqual([]);
    expect(result.considered).toBe(2);
  });

  it('deduplicates and orders protected candidates deterministically', () => {
    const result = recoverIndependentRoutingSources({
      enabled: true,
      classifiedIndependent: true,
      candidates: [
        candidate('z', 'user-fact'),
        candidate('a', 'explicit-memory'),
        candidate('z', 'user-fact'),
      ],
    });

    expect(result.recovered.map((item) => item.id)).toEqual(['a', 'z']);
  });

  it('injects recovered exact facts before the legacy independent hard skip', () => {
    const result = new ContextOrchestrator().orchestrate({
      version: 'canonical-conversation-snapshot-v1',
      conversationId: 'conversation-1',
      priorMessages: [],
      currentMessage: {
        id: 'user-current',
        role: 'user',
        text: 'What is the unit 3427-014?',
        attachments: [],
        status: 'completed',
        errorMessage: null,
        createdAt: 2,
      },
      contextMemory: null,
    }, {
      diagnosticsEnabled: true,
      independentRecovery: {
        enabled: true,
        candidates: [{
          id: 'unit-memory',
          kind: 'explicit-memory',
          sourceMessageId: 'user-earlier',
          content: 'The user unit is 3427-014.',
          exactOrDirect: true,
        }],
      },
    });

    expect(result.diagnostics?.classification.isIndependentTextQuestion).toBe(true);
    expect(result.context.importantFacts).toContainEqual(expect.objectContaining({
      id: 'independent-recovery:unit-memory',
      sourceMessageId: 'user-earlier',
    }));
    expect(result.diagnostics?.independentRecovery.recovered.map((item) => item.id))
      .toEqual(['unit-memory']);
  });
});
