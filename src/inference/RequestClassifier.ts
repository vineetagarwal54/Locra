import type {
  CanonicalConversationSnapshot,
  ConversationMessage,
} from '../types/models';

import { getResponseModeConfig, type ResponseMode } from './ResponseMode';

const CONVERSATIONAL_REFERENCE_PATTERN =
  /\b(?:it|that|this|they|them|those|these|also|again|continue|earlier|before|previously|same|other|what about|and then|and if|does that|did i|did we|we discussed|i mentioned|you said|which one|first one|second one|third one|last one)\b/i;
const IMAGE_REFERENCE_PATTERN =
  /\b(?:image|photo|picture|screenshot|label|receipt|document|shown|visible)\b/i;
const PIXEL_DEPENDENT_PATTERN =
  /\b(?:read|says|written|price|cost|total|expiry|expire|count|how many|exact|small print|fine print|zoom|pixel|color|colour)\b/i;
const PIXEL_DETAIL_PATTERN =
  /\b(?:text|word|letter|number|serial|code|date)\b/i;
const LONG_CONTEXT_REFERENCE_PATTERN =
  /\b(?:earlier|before|previously|remember|recall|mentioned|discussed|said|told|stored|what did i|what did we|did we)\b/i;
const ORDINAL_IMAGE_PATTERN =
  /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\s+(?:image|photo|picture|screenshot)\b/i;
const SHORT_DEPENDENT_PATTERN =
  /^(?:and then|then|why|how so|what next|continue|go on|more|again)\b/i;

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
  const ordinalTarget = resolveOrdinalTarget(text, priorImages);
  const referencesStoredImageEvidence = hasStoredImageEvidenceOverlap(snapshot, text);
  const referencesOlderImage =
    ordinalTarget !== null && ordinalTarget.id !== priorImages[priorImages.length - 1]?.id;
  const imageReferenceAmbiguous =
    !currentHasImage &&
    priorImages.length >= 2 &&
    hasImageReference &&
    ordinalTarget === null;
  const isOlderImageReference = referencesOlderImage && !imageReferenceAmbiguous;
  const isSameImageFollowUp =
    !currentHasImage &&
    priorImages.length > 0 &&
    !isOlderImageReference &&
    (imageReferenceAmbiguous || hasImageReference || isPixelDependent || referencesStoredImageEvidence);
  const completedTurnCount = countCompletedTurns(snapshot.priorMessages);
  const isLongContextRetrievalRequest =
    completedTurnCount > getResponseModeConfig(responseMode).recentExactTurns &&
    LONG_CONTEXT_REFERENCE_PATTERN.test(text);
  const hasConversationalReference =
    CONVERSATIONAL_REFERENCE_PATTERN.test(text) ||
    isSameImageFollowUp ||
    isOlderImageReference ||
    isLongContextRetrievalRequest;
  const isTextFollowUp =
    hasConversationalReference ||
    (!currentHasImage && SHORT_DEPENDENT_PATTERN.test(text));
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

function hasStoredImageEvidenceOverlap(
  snapshot: CanonicalConversationSnapshot,
  text: string,
): boolean {
  const queryTokens = meaningfulTokens(text);
  if (queryTokens.size < 2) return false;
  return (snapshot.contextMemory?.mediaEvidence ?? []).some((evidence) => {
    const evidenceTokens = meaningfulTokens([
      evidence.summary,
      ...evidence.facts,
      ...evidence.extractedText,
    ].join(' '));
    let overlap = 0;
    for (const token of queryTokens) {
      if (evidenceTokens.has(token)) overlap += 1;
    }
    return overlap >= 2;
  });
}

function meaningfulTokens(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'this', 'that', 'what', 'was', 'were', 'is', 'are', 'on', 'in', 'of', 'a', 'an',
  ]);
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function collectPriorImages(messages: readonly ConversationMessage[]): PriorImage[] {
  return messages.flatMap((message) =>
    message.attachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        id: attachment.imageAssetId ?? attachment.path,
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
