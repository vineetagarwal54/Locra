import type { ContextCandidate } from './ContextBudgetAllocator';
import type { ContextNeedProfile } from './ContextNeedProfile';

export function rankContextCandidates(
  candidates: readonly ContextCandidate[],
  profile: ContextNeedProfile,
): ContextCandidate[] {
  return [...candidates].sort((left, right) => compareCandidates(left, right, profile));
}

function compareCandidates(
  left: ContextCandidate,
  right: ContextCandidate,
  profile: ContextNeedProfile,
): number {
  const protection = protectionRank(right.protection) - protectionRank(left.protection);
  if (protection !== 0) return protection;
  const exact = right.exactMatchSignals.length - left.exactMatchSignals.length;
  if (exact !== 0) return exact;
  const relevance = right.relevance - left.relevance;
  if (relevance !== 0) return relevance;
  if (profile.recentConversation) {
    const recency = right.recency - left.recency;
    if (recency !== 0) return recency;
  }
  const source = sourceRank(left.sourceType) - sourceRank(right.sourceType);
  if (source !== 0) return source;
  const recency = right.recency - left.recency;
  return recency !== 0 ? recency : left.id.localeCompare(right.id);
}

function protectionRank(value: ContextCandidate['protection']): number {
  if (value === 'required') return 3;
  if (value === 'direct-answer') return 2;
  return 1;
}

function sourceRank(value: ContextCandidate['sourceType']): number {
  switch (value) {
    case 'image-evidence': return 0;
    case 'recent-turn': return 1;
    case 'summary': return 2;
    case 'durable-fact': return 3;
    case 'same-chat-retrieval': return 4;
    case 'cross-chat-retrieval': return 5;
  }
}
