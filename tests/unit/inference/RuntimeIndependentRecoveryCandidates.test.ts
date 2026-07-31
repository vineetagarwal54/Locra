import {
  buildRuntimeIndependentRecoveryCandidates,
} from '../../../src/inference/RuntimeIndependentRecoveryCandidates';
import type { ImageEntity } from '../../../src/persistence/ImageEntityRepository';
import type { CanonicalConversationSnapshot } from '../../../src/types/models';

function snapshot(currentText: string): CanonicalConversationSnapshot {
  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: 'conversation-1',
    priorMessages: [
      {
        id: 'user-rent', role: 'user', text: 'My apartment rent is 1900 dollars.',
        attachments: [], status: 'completed', errorMessage: null, createdAt: 1,
      },
      {
        id: 'assistant-rent', role: 'assistant', text: 'I will remember that.',
        attachments: [], status: 'completed', errorMessage: null, createdAt: 2,
      },
    ],
    currentMessage: {
      id: 'user-current', role: 'user', text: currentText,
      attachments: [], status: 'completed', errorMessage: null, createdAt: 3,
    },
    contextMemory: null,
  };
}

function snapshotWithMessages(
  currentText: string,
  priorMessages: CanonicalConversationSnapshot['priorMessages'],
): CanonicalConversationSnapshot {
  return {
    ...snapshot(currentText),
    priorMessages,
  };
}

describe('buildRuntimeIndependentRecoveryCandidates', () => {
  it('supplies the exact same-chat user fact for rent recall', () => {
    expect(buildRuntimeIndependentRecoveryCandidates(snapshot(
      'What was the rent of my apartment?',
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'user-fact:user-rent',
        kind: 'user-fact',
        sourceMessageId: 'user-rent',
        content: 'My apartment rent is 1900 dollars.',
        exactOrDirect: true,
      }),
    ]));
  });

  it('does not recover user facts or assistant prose for an unrelated question', () => {
    expect(buildRuntimeIndependentRecoveryCandidates(snapshot(
      'How many moons does Mars have?',
    ))).toEqual([]);
  });

  it('recovers one uniquely matching exact token from a useful assistant answer', () => {
    const result = buildRuntimeIndependentRecoveryCandidates(snapshotWithMessages(
      'What does node do here?',
      [
        {
          id: 'user-code', role: 'user', text: 'Explain this tree.',
          attachments: [], status: 'completed', errorMessage: null, createdAt: 1,
        },
        {
          id: 'assistant-code', role: 'assistant',
          text: 'The node stores the current value and points to its children.',
          attachments: [], status: 'completed', errorMessage: null, createdAt: 2,
        },
      ],
    ));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'same-chat:assistant-code',
        sourceMessageId: 'assistant-code',
      }),
    ]));
  });

  it('recovers an exact possessive fact slot such as "my name"', () => {
    const result = buildRuntimeIndependentRecoveryCandidates(snapshotWithMessages(
      'What is my name?',
      [
        {
          id: 'user-name', role: 'user', text: 'My name is Vineet.',
          attachments: [], status: 'completed', errorMessage: null, createdAt: 1,
        },
        {
          id: 'assistant-name', role: 'assistant', text: 'Nice to meet you.',
          attachments: [], status: 'completed', errorMessage: null, createdAt: 2,
        },
      ],
    ));

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'user-fact:user-name',
        sourceMessageId: 'user-name',
      }),
    ]));
  });

  it('does not promote a one-token match when it is not unique', () => {
    const result = buildRuntimeIndependentRecoveryCandidates(snapshotWithMessages(
      'What does node mean?',
      [
        {
          id: 'user-one', role: 'user', text: 'This node is the root.',
          attachments: [], status: 'completed', errorMessage: null, createdAt: 1,
        },
        {
          id: 'assistant-one', role: 'assistant', text: 'The node has two children.',
          attachments: [], status: 'completed', errorMessage: null, createdAt: 2,
        },
      ],
    ));

    expect(result).toEqual([]);
  });

  it('recovers only a unique exact entity alias', () => {
    expect(buildRuntimeIndependentRecoveryCandidates(
      snapshot('Compare the fruit image.'),
      {
        entityAliases: [
          {
            id: 'image-fruit',
            sourceMessageId: 'message-fruit',
            aliases: ['fruit'],
          },
          {
            id: 'image-mattress',
            sourceMessageId: 'message-mattress',
            aliases: ['mattress'],
          },
        ],
      },
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'entity:image-fruit',
        kind: 'direct-entity',
        sourceMessageId: 'message-fruit',
      }),
    ]));
  });

  it('does not recover an active comparison pair for an unrelated question', () => {
    const images: ImageEntity[] = [
      {
        id: 'image-fruit', conversationId: 'conversation-1',
        sourceMessageId: 'message-fruit', assetRevision: 'fruit-v1',
        ordinal: 0,
        assetAvailability: 'available', localAssetReference: '/images/fruit.jpg',
        evidenceIds: [], createdAt: 1, updatedAt: 1,
      },
      {
        id: 'image-mattress', conversationId: 'conversation-1',
        sourceMessageId: 'message-mattress', assetRevision: 'mattress-v1',
        ordinal: 0,
        assetAvailability: 'available', localAssetReference: '/images/mattress.jpg',
        evidenceIds: [], createdAt: 2, updatedAt: 2,
      },
    ];
    expect(buildRuntimeIndependentRecoveryCandidates(
      snapshot('How many moons does Mars have?'),
      {
        imageEntities: images,
        activeComparisonImageIds: images.map((image) => image.id),
      },
    )).toEqual([]);
  });
});
