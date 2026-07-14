import {
  COSINE_SIMILARITY_THRESHOLD,
  HybridRetriever,
} from '../../../src/retrieval/HybridRetriever';
import type { CompatibleEmbeddingCandidate } from '../../../src/retrieval/types';

function candidate(
  id: string,
  conversationId: string,
  messageId: string,
  vector: readonly number[],
  timestamp: number,
): CompatibleEmbeddingCandidate {
  return {
    id,
    sourceConversationId: conversationId,
    sourceMessageId: messageId,
    imageAssetId: null,
    timestamp,
    contentType: 'chunk',
    text: id,
    vector: new Float32Array(vector),
  };
}

describe('HybridRetriever', () => {
  it('pins the cosine threshold at 0.62', () => {
    expect(COSINE_SIMILARITY_THRESHOLD).toBe(0.62);
  });

  it('loads only the requested scope before scoring and excludes low matches', () => {
    const getCompatibleByScope = jest.fn(() => [
      candidate('included', 'active', 'message-1', [1, 0], 100),
      candidate('below-threshold', 'active', 'message-2', [0.61, 0.7924], 200),
    ]);
    const retriever = new HybridRetriever({ getCompatibleByScope }, { search: jest.fn(() => []) });

    const result = retriever.search({
      query: 'query', queryVector: new Float32Array([1, 0]), conversationIds: ['active'],
      embeddingVersion: 'embedding-v1', artifactHash: 'hash-1', limit: 5,
      lexicalCandidates: [],
    });

    expect(getCompatibleByScope).toHaveBeenCalledWith(['active'], 'embedding-v1', 'hash-1');
    expect(result.map((item) => item.sourceMessageId)).toEqual(['message-1']);
  });

  it('deduplicates by source message and applies stable score/time/id ordering and limit', () => {
    const getCompatibleByScope = jest.fn(() => [
      candidate('later-id', 'active', 'message-1', [1, 0], 300),
      candidate('duplicate', 'active', 'message-1', [0.9, 0.1], 100),
      candidate('b-id', 'active', 'message-2', [1, 0], 200),
      candidate('a-id', 'active', 'message-3', [1, 0], 200),
    ]);
    const retriever = new HybridRetriever({ getCompatibleByScope }, { search: jest.fn(() => []) });

    const result = retriever.search({
      query: 'query', queryVector: new Float32Array([1, 0]), conversationIds: ['active'],
      embeddingVersion: 'embedding-v1', artifactHash: 'hash-1', limit: 2,
      lexicalCandidates: [],
    });

    expect(result.map((item) => item.sourceMessageId)).toEqual(['message-1', 'message-3']);
  });

  it('delegates to lexical fallback when no compatible vectors exist', () => {
    const lexicalResult = [{
      id: 'lexical', sourceConversationId: 'active', sourceMessageId: 'message-1',
      imageAssetId: null, timestamp: 100, contentType: 'chunk' as const, text: 'match', score: 1,
    }];
    const lexical = { search: jest.fn(() => lexicalResult) };
    const retriever = new HybridRetriever({ getCompatibleByScope: jest.fn(() => []) }, lexical);

    const result = retriever.search({
      query: 'match', queryVector: new Float32Array([1]), conversationIds: ['active'],
      embeddingVersion: 'embedding-v1', artifactHash: 'hash-1', limit: 2,
      lexicalCandidates: [],
    });

    expect(result).toEqual(lexicalResult);
    expect(lexical.search).toHaveBeenCalled();
  });
});
