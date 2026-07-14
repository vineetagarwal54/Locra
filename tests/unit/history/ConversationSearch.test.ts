import {
  deriveConversationPreview,
  deriveConversationTitle,
  IMAGE_CONVERSATION_TITLE,
  searchConversations,
} from '../../../src/history/ConversationSearch';
import type { Conversation } from '../../../src/types/models';

const BASE_TIME = 1_700_000_000_000;

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const id = overrides.id ?? 'conversation-1';
  const createdAt = overrides.createdAt ?? BASE_TIME;

  return {
    id,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    messages: overrides.messages ?? [
      {
        id: `${id}:user`,
        role: 'user',
        text: 'What is in the image?',
        attachments: [{ kind: 'image', path: '/images/mug.jpg' }],
        status: 'completed',
        errorMessage: null,
        createdAt,
      },
      {
        id: `${id}:assistant`,
        role: 'assistant',
        text: 'A ceramic mug on a desk.',
        attachments: [],
        status: 'completed',
        errorMessage: null,
        createdAt: createdAt + 1,
      },
    ],
    status: 'completed',
    errorMessage: null,
    metrics: null,
    flagged: false,
    flagNote: null,
    ...overrides,
  };
}

describe('ConversationSearch', () => {
  it('derives a title from the first message text and falls back for image-only starts', () => {
    expect(deriveConversationTitle(makeConversation())).toBe('What is in the image?');

    expect(
      deriveConversationTitle(
        makeConversation({
          messages: [
            {
              id: 'image-only:user',
              role: 'user',
              text: '   ',
              attachments: [{ kind: 'image', path: '/private/path/receipt.jpg' }],
              status: 'completed',
              errorMessage: null,
              createdAt: BASE_TIME,
            },
          ],
        })
      )
    ).toBe(IMAGE_CONVERSATION_TITLE);
  });

  it('uses a persisted title when a paginated header has no messages', () => {
    expect(deriveConversationTitle(makeConversation({
      title: 'Niagara trip',
      messages: [],
    }))).toBe('Niagara trip');
  });

  it('previews the completed assistant response or the most recent user text otherwise', () => {
    expect(deriveConversationPreview(makeConversation())).toBe('A ceramic mug on a desk.');

    expect(
      deriveConversationPreview(
        makeConversation({
          messages: [
            {
              id: 'c:user-1',
              role: 'user',
              text: 'First question',
              attachments: [],
              status: 'completed',
              errorMessage: null,
              createdAt: BASE_TIME,
            },
            {
              id: 'c:assistant-1',
              role: 'assistant',
              text: 'Partial text',
              attachments: [],
              status: 'generating',
              errorMessage: 'not previewable',
              createdAt: BASE_TIME + 1,
            },
            {
              id: 'c:user-2',
              role: 'user',
              text: 'Latest user question',
              attachments: [],
              status: 'completed',
              errorMessage: null,
              createdAt: BASE_TIME + 2,
            },
            {
              id: 'c:assistant-2',
              role: 'assistant',
              text: '',
              attachments: [],
              status: 'failed',
              errorMessage: 'Out of memory',
              createdAt: BASE_TIME + 3,
            },
          ],
        })
      )
    ).toBe('Latest user question');
  });

  it('searches title and message text case-insensitively', () => {
    const conversations = [
      makeConversation({ id: 'mug' }),
      makeConversation({
        id: 'books',
        messages: [
          {
            id: 'books:user',
            role: 'user',
            text: 'Read the book spine',
            attachments: [],
            status: 'completed',
            errorMessage: null,
            createdAt: BASE_TIME,
          },
        ],
      }),
    ];

    expect(searchConversations(conversations, 'CERAMIC')).toEqual([conversations[0]]);
    expect(searchConversations(conversations, 'book')).toEqual([conversations[1]]);
  });

  it('returns the unchanged list for an empty query', () => {
    const conversations = [makeConversation({ id: 'one' }), makeConversation({ id: 'two' })];

    expect(searchConversations(conversations, '   ')).toBe(conversations);
  });

  it('does not match errors, metrics, attachment paths, or hidden inference content', () => {
    const conversation = makeConversation({
      errorMessage: 'needle root error',
      metrics: {
        modelLoadTimeMs: 1,
        preprocessingTimeMs: 2,
        firstTokenLatencyMs: 3,
        tokensPerSecond: 4,
        totalWallTimeMs: 5,
      },
      contextMemory: {
        version: 'conversation-context-memory-v1',
        sourceMessageCount: 1,
        rollingSummary: null,
        importantFacts: [],
        mediaEvidence: [
          {
            version: 'context-media-evidence-v1',
            id: 'private:user:image',
            sourceMessageId: 'private:user',
            modality: 'image',
            sourcePath: '/private/photo.jpg',
            summary: 'needle hidden summary',
            facts: [],
            extractedText: ['needle extracted text'],
            uncertainty: [],
            createdAt: BASE_TIME,
          },
        ],
      },
      messages: [
        {
          id: 'private:user',
          role: 'user',
          text: '',
          attachments: [{ kind: 'image', path: '/private/needle/photo.jpg' }],
          status: 'completed',
          errorMessage: 'needle message error',
          createdAt: BASE_TIME,
        },
      ],
    });

    expect(searchConversations([conversation], 'needle')).toEqual([]);
    expect(searchConversations([conversation], 'tokensPerSecond')).toEqual([]);
  });
});
