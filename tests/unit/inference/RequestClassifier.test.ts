import { classifyRequest } from '../../../src/inference/RequestClassifier';
import type {
  CanonicalConversationSnapshot,
  ConversationMessage,
} from '../../../src/types/models';

function message(
  id: string,
  text: string,
  options: { imageAssetId?: string; imagePath?: string; createdAt?: number } = {},
): ConversationMessage {
  return {
    id,
    role: 'user',
    text,
    attachments: options.imagePath === undefined
      ? []
      : [{
          kind: 'image',
          path: options.imagePath,
          imageAssetId: options.imageAssetId,
          available: true,
        }],
    status: 'completed',
    errorMessage: null,
    createdAt: options.createdAt ?? 1,
  };
}

function assistant(id: string, text: string, createdAt: number): ConversationMessage {
  return {
    id,
    role: 'assistant',
    text,
    attachments: [],
    status: 'completed',
    errorMessage: null,
    createdAt,
  };
}

function snapshot(
  currentText: string,
  priorMessages: readonly ConversationMessage[] = [],
  currentImage?: { id: string; path: string },
): CanonicalConversationSnapshot {
  return {
    version: 'canonical-conversation-snapshot-v1',
    conversationId: 'conversation-a',
    priorMessages,
    currentMessage: message('current', currentText, currentImage === undefined
      ? {}
      : { imageAssetId: currentImage.id, imagePath: currentImage.path, createdAt: 100 }),
    contextMemory: null,
  };
}

const CROSS_CHAT_OFF = { enabled: false, conversationExcluded: false } as const;

