import { ConversationTargetResolver } from '../../../src/retrieval/ConversationTargetResolver';

function row(id: string, title: string) {
  return { id, title, normalized_title: title.toLowerCase(), created_at: 1, updated_at: 2 };
}

describe('ConversationTargetResolver', () => {
  it('defaults to active-only without querying candidates', () => {
    const findTargetCandidates = jest.fn(() => []);
    const resolver = new ConversationTargetResolver({ getConversation: jest.fn(), findTargetCandidates });
    expect(resolver.resolve({ rawText: 'What did we decide?' })).toEqual({ kind: 'active' });
    expect(findTargetCandidates).not.toHaveBeenCalled();
  });

  it('resolves a selected stable ID and reports a deleted target', () => {
    const repository = {
      getConversation: jest.fn((id: string) => id === 'live' ? { id } as never : null),
      findTargetCandidates: jest.fn(() => []),
    };
    const resolver = new ConversationTargetResolver(repository);
    expect(resolver.resolve({ selectedId: 'live' })).toEqual({ kind: 'scoped', conversationId: 'live' });
    expect(resolver.resolve({ selectedId: 'deleted' })).toEqual({ kind: 'not-found' });
  });

  it('bounds named title lookup to ten and requires selection when ambiguous', () => {
    const findTargetCandidates = jest.fn(() => [row('a', 'Japan trip'), row('b', 'Japan plans')]);
    const resolver = new ConversationTargetResolver({ getConversation: jest.fn(), findTargetCandidates });
    const result = resolver.resolve({ rawText: 'From my Japan trip chat, what was the hotel?' });
    expect(findTargetCandidates).toHaveBeenCalledWith(['japan', 'trip'], 10);
    expect(result).toEqual(expect.objectContaining({ kind: 'ambiguous' }));
  });

  it('resolves exactly one named chat without any content retrieval', () => {
    const resolver = new ConversationTargetResolver({
      getConversation: jest.fn(), findTargetCandidates: jest.fn(() => [row('a', 'Tax notes')]),
    });
    expect(resolver.resolve({ rawText: 'Use my tax notes conversation for this.' }))
      .toEqual({ kind: 'scoped', conversationId: 'a' });
  });
});
