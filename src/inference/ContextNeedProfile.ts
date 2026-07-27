import type {
  ImageReferenceResolutionResult,
} from './ImageReferenceResolver';
import type { RequestClassification } from './RequestClassifier';

export type ContextNeedProfileId =
  | 'independent'
  | 'recent-follow-up'
  | 'same-chat-memory'
  | 'cross-chat-memory'
  | 'active-image'
  | 'older-image'
  | 'multi-image';

export interface ContextSourceLimits {
  readonly recentTurns: number;
  readonly sameChatItems: number;
  readonly crossChatItems: number;
  readonly imageItems: number;
  readonly facts: number;
  readonly summaries: number;
}

export interface ContextNeedProfile {
  readonly id: ContextNeedProfileId;
  readonly recentConversation: boolean;
  readonly sameChatHistory: boolean;
  readonly crossChatHistory: boolean;
  readonly activeImageEvidence: boolean;
  readonly olderImageEvidence: boolean;
  readonly multipleImageEvidence: boolean;
  readonly originalPixelReinspection: boolean;
  readonly durableFacts: boolean;
  readonly summary: boolean;
  readonly conciseGeneration: boolean;
  readonly detailedGeneration: boolean;
  readonly requiredImageIds: readonly string[];
  readonly limits: ContextSourceLimits;
}

export function deriveContextNeedProfile(
  classification: RequestClassification,
  imageResolution: ImageReferenceResolutionResult,
): ContextNeedProfile {
  const requiredImageIds = imageResolution.references.map((reference) => reference.imageAssetId);
  const multipleImages = classification.isMultipleImageComparison;
  const longMemory =
    classification.isLongContextRetrievalRequest || classification.isCrossChatEligible;
  const activeImage =
    classification.isNewImageQuestion ||
    (classification.isSameImageFollowUp && imageResolution.kind !== 'multiple');
  const olderImage =
    classification.isOlderImageReference ||
    imageResolution.references.some((reference) => reference.imageAssetId !== requiredImageIds.at(-1));

  return {
    id: resolveProfileId(classification, multipleImages, activeImage, olderImage),
    recentConversation:
      classification.isTextFollowUp &&
      !classification.isNewImageQuestion &&
      !longMemory &&
      !multipleImages,
    sameChatHistory: classification.isLongContextRetrievalRequest,
    crossChatHistory: classification.isCrossChatEligible,
    activeImageEvidence: activeImage,
    olderImageEvidence: olderImage || multipleImages,
    multipleImageEvidence: multipleImages,
    originalPixelReinspection: classification.isPixelDependent && !multipleImages,
    durableFacts: classification.isLongContextRetrievalRequest,
    summary: classification.isLongContextRetrievalRequest,
    conciseGeneration:
      !classification.requestsDetailedAnswer && !longMemory && !multipleImages,
    detailedGeneration:
      classification.requestsDetailedAnswer || longMemory || multipleImages,
    requiredImageIds,
    limits: {
      recentTurns:
        classification.isTextFollowUp && !classification.isNewImageQuestion && !longMemory
          ? 1
          : 0,
      sameChatItems: classification.isLongContextRetrievalRequest ? 8 : 0,
      crossChatItems: classification.isCrossChatEligible ? 4 : 0,
      imageItems: multipleImages ? requiredImageIds.length : activeImage || olderImage ? 1 : 0,
      facts: classification.isLongContextRetrievalRequest ? 6 : 0,
      summaries: classification.isLongContextRetrievalRequest ? 2 : 0,
    },
  };
}

function resolveProfileId(
  classification: RequestClassification,
  multipleImages: boolean,
  activeImage: boolean,
  olderImage: boolean,
): ContextNeedProfileId {
  if (multipleImages) return 'multi-image';
  if (classification.isCrossChatEligible) return 'cross-chat-memory';
  if (classification.isLongContextRetrievalRequest) return 'same-chat-memory';
  if (olderImage) return 'older-image';
  if (activeImage) return 'active-image';
  if (classification.isTextFollowUp) return 'recent-follow-up';
  return 'independent';
}
