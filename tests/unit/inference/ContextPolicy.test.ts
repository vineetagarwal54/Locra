import {
  allocateContextBudget,
  type ContextCandidate,
} from '../../../src/inference/ContextBudgetAllocator';
import { rankContextCandidates } from '../../../src/inference/ContextCandidatePolicy';
import type { ContextNeedProfile } from '../../../src/inference/ContextNeedProfile';

const PROFILE: ContextNeedProfile = {
  id: 'same-chat-memory',
  recentConversation: false,
  sameChatHistory: true,
  crossChatHistory: true,
  activeImageEvidence: false,
  olderImageEvidence: false,
  multipleImageEvidence: false,
  originalPixelReinspection: false,
  durableFacts: true,
  summary: true,
  conciseGeneration: false,
  detailedGeneration: true,
  requiredImageIds: [],
  limits: { recentTurns: 0, sameChatItems: 8, crossChatItems: 4, imageItems: 0, facts: 6, summaries: 2 },
};

function candidate(
  id: string,
  sourceType: ContextCandidate['sourceType'],
  relevance: number,
  costUnits: number,
  overrides: Partial<ContextCandidate> = {},
): ContextCandidate {
  return {
    id,
    sourceType,
    relevance,
    exactMatchSignals: [],
    recency: 1,
    costUnits,
    conversationId: 'current',
    messageId: id,
    imageAssetId: null,
    protection: 'normal',
    crossChat: sourceType === 'cross-chat-retrieval',
    content: id,
    ...overrides,
  };
}

describe('context candidate policy and budget allocation', () => {
  it('ranks relevance before recency for long-memory candidates', () => {
    const ranked = rankContextCandidates([
      candidate('recent-noise', 'recent-turn', 0, 2, { recency: 100 }),
      candidate('older-answer', 'same-chat-retrieval', 3, 2, { recency: 1 }),
    ], PROFILE);

    expect(ranked.map((item) => item.id)).toEqual(['older-answer', 'recent-noise']);
  });

  it('protects direct exact values while excluding lower-value candidates', () => {
    const result = allocateContextBudget(
      rankContextCandidates([
        candidate('other-chat', 'cross-chat-retrieval', 1, 4),
        candidate('direct-value', 'durable-fact', 4, 4, {
          exactMatchSignals: ['identifier'],
          protection: 'direct-answer',
        }),
        candidate('summary', 'summary', 2, 4),
      ], PROFILE),
      PROFILE,
      8,
    );

    expect(result.selected.map((item) => item.id)).toContain('direct-value');
    expect(result.usedUnits).toBeLessThanOrEqual(result.maximumUnits);
    expect(result.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: 'other-chat', reason: 'budget' }),
    ]));
  });

  it('is deterministic for identical candidates and budget', () => {
    const candidates = [
      candidate('b', 'durable-fact', 2, 3),
      candidate('a', 'durable-fact', 2, 3),
    ];
    expect(allocateContextBudget(rankContextCandidates(candidates, PROFILE), PROFILE, 3))
      .toEqual(allocateContextBudget(rankContextCandidates(candidates, PROFILE), PROFILE, 3));
  });
});
