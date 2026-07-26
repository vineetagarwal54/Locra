const REFERENCE_STOP_WORDS = new Set([
  'again',
  'assistant',
  'extract',
  'extracted',
  'image',
  'item',
  'look',
  'object',
  'paper',
  'photo',
  'picture',
  'please',
  'show',
  'shown',
  'text',
  'that',
  'the',
  'this',
  'visible',
  'was',
  'what',
]);

export interface ImageReferenceCandidate {
  readonly imageAssetId: string;
  readonly sourceMessageId: string;
  readonly localPath: string;
  readonly available: boolean;
  readonly createdAt: number;
  readonly searchText: string;
}

export type ImageReferenceMatch =
  | { readonly kind: 'unique'; readonly candidate: ImageReferenceCandidate }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'none' };

export function resolveDescriptiveImageReference(
  query: string,
  candidates: readonly ImageReferenceCandidate[],
): ImageReferenceMatch {
  const queryTokens = meaningfulTokens(query);
  if (candidates.length === 0) {
    return { kind: 'none' };
  }
  if (queryTokens.size === 0) {
    return candidates.length >= 2 ? { kind: 'ambiguous' } : { kind: 'none' };
  }
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: overlapCount(queryTokens, meaningfulTokens(candidate.searchText)),
    }))
    .filter((entry) => entry.score > 0)
    .sort(compareMatches);
  if (ranked.length === 0) {
    return { kind: 'none' };
  }
  if (ranked[0].score === ranked[1]?.score) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'unique', candidate: ranked[0].candidate };
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9$.-]+/)
      .filter((token) => token.length >= 3 && !REFERENCE_STOP_WORDS.has(token)),
  );
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function compareMatches(
  left: { candidate: ImageReferenceCandidate; score: number },
  right: { candidate: ImageReferenceCandidate; score: number },
): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.candidate.createdAt !== right.candidate.createdAt) {
    return right.candidate.createdAt - left.candidate.createdAt;
  }
  return left.candidate.imageAssetId.localeCompare(right.candidate.imageAssetId);
}
