import type {
  CanonicalConversationSnapshot,
  ConversationMessage,
} from '../types/models';

import { getResponseModeConfig, type ResponseMode } from './ResponseMode';

const CONVERSATIONAL_REFERENCE_PATTERN =
  /\b(?:it|that|this|they|them|those|these|also|again|continue|earlier|before|previously|same|other|what about|and then|and if|does that|did i|did we|we discussed|i mentioned|you said|which one|first one|second one|third one|last one)\b/i;
const VISUAL_REFERENCE_TERMS = new Set([
  'image', 'photo', 'picture', 'screenshot', 'receipt', 'document',
  'visual', 'screen',
]);
const OVERLOADED_VISUAL_TERMS = new Set(['label', 'object']);
const VISUAL_ATTRIBUTE_TERMS = new Set([
  'shown', 'visible', 'pictured', 'photographed', 'displayed',
]);
const PIXEL_DEPENDENT_PATTERN =
  /\b(?:read|says|written|price|cost|total|expiry|expire|count|how many|exact|small print|fine print|zoom|pixel|color|colour)\b/i;
const PIXEL_DETAIL_PATTERN =
  /\b(?:text|word|letter|number|serial|code|date)\b/i;
const LONG_CONTEXT_REFERENCE_PATTERN =
  /\b(?:earlier|before|previously|remember|recall|mentioned|discussed|said|told|stored|what did i|what did we|did we)\b/i;
const CROSS_CHAT_REFERENCE_PATTERN =
  /\b(?:another (?:chat|conversation)|other (?:chat|conversation)|previous(?:ly)?|before|remember|recall|did i (?:say|mention|discuss)|what did i (?:say|mention|discuss)|i (?:said|mentioned|discussed)|my [a-z0-9-]+ (?:chat|conversation))\b/i;
const CURRENT_CHAT_ONLY_PATTERN =
  /\b(?:this|current|same) (?:chat|conversation)\b/i;
const ORDINAL_IMAGE_PATTERN =
  /\b(first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five|last)\s+(?:image|images|photo|photos|picture|pictures|screenshot|screenshots)\b/i;
const SHORT_DEPENDENT_PATTERN =
  /^(?:and then|then|why|how so|what next|continue|go on|more|again)\b/i;
const COMPARISON_PATTERN =
  /\b(?:compare|comparison|contrast|difference|differences|differ|between|both|each|versus|vs\.?)\b/i;
const DETAIL_REQUEST_PATTERN =
  /\b(?:step[- ]by[- ]step|comprehensive|in[- ]depth|detailed|thorough|explain all|cover all|include examples?|every (?:detail|item|step|option)|full (?:explanation|breakdown|comparison))\b/i;

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
  readonly hasVisualReference: boolean;
  readonly hasOrdinalImageReference: boolean;
  readonly hasDescriptiveImageReference: boolean;
  readonly isMultipleImageComparison: boolean;
  readonly requestsDetailedAnswer: boolean;
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
  const normalizedTerms = normalizedSemanticTerms(text);
  const referencesStoredImageEvidence = hasStoredImageEvidenceOverlap(snapshot, text);
  const referencesImageAssociatedTurn = hasImageAssociatedTurnOverlap(snapshot, text);
  const hasStrongVisualTerm =
    hasAnyTerm(normalizedTerms, VISUAL_REFERENCE_TERMS) ||
    hasAnyTerm(normalizedTerms, VISUAL_ATTRIBUTE_TERMS);
  const hasOverloadedVisualTerm = hasAnyTerm(normalizedTerms, OVERLOADED_VISUAL_TERMS);
  const hasImageReference =
    hasStrongVisualTerm ||
    (hasOverloadedVisualTerm && (currentHasImage || referencesStoredImageEvidence));
  const ordinalTarget = resolveOrdinalTarget(text, priorImages);
  const hasOrdinalImageReference = ORDINAL_IMAGE_PATTERN.test(text);
  const ordinalReferenceCount = countOrdinalReferences(text);
  const isMultipleImageComparison =
    COMPARISON_PATTERN.test(text) &&
    hasImageReference &&
    (ordinalReferenceCount >= 2 ||
      /\b(?:these|those|both|multiple|several)\s+(?:images?|photos?|pictures?|screenshots?|objects?)\b/i.test(text) ||
      /\b(?:images|photos|pictures|screenshots|objects)\b/i.test(text));
  const hasDirectVisualAnchor =
    currentHasImage ||
    hasImageReference ||
    ordinalTarget !== null;
  const isPixelDependent =
    hasDirectVisualAnchor &&
    (PIXEL_DEPENDENT_PATTERN.test(text) || PIXEL_DETAIL_PATTERN.test(text));
  const referencesOlderImage =
    ordinalTarget !== null && ordinalTarget.id !== priorImages[priorImages.length - 1]?.id;
  const imageReferenceAmbiguous =
    !currentHasImage &&
    priorImages.length >= 2 &&
    (hasImageReference || referencesStoredImageEvidence || isMultipleImageComparison) &&
    ordinalTarget === null;
  const isOlderImageReference = referencesOlderImage && !imageReferenceAmbiguous;
  const isSameImageFollowUp =
    !currentHasImage &&
    priorImages.length > 0 &&
    !isOlderImageReference &&
    (imageReferenceAmbiguous || hasImageReference || referencesStoredImageEvidence);
  const completedTurnCount = countCompletedTurns(snapshot.priorMessages);
  const isLongContextRetrievalRequest =
    completedTurnCount > getResponseModeConfig(responseMode).recentExactTurns &&
    LONG_CONTEXT_REFERENCE_PATTERN.test(text);
  const requestsPriorConversationMemory =
    CROSS_CHAT_REFERENCE_PATTERN.test(text) &&
    !CURRENT_CHAT_ONLY_PATTERN.test(text);
  const isCrossChatEligible =
    crossChatSettings.enabled &&
    !crossChatSettings.conversationExcluded &&
    requestsPriorConversationMemory;
  const hasConversationalReference =
    CONVERSATIONAL_REFERENCE_PATTERN.test(text) ||
    isSameImageFollowUp ||
    isOlderImageReference ||
    isLongContextRetrievalRequest ||
    isCrossChatEligible ||
    referencesImageAssociatedTurn;
  const isTextFollowUp =
    hasConversationalReference ||
    (!currentHasImage && SHORT_DEPENDENT_PATTERN.test(text));
  const isIndependentTextQuestion = !isTextFollowUp;
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
    hasVisualReference: currentHasImage || hasImageReference,
    hasOrdinalImageReference,
    hasDescriptiveImageReference: hasImageReference && !hasOrdinalImageReference,
    isMultipleImageComparison,
    requestsDetailedAnswer: DETAIL_REQUEST_PATTERN.test(text),
  };
}

