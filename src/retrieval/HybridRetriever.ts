import type { LexicalFallbackRetriever } from './LexicalFallbackRetriever';
import { compareRetrievedItems } from './LexicalFallbackRetriever';
import type {
  CompatibleEmbeddingCandidate,
  RetrievalCandidate,
  RetrievedItem,
} from './types';

export const COSINE_SIMILARITY_THRESHOLD = 0.62;

export interface CompatibleEmbeddingSource {
  getCompatibleByScope(
    conversationIds: readonly string[],
    embeddingVersion: string,
    artifactHash: string,
  ): CompatibleEmbeddingCandidate[];
}

export interface HybridSearchInput {
  readonly query: string;
  readonly queryVector?: Float32Array;
  readonly conversationIds: readonly string[];
  readonly embeddingVersion: string;
  readonly artifactHash: string;
  readonly limit: number;
  readonly lexicalCandidates: readonly RetrievalCandidate[];
}

export class HybridRetriever {
  constructor(
    private readonly embeddings: CompatibleEmbeddingSource,
    private readonly lexicalFallback: Pick<LexicalFallbackRetriever, 'search'>,
  ) {}

  search(input: HybridSearchInput): RetrievedItem[] {
    const candidates = this.embeddings.getCompatibleByScope(
      input.conversationIds,
      input.embeddingVersion,
      input.artifactHash,
    );
    if (candidates.length === 0 || input.queryVector === undefined) {
      return this.lexicalFallback.search({
        query: input.query,
        candidates: input.lexicalCandidates,
        limit: input.limit,
      });
    }

    const bestByMessage = new Map<string, RetrievedItem>();
    for (const candidate of candidates) {
      const score = cosineSimilarity(input.queryVector, candidate.vector);
      if (score < COSINE_SIMILARITY_THRESHOLD) {
        continue;
      }
      const result: RetrievedItem = { ...candidate, score };
      const current = bestByMessage.get(candidate.sourceMessageId);
      if (current === undefined || compareRetrievedItems(result, current) < 0) {
        bestByMessage.set(candidate.sourceMessageId, result);
      }
    }
    return [...bestByMessage.values()]
      .sort(compareRetrievedItems)
      .slice(0, Math.max(0, input.limit));
  }
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}
