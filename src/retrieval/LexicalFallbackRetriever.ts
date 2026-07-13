import type { RetrievalCandidate, RetrievedItem } from './types';

const STOP_WORDS = new Set([
  'about', 'again', 'also', 'and', 'are', 'did', 'does', 'for', 'from', 'have',
  'image', 'into', 'plan', 'that', 'the', 'this', 'was', 'what', 'when', 'where',
  'which', 'with', 'would',
]);

export interface LexicalSearchInput {
  readonly query: string;
  readonly candidates: readonly RetrievalCandidate[];
  readonly limit: number;
}

export class LexicalFallbackRetriever {
  search(input: LexicalSearchInput): RetrievedItem[] {
    const queryTokens = tokenize(input.query);
    return input.candidates
      .map((candidate) => ({ ...candidate, score: overlap(queryTokens, tokenize(candidate.text)) }))
      .filter((candidate) => candidate.score > 0)
      .sort(compareRetrievedItems)
      .slice(0, Math.max(0, input.limit));
  }
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) {
      score += 1;
    }
  }
  return score;
}

export function compareRetrievedItems(left: RetrievedItem, right: RetrievedItem): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.timestamp !== right.timestamp) {
    return right.timestamp - left.timestamp;
  }
  return left.id.localeCompare(right.id);
}

