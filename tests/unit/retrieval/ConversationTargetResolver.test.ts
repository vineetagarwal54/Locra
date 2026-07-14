import { ConversationTargetResolver } from '../../../src/retrieval/ConversationTargetResolver';

function row(id: string, title: string, updatedAt = 2) {
  return { id, title, normalized_title: title.toLowerCase(), created_at: 1, updated_at: updatedAt };
}

function makeRepo(overrides: Partial<{
  getConversation: jest.Mock;
  findTargetCandidates: jest.Mock;
  getMostRecentOther: jest.Mock;
}> = {}) {
  return {
    getConversation: overrides.getConversation ?? jest.fn(),
    findTargetCandidates: overrides.findTargetCandidates ?? jest.fn(() => []),
    getMostRecentOther: overrides.getMostRecentOther ?? jest.fn(() => null),
  };
}

describe('ConversationTargetResolver', () => {
  it('defaults to active-only without querying candidates', () => {
    const repo = makeRepo();
    const resolver = new ConversationTargetResolver(repo);
    expect(resolver.resolve({ rawText: 'What did we decide?' })).toEqual({ kind: 'active' });
    expect(repo.findTargetCandidates).not.toHaveBeenCalled();
    expect(repo.getMostRecentOther).not.toHaveBeenCalled();
  });

  it('resolves a selected stable ID and reports a deleted target', () => {
    const repo = makeRepo({
      getConversation: jest.fn((id: string) => (id === 'live' ? ({ id } as never) : null)),
    });
    const resolver = new ConversationTargetResolver(repo);
    expect(resolver.resolve({ selectedId: 'live' })).toEqual({ kind: 'scoped', conversationId: 'live' });
    expect(resolver.resolve({ selectedId: 'deleted' })).toEqual({ kind: 'not-found' });
  });

  it('bounds named title lookup to ten and requires selection when ambiguous', () => {
    const repo = makeRepo({
      findTargetCandidates: jest.fn(() => [row('a', 'Japan trip'), row('b', 'Japan plans')]),
    });
    const resolver = new ConversationTargetResolver(repo);
    const result = resolver.resolve({ rawText: 'From my Japan trip chat, what was the hotel?' });
    expect(repo.findTargetCandidates).toHaveBeenCalledWith(['japan', 'trip'], 10);
    expect(result).toEqual(expect.objectContaining({ kind: 'ambiguous' }));
  });

  it('resolves exactly one named chat without any content retrieval', () => {
    const repo = makeRepo({ findTargetCandidates: jest.fn(() => [row('a', 'Tax notes')]) });
    const resolver = new ConversationTargetResolver(repo);
    expect(resolver.resolve({ rawText: 'Use my tax notes conversation for this.' })).toEqual({
      kind: 'scoped',
      conversationId: 'a',
    });
  });

  it('resolves a natural "previous chat" reference to the most recent other conversation', () => {
    const getMostRecentOther = jest.fn(() => row('prev', 'Earlier thread'));
    const repo = makeRepo({ getMostRecentOther });
    const resolver = new ConversationTargetResolver(repo);

    expect(
      resolver.resolve({ rawText: 'Do you remember our previous chat?', activeConversationId: 'active' })
    ).toEqual({ kind: 'scoped', conversationId: 'prev' });
    expect(
      resolver.resolve({ rawText: 'What did we discuss last time?', activeConversationId: 'active' })
    ).toEqual({ kind: 'scoped', conversationId: 'prev' });
    expect(getMostRecentOther).toHaveBeenCalledWith('active');
    expect(repo.findTargetCandidates).not.toHaveBeenCalled();
  });

  it('reports not-found when a previous-chat reference has no other conversation', () => {
    const repo = makeRepo({ getMostRecentOther: jest.fn(() => null) });
    const resolver = new ConversationTargetResolver(repo);
    expect(
      resolver.resolve({ rawText: 'Remember our previous chat?', activeConversationId: 'active' })
    ).toEqual({ kind: 'not-found' });
  });

  it('detects "the chat where we discussed X" as a named target', () => {
    const findTargetCandidates = jest.fn(() => [row('ssd', 'SSD research')]);
    const repo = makeRepo({ findTargetCandidates });
    const resolver = new ConversationTargetResolver(repo);
    expect(
      resolver.resolve({ rawText: 'Use the chat where we discussed SSDs.', activeConversationId: 'x' })
    ).toEqual({ kind: 'scoped', conversationId: 'ssd' });
    expect(findTargetCandidates).toHaveBeenCalledWith(['ssds'], 10);
  });

  it('never returns the active conversation as a cross-chat candidate', () => {
    const findTargetCandidates = jest.fn(() => [row('active', 'Budget'), row('other', 'Budget')]);
    const repo = makeRepo({ findTargetCandidates });
    const resolver = new ConversationTargetResolver(repo);
    expect(
      resolver.resolve({ rawText: 'Use the budget chat.', activeConversationId: 'active' })
    ).toEqual({ kind: 'scoped', conversationId: 'other' });
  });
});
