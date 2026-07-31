import {
  CONVERSATION_FOCUS_LEDGER_VERSION,
  ConversationStateLedgerRepository,
  deriveConversationFocusLedger,
  type ConversationFocusSource,
  type ConversationFocusSourceImage,
  type ConversationFocusSourceMessage,
  type ConversationStateLedgerCache,
} from '../../../src/memory/ConversationStateLedger';

class MemoryLedgerCache implements ConversationStateLedgerCache {
  readonly values = new Map<string, string>();

  getString(key: string): string | undefined {
    return this.values.get(key);
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  remove(key: string): boolean {
    return this.values.delete(key);
  }
}

function user(
  id: string,
  text: string,
  createdAt: number,
): ConversationFocusSourceMessage {
  return {
    id,
    role: 'user',
    replyToMessageId: null,
    attemptNumber: null,
    activeAttempt: false,
    text,
    status: 'submitted',
    createdAt,
    finalizedAt: null,
  };
}

function assistant(
  id: string,
  userMessageId: string,
  text: string,
  createdAt: number,
  options: {
    readonly attemptNumber?: number;
    readonly active?: boolean;
    readonly status?: 'generating' | 'completed' | 'failed' | 'interrupted';
  } = {},
): ConversationFocusSourceMessage {
  return {
    id,
    role: 'assistant',
    replyToMessageId: userMessageId,
    attemptNumber: options.attemptNumber ?? 1,
    activeAttempt: options.active ?? true,
    text,
    status: options.status ?? 'completed',
    createdAt,
    finalizedAt: createdAt,
  };
}

function image(
  id: string,
  sourceMessageId: string,
  createdAt: number,
  availability: ConversationFocusSourceImage['availability'] = 'available',
): ConversationFocusSourceImage {
  return { id, sourceMessageId, ordinal: 0, availability, createdAt };
}

function source(
  messages: readonly ConversationFocusSourceMessage[],
  images: readonly ConversationFocusSourceImage[] = [],
): ConversationFocusSource {
  return { conversationId: 'conversation-a', messages, images };
}

describe('ConversationStateLedger', () => {
  it('makes the first successfully completed image turn active', () => {
    const ledger = deriveConversationFocusLedger(source(
      [user('user-1', 'Describe this image.', 1), assistant('assistant-1', 'user-1', 'A mug.', 2)],
      [image('image-1', 'user-1', 1)],
    ));

    expect(ledger).toEqual(expect.objectContaining({
      schemaVersion: CONVERSATION_FOCUS_LEDGER_VERSION,
      lastCompletedTurnId: 'user-1',
      activeImageFocus: { kind: 'single', imageId: 'image-1' },
      lastExplicitlyReferencedImageIds: ['image-1'],
      activeAssistantMessageId: 'assistant-1',
    }));
  });

  it('replaces the active single image after a second completed image turn', () => {
    const ledger = deriveConversationFocusLedger(source(
      [
        user('user-1', 'Describe this image.', 1),
        assistant('assistant-1', 'user-1', 'First.', 2),
        user('user-2', 'Describe this image.', 3),
        assistant('assistant-2', 'user-2', 'Second.', 4),
      ],
      [image('image-1', 'user-1', 1), image('image-2', 'user-2', 3)],
    ));

    expect(ledger.activeImageFocus).toEqual({ kind: 'single', imageId: 'image-2' });
    expect(ledger.lastExplicitlyReferencedImageIds).toEqual(['image-2']);
  });

  it('records a completed explicit comparison as an ordered active image pair', () => {
    const ledger = deriveConversationFocusLedger(source(
      [
        user('user-1', 'Describe this image.', 1),
        assistant('assistant-1', 'user-1', 'First.', 2),
        user('user-2', 'Describe this image.', 3),
        assistant('assistant-2', 'user-2', 'Second.', 4),
        user('user-3', 'Compare the first image and the second image.', 5),
        assistant('assistant-3', 'user-3', 'The first is brighter.', 6),
      ],
      [image('image-1', 'user-1', 1), image('image-2', 'user-2', 3)],
    ));

    expect(ledger.activeImageFocus).toEqual({
      kind: 'pair',
      imageIds: ['image-1', 'image-2'],
    });
    expect(ledger.lastExplicitlyReferencedImageIds).toEqual(['image-1', 'image-2']);
  });

  it('moves focus to an explicitly referenced older image', () => {
    const ledger = deriveConversationFocusLedger(source(
      [
        user('user-1', 'Describe this image.', 1),
        assistant('assistant-1', 'user-1', 'First.', 2),
        user('user-2', 'Describe this image.', 3),
        assistant('assistant-2', 'user-2', 'Second.', 4),
        user('user-3', 'Use image image-1.', 5),
        assistant('assistant-3', 'user-3', 'Using the first image.', 6),
      ],
      [image('image-1', 'user-1', 1), image('image-2', 'user-2', 3)],
    ));

    expect(ledger.activeImageFocus).toEqual({ kind: 'single', imageId: 'image-1' });
    expect(ledger.lastExplicitlyReferencedImageIds).toEqual(['image-1']);
  });

  it('tracks assistant and code/document follow-up focus only when syntax is clear', () => {
    const ledger = deriveConversationFocusLedger(source([
      user('user-1', 'Topic: graph traversal\nEntity: DFS', 1),
      assistant('assistant-1', 'user-1', '```ts\nfunction visit(): void {}\n```', 2),
      user('user-2', 'Explain the follow-up.', 3),
      assistant('assistant-2', 'user-2', 'The earlier implementation remains relevant.', 4),
    ]));

    expect(ledger.activeAssistantMessageId).toBe('assistant-2');
    expect(ledger.activeArtifact).toEqual({ kind: 'code', messageId: 'assistant-1' });
    expect(ledger.activeTopicLabels).toEqual(['graph traversal']);
    expect(ledger.activeEntityLabels).toEqual(['DFS']);
  });

  it('keeps failed, cancelled, and superseded attempts from corrupting focus', () => {
    const ledger = deriveConversationFocusLedger(source(
      [
        user('user-1', 'Describe this image.', 1),
        assistant('assistant-1', 'user-1', 'Stable answer.', 2, {
          attemptNumber: 1,
          active: false,
        }),
        assistant('assistant-1-retry', 'user-1', 'cancelled partial', 3, {
          attemptNumber: 2,
          active: true,
          status: 'interrupted',
        }),
        user('user-2', 'Describe this image.', 4),
        assistant('assistant-2', 'user-2', 'failed partial', 5, { status: 'failed' }),
      ],
      [image('image-1', 'user-1', 1), image('image-2', 'user-2', 4)],
    ));

    expect(ledger.lastCompletedTurnId).toBe('user-1');
    expect(ledger.activeAssistantMessageId).toBe('assistant-1');
    expect(ledger.activeImageFocus).toEqual({ kind: 'single', imageId: 'image-1' });
    expect(ledger.sourceMessageIds).not.toContain('assistant-1-retry');
    expect(ledger.sourceMessageIds).not.toContain('assistant-2');
  });

  it('projects only the successful active regeneration for a canonical turn', () => {
    const ledger = deriveConversationFocusLedger(source([
      user('user-1', 'Explain this code.', 1),
      assistant('assistant-1', 'user-1', 'Old answer.', 2, {
        attemptNumber: 1,
        active: false,
      }),
      assistant('assistant-2', 'user-1', '```ts\nconst active = true;\n```', 3, {
        attemptNumber: 2,
        active: true,
        status: 'completed',
      }),
    ]));

    expect(ledger.lastCompletedTurnId).toBe('user-1');
    expect(ledger.activeAssistantMessageId).toBe('assistant-2');
    expect(ledger.activeArtifact).toEqual({ kind: 'code', messageId: 'assistant-2' });
    expect(ledger.sourceMessageIds).toEqual(['user-1', 'assistant-2']);
  });

  it('rebuilds deterministically when the persisted cache is missing, stale, or invalid', () => {
    let current = source(
      [user('user-1', 'Describe this image.', 1), assistant('assistant-1', 'user-1', 'A mug.', 2)],
      [image('image-1', 'user-1', 1)],
    );
    const cache = new MemoryLedgerCache();
    const firstRepository = new ConversationStateLedgerRepository(cache, () => current);
    const first = firstRepository.publish('conversation-a');

    const restarted = new ConversationStateLedgerRepository(cache, () => current);
    expect(restarted.get('conversation-a')).toEqual(first);

    cache.values.clear();
    expect(restarted.get('conversation-a')).toEqual(first);

    cache.set(
      'conversation-focus-ledger:conversation-a',
      JSON.stringify({ ...first, sourceStateHash: 'stale' }),
    );
    expect(restarted.get('conversation-a')).toEqual(first);

    cache.set('conversation-focus-ledger:conversation-a', '{not-json');
    expect(restarted.get('conversation-a')).toEqual(first);

    cache.set(
      'conversation-focus-ledger:conversation-a',
      JSON.stringify({
        ...first,
        activeImageFocus: { kind: 'single', imageId: 'invented-image' },
      }),
    );
    expect(restarted.get('conversation-a')).toEqual(first);

    current = source([], []);
    expect(restarted.get('conversation-a').lastCompletedTurnId).toBeNull();
  });

  it('removes unavailable or deleted images from active and unresolved focus', () => {
    const ledger = deriveConversationFocusLedger(source(
      [
        user('user-1', 'Describe this image.', 1),
        assistant('assistant-1', 'user-1', 'First.', 2),
        user('user-2', 'Inspect the image.', 3),
        assistant('assistant-2', 'user-2', 'Which image?', 4),
      ],
      [
        image('image-1', 'user-1', 1, 'deleted'),
        image('image-2', 'user-1', 1, 'missing'),
      ],
    ));

    expect(ledger.activeImageFocus).toBeNull();
    expect(ledger.lastExplicitlyReferencedImageIds).toEqual([]);
    expect(ledger.unresolvedReference).toBeNull();
  });

  it('records unresolved multi-image references without selecting a new focus', () => {
    const ledger = deriveConversationFocusLedger(source(
      [
        user('user-1', 'Describe this image.', 1),
        assistant('assistant-1', 'user-1', 'First.', 2),
        user('user-2', 'Describe this image.', 3),
        assistant('assistant-2', 'user-2', 'Second.', 4),
        user('user-3', 'Inspect the image.', 5),
        assistant('assistant-3', 'user-3', 'Which image?', 6),
      ],
      [image('image-1', 'user-1', 1), image('image-2', 'user-2', 3)],
    ));

    expect(ledger.activeImageFocus).toEqual({ kind: 'single', imageId: 'image-2' });
    expect(ledger.unresolvedReference).toEqual({
      targetType: 'image',
      candidateIds: ['image-1', 'image-2'],
      sourceMessageId: 'user-3',
    });
  });
});
