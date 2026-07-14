import { LexicalFallbackRetriever } from '../../../src/retrieval/LexicalFallbackRetriever';
import type { RetrievalCandidate } from '../../../src/retrieval/types';

const candidates: readonly RetrievalCandidate[] = [
  {
    id: 'z-item', sourceConversationId: 'conversation-1', sourceMessageId: 'message-1',
    imageAssetId: null, timestamp: 100, contentType: 'chunk', text: 'nightly backup retention',
  },
  {
    id: 'a-item', sourceConversationId: 'conversation-1', sourceMessageId: 'message-2',
    imageAssetId: null, timestamp: 200, contentType: 'chunk', text: 'nightly backup schedule',
  },
  {
    id: 'unrelated', sourceConversationId: 'conversation-1', sourceMessageId: 'message-3',
    imageAssetId: null, timestamp: 300, contentType: 'chunk', text: 'interface color choice',
  },
];

describe('LexicalFallbackRetriever', () => {
  it('returns deterministic overlap results and omits filler', () => {
    const retriever = new LexicalFallbackRetriever();
    const input = { query: 'What is the nightly backup plan?', candidates, limit: 5 };

    const first = retriever.search(input);
    const second = retriever.search(input);

    expect(first).toEqual(second);
    expect(first.map((item) => item.sourceMessageId)).toEqual(['message-2', 'message-1']);
    expect(first.every((item) => item.score > 0)).toBe(true);
  });
});

