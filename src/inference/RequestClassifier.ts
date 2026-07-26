import type {
  Attachment,
  CanonicalConversationSnapshot,
  ConversationMessage,
} from '../types/models';

import { getResponseModeConfig, type ResponseMode } from './ResponseMode';

const CONVERSATIONAL_REFERENCE_PATTERN =
  /\b(?:it|that|this|they|them|those|these|also|again|continue|earlier|before|previously|same|other|what about|and then|and if|does that|did i|did we|we discussed|i mentioned|you said)\b/i;
const IMAGE_REFERENCE_PATTERN =
  /\b(?:image|photo|picture|screenshot|label|receipt|document|shown|visible)\b/i;
const GENERIC_IMAGE_REFERENCE_PATTERN =
  /\b(?:the|that|this|same)\s+(?:image|photo|picture|screenshot)\b/i;
const PIXEL_DEPENDENT_PATTERN =
  /\b(?:read|says|written|price|cost|total|expiry|expire|count|how many|exact|small print|fine print|zoom|pixel|color|colour)\b/i;
const PIXEL_DETAIL_PATTERN =
  /\b(?:text|word|letter|number|serial|code|date)\b/i;
const LONG_CONTEXT_REFERENCE_PATTERN =
  /\b(?:earlier|before|previously|remember|recall|mentioned|discussed|said|told|stored|what did i|what did we)\b/i;
const ORDINAL_IMAGE_PATTERN =
  /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(?:image|photo|picture|screenshot)\b/i;
const SELF_CONTAINED_SHORT_QUESTION_PATTERN =
  /^(?:who|what|where|when|why|how)\s+(?:is|are|was|were|do|does|did|can|could|would|should|will)\s+\S+/i;
const IMAGE_DESCRIPTION_STOP_WORDS = new Set([
  'about',
  'describe',
  'first',
  'image',
  'inspect',
  'photo',
  'picture',
  'second',
  'shown',
  'that',
  'the',
  'this',
  'third',
  'visible',
  'what',
]);

export interface RequestClassification {
  readonly isIndependentTextQuestion: boolean;
  readonly isTextFollowUp: boolean;
  readonly isNewImageQuestion: boolean;
  readonly isSameImageFollowUp: boolean;
  readonly isOlderImageReference: boolean;
  readonly isPixelDependent: boolean;
  readonly isLongContextRetrievalRequest: boolean;
  readonly isCrossChatEligible: boolean;
  readonly referencedImageId: string | null;
  readonly imageReferenceAmbiguous: boolean;
}

export interface CrossChatClassificationSettings {
  readonly enabled: boolean;
  readonly conversationExcluded: boolean;
}

interface PriorImage {
  readonly id: string;
  readonly attachment: Attachment;
  readonly message: ConversationMessage;
}

