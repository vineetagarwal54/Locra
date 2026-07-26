import {
  COSINE_SIMILARITY_THRESHOLD,
  HybridRetriever,
} from '../../../src/retrieval/HybridRetriever';
import type { CompatibleEmbeddingCandidate } from '../../../src/retrieval/types';
import type { RetrievalCandidate, RetrievedItem } from '../../../src/retrieval/types';

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

  it('fuses lexical and semantic rankings without dropping the top lexical result', () => {
    const lexicalCandidate: RetrievalCandidate = {
      id: 'lexical',
      sourceConversationId: 'active',
      sourceMessageId: 'message-lexical',
      imageAssetId: null,
      timestamp: 100,
      contentType: 'chunk',
      text: 'project code ZX-418',
    };
    const lexicalResult: RetrievedItem = { ...lexicalCandidate, score: 2 };
    const semantic = candidate('semantic', 'active', 'message-semantic', [1, 0], 200);
    const retriever = new HybridRetriever(
      { getCompatibleByScope: () => [semantic] },
      { search: jest.fn(() => [lexicalResult]) },
    );

    const result = retriever.search({
      query: 'project code ZX-418',
      queryVector: new Float32Array([1, 0]),
      conversationIds: ['active'],
      embeddingVersion: 'embedding-v1',
      artifactHash: 'hash-1',
      limit: 2,
      lexicalCandidates: [lexicalCandidate],
    });

    expect(result.map((item) => item.sourceMessageId)).toEqual(
      expect.arrayContaining(['message-lexical', 'message-semantic']),
    );
  });

  it.each([
    ['number', 'What was code 418?', 'The recorded code was 418.'],
    ['price', 'Was the price $12.99?', 'The label price is $12.99.'],
    ['date', 'Was it 2026-07-26?', 'The receipt date is 2026-07-26.'],
    ['identifier', 'Where is ZX-418?', 'Identifier ZX-418 is on the label.'],
  ])('retains an exact %s match before applying the limit', (_kind, query, text) => {
    const exact: RetrievalCandidate = {
      id: 'exact',
      sourceConversationId: 'active',
      sourceMessageId: 'message-exact',
      imageAssetId: null,
      timestamp: 1,
      contentType: 'chunk',
      text,
    };
    const semantic = candidate('semantic', 'active', 'message-semantic', [1, 0], 2);
    const retriever = new HybridRetriever(
      { getCompatibleByScope: () => [semantic] },
      { search: jest.fn(() => [{ ...exact, score: 1 }]) },
    );

    const result = retriever.search({
      query,
      queryVector: new Float32Array([1, 0]),
      conversationIds: ['active'],
      embeddingVersion: 'embedding-v1',
      artifactHash: 'hash-1',
      limit: 1,
      lexicalCandidates: [exact],
    });

    expect(result[0]?.sourceMessageId).toBe('message-exact');
  });

  it('deduplicates fused candidates by source message and keeps deterministic ordering', () => {
    const lexical: RetrievedItem = {
      id: 'lexical-copy',
      sourceConversationId: 'active',
      sourceMessageId: 'shared-message',
      imageAssetId: null,
      timestamp: 10,
      contentType: 'chunk',
      text: 'shared topic',
      score: 1,
    };
    const retriever = new HybridRetriever(
      {
        getCompatibleByScope: () => [
          candidate('semantic-copy', 'active', 'shared-message', [1, 0], 20),
          candidate('other', 'active', 'other-message', [1, 0], 20),
        ],
      },
      { search: jest.fn(() => [lexical]) },
    );
    const input = {
      query: 'shared topic',
      queryVector: new Float32Array([1, 0]),
      conversationIds: ['active'],
      embeddingVersion: 'embedding-v1',
      artifactHash: 'hash-1',
      limit: 5,
      lexicalCandidates: [] as RetrievalCandidate[],
    };

    const first = retriever.search(input);
    const second = retriever.search(input);

    expect(first).toEqual(second);
    expect(first.filter((item) => item.sourceMessageId === 'shared-message')).toHaveLength(1);
  });
});