function hasStoredImageEvidenceOverlap(
  snapshot: CanonicalConversationSnapshot,
  text: string,
): boolean {
  const queryTokens = meaningfulTokens(text);
  if (queryTokens.size === 0) return false;
  return (snapshot.contextMemory?.mediaEvidence ?? []).some((evidence) => {
    const evidenceTokens = meaningfulTokens([
      evidence.summary,
      ...evidence.facts,
      ...evidence.extractedText,
    ].join(' '));
    return hasTokenOverlap(queryTokens, evidenceTokens);
  });
}

function hasImageAssociatedTurnOverlap(
  snapshot: CanonicalConversationSnapshot,
  text: string,
): boolean {
  const queryTokens = meaningfulTokens(text);
  if (queryTokens.size === 0) return false;
  const imageIndexes = snapshot.priorMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) =>
      message.attachments.some((attachment) => attachment.kind === 'image'),
    );
  return imageIndexes.some((current, imageIndex) => {
    const nextIndex = imageIndexes[imageIndex + 1]?.index ?? snapshot.priorMessages.length;
    const associatedTokens = meaningfulTokens(
      snapshot.priorMessages
        .slice(current.index, nextIndex)
        .map((message) => message.text)
        .join(' '),
    );
    return hasTokenOverlap(queryTokens, associatedTokens);
  });
}

function hasTokenOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function meaningfulTokens(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'this', 'that', 'what', 'was', 'were', 'is', 'are', 'on', 'in', 'of', 'a', 'an',
    'read', 'price', 'cost', 'total', 'count', 'number', 'color', 'colour', 'code',
    'image', 'photo', 'picture', 'visible', 'shown',
  ]);
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function normalizedSemanticTerms(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).map(normalizeSemanticTerm),
  );
}

function normalizeSemanticTerm(term: string): string {
  const irregularPlural: Readonly<Record<string, string>> = {
    images: 'image',
    photos: 'photo',
    pictures: 'picture',
    screenshots: 'screenshot',
    receipts: 'receipt',
    labels: 'label',
    objects: 'object',
    documents: 'document',
  };
  if (irregularPlural[term] !== undefined) return irregularPlural[term];
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith('s') && term.length > 3) return term.slice(0, -1);
  return term;
}

function hasAnyTerm(terms: Set<string>, expected: Set<string>): boolean {
  for (const term of terms) {
    if (expected.has(term)) return true;
  }
  return false;
}

function countOrdinalReferences(text: string): number {
  const matches = text.toLowerCase().match(
    /\b(?:first|1st|one|second|2nd|two|third|3rd|three|fourth|4th|four|fifth|5th|five|last)\b/g,
  );
  return new Set(matches ?? []).size;
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
    two: 1,
    third: 2,
    '3rd': 2,
    three: 2,
    fourth: 3,
    '4th': 3,
    four: 3,
    fifth: 4,
    '5th': 4,
    five: 4,
    one: 0,
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