export function classifyRequest(
  snapshot: CanonicalConversationSnapshot,
  responseMode: ResponseMode,
  crossChatSettings: CrossChatClassificationSettings,
): RequestClassification {
  const text = snapshot.currentMessage.text.trim();
  const priorImages = collectPriorImages(snapshot.priorMessages);
  const currentHasImage = snapshot.currentMessage.attachments.some(
    (attachment) => attachment.kind === 'image',
  );
  const hasImageReference = IMAGE_REFERENCE_PATTERN.test(text);
  const isPixelDependent =
    PIXEL_DEPENDENT_PATTERN.test(text) ||
    (PIXEL_DETAIL_PATTERN.test(text) && (currentHasImage || hasImageReference));
  const ordinalTarget =
    resolveOrdinalTarget(text, priorImages) ??
    resolveDescribedTarget(text, priorImages);
  const referencesOlderImage =
    ordinalTarget !== null && ordinalTarget.id !== priorImages[priorImages.length - 1]?.id;
  const imageReferenceAmbiguous =
    !currentHasImage &&
    priorImages.length >= 3 &&
    GENERIC_IMAGE_REFERENCE_PATTERN.test(text) &&
    ordinalTarget === null;
  const isOlderImageReference = referencesOlderImage && !imageReferenceAmbiguous;
  const isSameImageFollowUp =
    !currentHasImage &&
    priorImages.length > 0 &&
    !isOlderImageReference &&
    (imageReferenceAmbiguous || hasImageReference || isPixelDependent);
  const completedTurnCount = countCompletedTurns(snapshot.priorMessages);
  const isLongContextRetrievalRequest =
    completedTurnCount > getResponseModeConfig(responseMode).recentExactTurns &&
    LONG_CONTEXT_REFERENCE_PATTERN.test(text);
  const hasConversationalReference =
    CONVERSATIONAL_REFERENCE_PATTERN.test(text) ||
    isSameImageFollowUp ||
    isOlderImageReference ||
    isLongContextRetrievalRequest;
  const isAmbiguousShortReply =
    wordCount(text) <= 3 &&
    !SELF_CONTAINED_SHORT_QUESTION_PATTERN.test(text) &&
    !currentHasImage;
  const isTextFollowUp = hasConversationalReference || isAmbiguousShortReply;
  const isIndependentTextQuestion = !isTextFollowUp;
  const isCrossChatEligible =
    crossChatSettings.enabled &&
    !crossChatSettings.conversationExcluded &&
    isLongContextRetrievalRequest;

  return {
    isIndependentTextQuestion,
    isTextFollowUp,
    isNewImageQuestion: currentHasImage,
    isSameImageFollowUp,
    isOlderImageReference,
    isPixelDependent,
    isLongContextRetrievalRequest,
    isCrossChatEligible,
    referencedImageId: isOlderImageReference ? ordinalTarget?.id ?? null : null,
    imageReferenceAmbiguous,
  };
}

function collectPriorImages(messages: readonly ConversationMessage[]): PriorImage[] {
  return messages.flatMap((message) =>
    message.attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        id: attachment.imageAssetId ?? attachment.path,
        attachment,
        message,
      })),
  );
}

function resolveOrdinalTarget(text: string, images: readonly PriorImage[]): PriorImage | null {
  const match = ORDINAL_IMAGE_PATTERN.exec(text);
  if (match === null || images.length === 0) {
    return null;
  }
  const ordinal = match[1].toLowerCase();
  if (ordinal === 'last') {
    return images[images.length - 1] ?? null;
  }
  const indexByOrdinal: Readonly<Record<string, number>> = {
    first: 0,
    '1st': 0,
    second: 1,
    '2nd': 1,
    third: 2,
    '3rd': 2,
    fourth: 3,
    '4th': 3,
    fifth: 4,
    '5th': 4,
  };
  return images[indexByOrdinal[ordinal]] ?? null;
}

function resolveDescribedTarget(text: string, images: readonly PriorImage[]): PriorImage | null {
  const queryTokens = descriptiveTokens(text);
  if (queryTokens.size === 0) {
    return null;
  }
  const ranked = images
    .map((image) => ({
      image,
      overlap: overlapCount(queryTokens, descriptiveTokens(image.message.text)),
    }))
    .filter((candidate) => candidate.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap);
  if (ranked.length === 0 || ranked[0].overlap === ranked[1]?.overlap) {
    return null;
  }
  return ranked[0].image;
}

function descriptiveTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !IMAGE_DESCRIPTION_STOP_WORDS.has(token)),
  );
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function countCompletedTurns(messages: readonly ConversationMessage[]): number {
  let completed = 0;
  for (let index = 0; index < messages.length - 1; index += 1) {
    if (
      messages[index]?.role === 'user' &&
      messages[index + 1]?.role === 'assistant' &&
      messages[index + 1]?.status === 'completed'
    ) {
      completed += 1;
      index += 1;
    }
  }
  return completed;
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter((word) => word !== '').length;
}