describe('classifyRequest', () => {
  it('classifies a self-contained text question as independent, never as a follow-up', () => {
    const result = classifyRequest(
      snapshot('What is the capital of Japan?'),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result).toEqual(expect.objectContaining({
      isIndependentTextQuestion: true,
      isTextFollowUp: false,
      isNewImageQuestion: false,
      isSameImageFollowUp: false,
      isOlderImageReference: false,
      isPixelDependent: false,
      isLongContextRetrievalRequest: false,
      isCrossChatEligible: false,
      referencedImageId: null,
      imageReferenceAmbiguous: false,
    }));
  });

  it('conservatively defaults an ambiguous short reply to a text follow-up', () => {
    const result = classifyRequest(snapshot('And then?'), 'Medium', CROSS_CHAT_OFF);

    expect(result.isTextFollowUp).toBe(true);
    expect(result.isIndependentTextQuestion).toBe(false);
  });

  it.each([
    'Define entropy',
    'Explain gravity',
    'Java vs Kotlin?',
    'Capital of France?',
    'Summarize photosynthesis',
    'Convert 5 miles',
    'Accenture spending',
    'What is the cost of tuition?',
    'Count the possible combinations.',
    'What color should my website use?',
    'What is the total population?',
  ])('classifies standalone short request "%s" as independent', (text) => {
    const result = classifyRequest(snapshot(text), 'Medium', CROSS_CHAT_OFF);

    expect(result.isIndependentTextQuestion).toBe(true);
    expect(result.isTextFollowUp).toBe(false);
    expect(result.isPixelDependent).toBe(false);
    expect(result.isSameImageFollowUp).toBe(false);
  });

  it.each([
    'And then?',
    'What about that?',
    'Why is that?',
    'The second one?',
    'Explain it again',
    'What did I say earlier?',
  ])('classifies genuinely dependent short request "%s" as a follow-up', (text) => {
    const result = classifyRequest(snapshot(text), 'Medium', CROSS_CHAT_OFF);

    expect(result.isTextFollowUp).toBe(true);
    expect(result.isIndependentTextQuestion).toBe(false);
  });

  it.each([
    'Read the number in the image',
    'How many objects are visible?',
    'What price is on the receipt?',
    'What color is the chair in the first photo?',
  ])('activates pixel-dependent visual routing for "%s"', (text) => {
    const prior = [
      message('image-1', 'A chair.', {
        imageAssetId: 'asset-1',
        imagePath: '/chair.jpg',
      }),
      assistant('answer-1', 'A wooden chair.', 2),
    ];

    const result = classifyRequest(snapshot(text, prior), 'Medium', CROSS_CHAT_OFF);

    expect(result.isPixelDependent).toBe(true);
    expect(result.isSameImageFollowUp || result.isOlderImageReference).toBe(true);
  });

  it.each([
    'What is the cost of tuition?',
    'Count the possible combinations.',
    'What color should my website use?',
    'What is the total population?',
  ])('does not select a stale image after an image turn for "%s"', (text) => {
    const prior = [
      message('image-1', 'Inspect this image.', {
        imageAssetId: 'asset-1',
        imagePath: '/receipt.jpg',
      }),
      assistant('answer-1', 'A receipt totaling $12.', 2),
    ];

    const result = classifyRequest(snapshot(text, prior), 'Medium', CROSS_CHAT_OFF);

    expect(result).toEqual(expect.objectContaining({
      isIndependentTextQuestion: true,
      isPixelDependent: false,
      isSameImageFollowUp: false,
      isOlderImageReference: false,
      referencedImageId: null,
    }));
  });

  it('treats a uniquely associated object follow-up as text context, not pixel re-inference', () => {
    const prior = [
      message('image-1', 'What is this?', {
        imageAssetId: 'asset-1',
        imagePath: '/watering-can.jpg',
      }),
      assistant('answer-1', 'A green watering can with a long spout.', 2),
    ];

    const result = classifyRequest(
      snapshot('What color is the spout?', prior),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result).toEqual(expect.objectContaining({
      isTextFollowUp: true,
      isSameImageFollowUp: false,
      isPixelDependent: false,
    }));
  });

  it('reuses strongly matching stored visual evidence without forcing pixel re-inference', () => {
    const base = snapshot('What was the tracking code?', [
      message('image-1', 'Inspect the label.', {
        imageAssetId: 'asset-1',
        imagePath: '/label.jpg',
      }),
      assistant('answer-1', 'The label was readable.', 2),
    ]);
    const result = classifyRequest({
      ...base,
      contextMemory: {
        version: 'conversation-context-memory-v1',
        sourceMessageCount: 2,
        rollingSummary: null,
        importantFacts: [],
        mediaEvidence: [{
          version: 'context-media-evidence-v1',
          id: 'evidence-1',
          sourceMessageId: 'image-1',
          modality: 'image',
          sourcePath: 'asset-1',
          summary: 'shipping label',
          facts: [],
          extractedText: ['Tracking code LK-2048'],
          uncertainty: [],
          createdAt: 1,
        }],
      },
    }, 'Medium', CROSS_CHAT_OFF);

    expect(result).toEqual(expect.objectContaining({
      isSameImageFollowUp: true,
      isPixelDependent: false,
    }));
  });

  it('combines a new-image question with independent and pixel-dependent flags', () => {
    const result = classifyRequest(
      snapshot('Read the exact serial number.', [], { id: 'asset-new', path: '/new.jpg' }),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result).toEqual(expect.objectContaining({
      isIndependentTextQuestion: true,
      isNewImageQuestion: true,
      isPixelDependent: true,
    }));
  });

  it('classifies an explicit active-image reference as a same-image follow-up', () => {
    const prior = [
      message('image-user', 'What is this?', { imageAssetId: 'asset-active', imagePath: '/active.jpg' }),
      assistant('image-answer', 'A receipt.', 2),
    ];

    const result = classifyRequest(
      snapshot('What kind of document is that image?', prior),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result.isSameImageFollowUp).toBe(true);
    expect(result.isOlderImageReference).toBe(false);
    expect(result.referencedImageId).toBeNull();
  });

  it('resolves an ordinal older-image reference to its exact image id', () => {
    const prior = [
      message('image-1', 'First.', { imageAssetId: 'asset-1', imagePath: '/first.jpg', createdAt: 1 }),
      assistant('answer-1', 'A receipt.', 2),
      message('image-2', 'Second.', { imageAssetId: 'asset-2', imagePath: '/second.jpg', createdAt: 3 }),
      assistant('answer-2', 'A chair.', 4),
    ];

    const result = classifyRequest(
      snapshot('What total is shown in the first image?', prior),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result.isOlderImageReference).toBe(true);
    expect(result.isSameImageFollowUp).toBe(false);
    expect(result.referencedImageId).toBe('asset-1');
  });

  it('forces an ambiguous image reference to the active-image classification', () => {
    const prior = [
      message('image-1', 'One.', { imageAssetId: 'asset-1', imagePath: '/one.jpg', createdAt: 1 }),
      assistant('answer-1', 'One.', 2),
      message('image-2', 'Two.', { imageAssetId: 'asset-2', imagePath: '/two.jpg', createdAt: 3 }),
      assistant('answer-2', 'Two.', 4),
      message('image-3', 'Three.', { imageAssetId: 'asset-3', imagePath: '/three.jpg', createdAt: 5 }),
      assistant('answer-3', 'Three.', 6),
    ];

    const result = classifyRequest(
      snapshot('What is visible in the image?', prior),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result.imageReferenceAmbiguous).toBe(true);
    expect(result.isSameImageFollowUp).toBe(true);
    expect(result.isOlderImageReference).toBe(false);
    expect(result.referencedImageId).toBeNull();
  });

  it('marks a generic reference ambiguous when exactly two images are plausible', () => {
    const prior = [
      message('image-1', 'One.', { imageAssetId: 'asset-1', imagePath: '/one.jpg', createdAt: 1 }),
      assistant('answer-1', 'One.', 2),
      message('image-2', 'Two.', { imageAssetId: 'asset-2', imagePath: '/two.jpg', createdAt: 3 }),
      assistant('answer-2', 'Two.', 4),
    ];

    const result = classifyRequest(
      snapshot('What is visible in the image?', prior),
      'Medium',
      CROSS_CHAT_OFF,
    );

    expect(result.imageReferenceAmbiguous).toBe(true);
    expect(result.isSameImageFollowUp).toBe(true);
    expect(result.isOlderImageReference).toBe(false);
    expect(result.referencedImageId).toBeNull();
  });

  it('keeps explicit current-chat long-context retrieval scoped to the same chat', () => {
    const prior = Array.from({ length: 10 }, (_, index) => [
      message(`user-${index}`, `Stored detail ${index}.`, { createdAt: index * 2 }),
      assistant(`assistant-${index}`, `Answer ${index}.`, index * 2 + 1),
    ]).flat();

    const result = classifyRequest(
      snapshot('What code did I mention earlier in this conversation?', prior),
      'Low',
      { enabled: true, conversationExcluded: false },
    );

    expect(result.isLongContextRetrievalRequest).toBe(true);
    expect(result.isCrossChatEligible).toBe(false);
    expect(result.isTextFollowUp).toBe(true);
  });

  it.each([
    'What address did I mention in my apartment chat?',
    'What did I previously say about my internship?',
    'Find the model name I discussed in another conversation.',
    'Do you remember what rent amount I mentioned before?',
  ])('allows a new-chat cross-chat memory request independent of chat length: "%s"', (text) => {
    const result = classifyRequest(
      snapshot(text),
      'Low',
      { enabled: true, conversationExcluded: false },
    );

    expect(result.isLongContextRetrievalRequest).toBe(false);
    expect(result.isCrossChatEligible).toBe(true);
    expect(result.isTextFollowUp).toBe(true);
  });

  it('does not make an ordinary independent question cross-chat eligible when enabled', () => {
    const result = classifyRequest(
      snapshot('What is the capital of France?'),
      'Low',
      { enabled: true, conversationExcluded: false },
    );

    expect(result.isCrossChatEligible).toBe(false);
  });

  it('keeps cross-chat ineligible when the conversation is excluded', () => {
    const prior = Array.from({ length: 10 }, (_, index) => [
      message(`user-${index}`, `Stored detail ${index}.`, { createdAt: index * 2 }),
      assistant(`assistant-${index}`, `Answer ${index}.`, index * 2 + 1),
    ]).flat();

    const result = classifyRequest(
      snapshot('What did I mention earlier?', prior),
      'Low',
      { enabled: true, conversationExcluded: true },
    );

    expect(result.isLongContextRetrievalRequest).toBe(true);
    expect(result.isCrossChatEligible).toBe(false);
  });
});
