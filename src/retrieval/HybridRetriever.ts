import type { LexicalFallbackRetriever } from './LexicalFallbackRetriever';
import { compareRetrievedItems } from './LexicalFallbackRetriever';
import type {
  CompatibleEmbeddingCandidate,
  RetrievalCandidate,
  RetrievedItem,
} from './types';

export const COSINE_SIMILARITY_THRESHOLD = 0.62;
export const RRF_K = 60;

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

export interface HybridSearchResult {
  readonly items: RetrievedItem[];
  readonly mode: 'fused' | 'lexical-fallback';
}

export class HybridRetriever {
  constructor(
    private readonly embeddings: CompatibleEmbeddingSource,
    private readonly lexicalFallback: Pick<LexicalFallbackRetriever, 'search'>,
  ) {}

  search(input: HybridSearchInput): RetrievedItem[] {
    return this.searchWithDiagnostics(input).items;
  }

  searchWithDiagnostics(input: HybridSearchInput): HybridSearchResult {
    const candidates = this.embeddings.getCompatibleByScope(
      input.conversationIds,
      input.embeddingVersion,
      input.artifactHash,
    );
    if (candidates.length === 0 || input.queryVector === undefined) {
      return {
        items: this.lexicalFallback.search({
          query: input.query,
          candidates: input.lexicalCandidates,
          limit: input.limit,
        }),
        mode: 'lexical-fallback',
      };
    }

    const semantic: RetrievedItem[] = [];
    for (const candidate of candidates) {
      const score = cosineSimilarity(input.queryVector, candidate.vector);
      if (score < COSINE_SIMILARITY_THRESHOLD) {
        continue;
      }
      semantic.push({ ...candidate, score });
    }
    semantic.sort(compareRetrievedItems);

    const lexical = this.lexicalFallback.search({
      query: input.query,
      candidates: input.lexicalCandidates,
      limit: input.lexicalCandidates.length,
    });
    const fused = reciprocalRankFusion(lexical, semantic);
    const exact = lexical.filter((item) => isExactMatchGuaranteed(input.query, item.text));
    return {
      items: retainExactMatches(exact, fused, Math.max(0, input.limit)),
      mode: 'fused',
    };
  }
}

function reciprocalRankFusion(
  lexical: readonly RetrievedItem[],
  semantic: readonly RetrievedItem[],
): RetrievedItem[] {
  const byMessage = new Map<string, RetrievedItem>();
  const scores = new Map<string, number>();
  addRanking(lexical, byMessage, scores);
  addRanking(semantic, byMessage, scores);
  return [...byMessage.entries()]
    .map(([messageId, item]) => ({ ...item, score: scores.get(messageId) ?? 0 }))
    .sort(compareRetrievedItems);
}

function addRanking(
  ranking: readonly RetrievedItem[],
  byMessage: Map<string, RetrievedItem>,
  scores: Map<string, number>,
): void {
  ranking.forEach((item, index) => {
    const current = byMessage.get(item.sourceMessageId);
    if (current === undefined || compareRetrievedItems(item, current) < 0) {
      byMessage.set(item.sourceMessageId, item);
    }
    scores.set(
      item.sourceMessageId,
      (scores.get(item.sourceMessageId) ?? 0) + 1 / (RRF_K + index + 1),
    );
  });
}

function retainExactMatches(
  exact: readonly RetrievedItem[],
  fused: readonly RetrievedItem[],
  limit: number,
): RetrievedItem[] {
  if (limit === 0) return [];
  const guaranteed = dedupeByMessage(exact).sort(compareRetrievedItems);
  const guaranteedIds = new Set(guaranteed.map((item) => item.sourceMessageId));
  return [
    ...guaranteed,
    ...fused.filter((item) => !guaranteedIds.has(item.sourceMessageId)),
  ].slice(0, limit);
}

function dedupeByMessage(items: readonly RetrievedItem[]): RetrievedItem[] {
  const best = new Map<string, RetrievedItem>();
  for (const item of items) {
    const current = best.get(item.sourceMessageId);
    if (current === undefined || compareRetrievedItems(item, current) < 0) {
      best.set(item.sourceMessageId, item);
    }
  }
  return [...best.values()];
}

function isExactMatchGuaranteed(query: string, candidateText: string): boolean {
  const text = candidateText.toLowerCase();
  return exactMatchTokens(query).some((token) => text.includes(token.toLowerCase()));
}

function exactMatchTokens(query: string): string[] {
  const numeric = query.match(
    /(?:[$€£]\s?\d+(?:[.,]\d+)*|\b\d{1,4}(?:[-/.]\d{1,2}){1,2}\b|\b\d+(?:[.,]\d+)*\b)/g,
  ) ?? [];
  const identifiers = query.match(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g)
    ?? [];
  const properNouns = query.match(/\b[A-Z][a-z]{2,}\b/g)?.filter(
    (_token, index) => index > 0,
  ) ?? [];
  return [...new Set([...numeric, ...identifiers, ...properNouns])];
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
