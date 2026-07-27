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
  readonly imageBearingText?: string;
  readonly assistantAnswer?: string | null;
  readonly associatedTurnText?: readonly string[];
  readonly latestEvidenceText?: string | null;
}

export type ImageReferenceMatch =
  | { readonly kind: 'unique'; readonly candidate: ImageReferenceCandidate }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'none' };

export interface ResolvedImageReference {
  readonly imageAssetId: string;
  readonly sourceMessageId: string;
  readonly localPath: string;
  readonly available: boolean;
}

export interface ImageReferenceResolutionResult {
  readonly kind: 'none' | 'active' | 'single' | 'multiple' | 'ambiguous';
  readonly references: readonly ResolvedImageReference[];
  readonly ambiguousCandidateIds: readonly string[];
}

export interface ImageReferenceResolutionOptions {
  readonly activeImageId: string | null;
  readonly expectsMultiple?: boolean;
  readonly currentImage?: ResolvedImageReference;
}

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

export function resolveImageReferences(
  query: string,
  candidates: readonly ImageReferenceCandidate[],
  options: ImageReferenceResolutionOptions,
): ImageReferenceResolutionResult {
  if (options.currentImage !== undefined) {
    return { kind: 'active', references: [options.currentImage], ambiguousCandidateIds: [] };
  }
  const ordinalIndexes = resolveOrdinalIndexes(query);
  if (ordinalIndexes.length > 0) {
    const references = ordinalIndexes
      .map((index) => candidates[index])
      .filter((candidate): candidate is ImageReferenceCandidate => candidate !== undefined)
      .map(toResolvedReference);
    if (references.length !== ordinalIndexes.length) {
      return { kind: 'ambiguous', references: [], ambiguousCandidateIds: [] };
    }
    return {
      kind: references.length > 1 ? 'multiple' : resolveSingleKind(references[0], options),
      references,
      ambiguousCandidateIds: [],
    };
  }

  const scored = rankDescriptiveCandidates(query, candidates);
  if (options.expectsMultiple === true) {
    if (scored.length < 2) {
      return { kind: 'ambiguous', references: [], ambiguousCandidateIds: scored.map(idOf) };
    }
    const strongestScore = scored[0].score;
    const plausible = scored.filter((entry) => entry.score === strongestScore);
    return plausible.length >= 2
      ? { kind: 'ambiguous', references: [], ambiguousCandidateIds: plausible.map(idOf).sort() }
      : { kind: 'ambiguous', references: [], ambiguousCandidateIds: scored.map(idOf).sort() };
  }
  if (scored.length === 0) {
    return { kind: 'none', references: [], ambiguousCandidateIds: [] };
  }
  if (scored[0].score === scored[1]?.score) {
    return {
      kind: 'ambiguous',
      references: [],
      ambiguousCandidateIds: scored
        .filter((entry) => entry.score === scored[0].score)
        .map(idOf)
        .sort(),
    };
  }
  const reference = toResolvedReference(scored[0].candidate);
  return {
    kind: resolveSingleKind(reference, options),
    references: [reference],
    ambiguousCandidateIds: [],
  };
}

function meaningfulTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9$.-]+/)
      .filter((token) => token.length >= 3 && !REFERENCE_STOP_WORDS.has(token)),
  );
}

function candidateSearchText(candidate: ImageReferenceCandidate): string {
  return [
    candidate.searchText,
    candidate.imageBearingText ?? '',
    candidate.assistantAnswer ?? '',
    ...(candidate.associatedTurnText ?? []),
    candidate.latestEvidenceText ?? '',
  ].join(' ');
}

function rankDescriptiveCandidates(
  query: string,
  candidates: readonly ImageReferenceCandidate[],
): Array<{ candidate: ImageReferenceCandidate; score: number }> {
  const queryTokens = meaningfulTokens(query);
  return candidates
    .map((candidate) => ({
      candidate,
      score: overlapCount(queryTokens, meaningfulTokens(candidateSearchText(candidate))),
    }))
    .filter((entry) => entry.score > 0)
    .sort(compareMatches);
}

function resolveOrdinalIndexes(query: string): number[] {
  const normalized = query.toLowerCase();
  const indexes: number[] = [];
  const ordinalFamilies: ReadonlyArray<readonly [number, RegExp]> = [
    [0, /\b(?:first|1st|one)\b/g],
    [1, /\b(?:second|2nd|two)\b/g],
    [2, /\b(?:third|3rd|three)\b/g],
    [3, /\b(?:fourth|4th|four)\b/g],
    [4, /\b(?:fifth|5th|five)\b/g],
  ];
  for (const [index, pattern] of ordinalFamilies) {
    if (pattern.test(normalized)) indexes.push(index);
  }
  return indexes;
}

function toResolvedReference(candidate: ImageReferenceCandidate): ResolvedImageReference {
  return {
    imageAssetId: candidate.imageAssetId,
    sourceMessageId: candidate.sourceMessageId,
    localPath: candidate.localPath,
    available: candidate.available,
  };
}

function resolveSingleKind(
  reference: ResolvedImageReference | undefined,
  options: ImageReferenceResolutionOptions,
): 'active' | 'single' {
  return reference?.imageAssetId === options.activeImageId ? 'active' : 'single';
}

function idOf(entry: { candidate: ImageReferenceCandidate }): string {
  return entry.candidate.imageAssetId;
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
