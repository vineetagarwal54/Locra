import {
  deriveContextNeedProfile,
} from '../../../src/inference/ContextNeedProfile';
import type { ImageReferenceResolutionResult } from '../../../src/inference/ImageReferenceResolver';
import type { RequestClassification } from '../../../src/inference/RequestClassifier';

function classification(
  overrides: Partial<RequestClassification> = {},
): RequestClassification {
  return {
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
    hasVisualReference: false,
    hasOrdinalImageReference: false,
    hasDescriptiveImageReference: false,
    isMultipleImageComparison: false,
    requestsDetailedAnswer: false,
    ...overrides,
  };
}

const NO_IMAGES: ImageReferenceResolutionResult = {
  kind: 'none',
  references: [],
  ambiguousCandidateIds: [],
};

describe('deriveContextNeedProfile', () => {
  it('keeps independent text requests isolated from every historical source', () => {
    expect(deriveContextNeedProfile(classification(), NO_IMAGES)).toEqual(
      expect.objectContaining({
        recentConversation: false,
        sameChatHistory: false,
        crossChatHistory: false,
        activeImageEvidence: false,
        olderImageEvidence: false,
        durableFacts: false,
        summary: false,
        conciseGeneration: true,
      }),
    );
  });

  it('separates the minimal follow-up chain from long-memory retrieval', () => {
    const profile = deriveContextNeedProfile(
      classification({
        isIndependentTextQuestion: false,
        isTextFollowUp: true,
      }),
      NO_IMAGES,
    );

    expect(profile.recentConversation).toBe(true);
    expect(profile.sameChatHistory).toBe(false);
    expect(profile.limits.recentTurns).toBe(1);
  });

  it('does not protect unrelated recent turns for long-memory requests', () => {
    const profile = deriveContextNeedProfile(
      classification({
        isIndependentTextQuestion: false,
        isTextFollowUp: true,
        isLongContextRetrievalRequest: true,
      }),
      NO_IMAGES,
    );

    expect(profile.sameChatHistory).toBe(true);
    expect(profile.durableFacts).toBe(true);
    expect(profile.summary).toBe(true);
    expect(profile.recentConversation).toBe(false);
  });

  it('requests labeled evidence for every uniquely resolved comparison image', () => {
    const profile = deriveContextNeedProfile(
      classification({
        isIndependentTextQuestion: false,
        isTextFollowUp: true,
        hasVisualReference: true,
        isMultipleImageComparison: true,
      }),
      {
        kind: 'multiple',
        references: [
          { imageAssetId: 'a', sourceMessageId: 'm-a', localPath: '/a.jpg', available: true },
          { imageAssetId: 'b', sourceMessageId: 'm-b', localPath: '/b.jpg', available: false },
        ],
        ambiguousCandidateIds: [],
      },
    );

    expect(profile.multipleImageEvidence).toBe(true);
    expect(profile.olderImageEvidence).toBe(true);
    expect(profile.originalPixelReinspection).toBe(false);
    expect(profile.requiredImageIds).toEqual(['a', 'b']);
  });
});
