import {
  resolveCrossChatConversationIds,
} from '../../../src/inference/ContextOrchestrator';
import { HybridRetriever } from '../../../src/retrieval/HybridRetriever';

describe('cross-chat retrieval scope', () => {
  it('keeps exact same-chat scope while the global setting is off', () => {
    expect(resolveCrossChatConversationIds(
      'current',
      false,
      false,
      ['current', 'other'],
    )).toEqual(['current']);
  });

  it('expands to eligible local conversations without duplicates when enabled', () => {
    expect(resolveCrossChatConversationIds(
      'current',
      true,
      false,
      ['other-b', 'current', 'other-a', 'other-b'],
    )).toEqual(['current', 'other-b', 'other-a']);
  });

  it('isolates an excluded current conversation in both directions', () => {
    expect(resolveCrossChatConversationIds(
      'current',
      true,
      true,
      ['other'],
    )).toEqual(['current']);
  });

  it('passes the resolved scope to storage before semantic scoring', () => {
    const getCompatibleByScope = jest.fn(() => []);
    const lexicalSearch = jest.fn(() => []);
    const retriever = new HybridRetriever(
      { getCompatibleByScope },
      { search: lexicalSearch },
    );
    const scope = resolveCrossChatConversationIds(
      'current',
      true,
      false,
      ['other'],
    );

    retriever.search({
      query: 'earlier topic',
      queryVector: new Float32Array([1]),
      conversationIds: scope,
      embeddingVersion: 'embedding-v1',
      artifactHash: 'hash',
      limit: 2,
      lexicalCandidates: [],
    });

    expect(getCompatibleByScope).toHaveBeenCalledWith(
      ['current', 'other'],
      'embedding-v1',
      'hash',
    );
  });
});
