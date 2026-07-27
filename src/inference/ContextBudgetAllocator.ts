import type { ContextNeedProfile } from './ContextNeedProfile';

export type ContextCandidateSourceType =
  | 'recent-turn'
  | 'same-chat-retrieval'
  | 'cross-chat-retrieval'
  | 'durable-fact'
  | 'summary'
  | 'image-evidence';

export type ContextCandidateProtection = 'required' | 'direct-answer' | 'normal';

export interface ContextCandidate {
  readonly id: string;
  readonly sourceType: ContextCandidateSourceType;
  readonly relevance: number;
  readonly exactMatchSignals: readonly string[];
  readonly recency: number;
  readonly costUnits: number;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly imageAssetId: string | null;
  readonly protection: ContextCandidateProtection;
  readonly crossChat: boolean;
  readonly content: string;
}

export interface ContextCandidateExclusion {
  readonly candidateId: string;
  readonly reason: 'ineligible' | 'source-limit' | 'budget';
}

export interface ContextBudgetAllocation {
  readonly selected: readonly ContextCandidate[];
  readonly excluded: readonly ContextCandidateExclusion[];
  readonly usedUnits: number;
  readonly maximumUnits: number;
}

export function allocateContextBudget(
  ranked: readonly ContextCandidate[],
  profile: ContextNeedProfile,
  maximumUnits: number,
): ContextBudgetAllocation {
  const maximum = Math.max(0, Math.floor(maximumUnits));
  const selected: ContextCandidate[] = [];
  const excluded: ContextCandidateExclusion[] = [];
  const counts = new Map<ContextCandidateSourceType, number>();
  let usedUnits = 0;

  for (const candidate of ranked) {
    if (!isEligible(candidate, profile)) {
      excluded.push({ candidateId: candidate.id, reason: 'ineligible' });
      continue;
    }
    const limit = sourceLimit(candidate.sourceType, profile);
    if ((counts.get(candidate.sourceType) ?? 0) >= limit) {
      excluded.push({ candidateId: candidate.id, reason: 'source-limit' });
      continue;
    }
    if (usedUnits + candidate.costUnits > maximum) {
      excluded.push({ candidateId: candidate.id, reason: 'budget' });
      continue;
    }
    selected.push(candidate);
    counts.set(candidate.sourceType, (counts.get(candidate.sourceType) ?? 0) + 1);
    usedUnits += candidate.costUnits;
  }

  return { selected, excluded, usedUnits, maximumUnits: maximum };
}

function isEligible(candidate: ContextCandidate, profile: ContextNeedProfile): boolean {
  if (
    candidate.protection === 'normal' &&
    candidate.relevance <= 0 &&
    candidate.sourceType !== 'recent-turn' &&
    candidate.sourceType !== 'image-evidence'
  ) {
    return false;
  }
  switch (candidate.sourceType) {
    case 'recent-turn': return profile.recentConversation;
    case 'same-chat-retrieval': return profile.sameChatHistory;
    case 'cross-chat-retrieval': return profile.crossChatHistory;
    case 'durable-fact': return profile.durableFacts;
    case 'summary': return profile.summary;
    case 'image-evidence':
      return profile.activeImageEvidence || profile.olderImageEvidence;
  }
}

function sourceLimit(
  sourceType: ContextCandidateSourceType,
  profile: ContextNeedProfile,
): number {
  switch (sourceType) {
    case 'recent-turn': return profile.limits.recentTurns;
    case 'same-chat-retrieval': return profile.limits.sameChatItems;
    case 'cross-chat-retrieval': return profile.limits.crossChatItems;
    case 'durable-fact': return profile.limits.facts;
    case 'summary': return profile.limits.summaries;
    case 'image-evidence': return profile.limits.imageItems;
  }
}
