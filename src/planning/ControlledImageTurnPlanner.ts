import type { ConversationFocusPlannerInput } from '../memory/ConversationStateLedger';
import type { ImageEntity } from '../persistence/ImageEntityRepository';
import type { StructuredImageEvidence } from '../persistence/StructuredImageEvidenceRepository';
import type { CanonicalConversationSnapshot } from '../types/models';

import type { PlannerActivationConfig } from './PlannerActivation';
import {
  TurnPlanner,
  type PlanningReferenceCandidate,
  type TurnPlannerResult,
} from './TurnPlanner';

const REFERENCE_WORDS = new Set([
  'it', 'its', 'they', 'them', 'their', 'those', 'these', 'both',
  'image', 'images', 'photo', 'photos', 'picture', 'pictures',
  'first', 'fiest', 'frist', 'second', 'third', 'fourth', 'fifth',
  'latest', 'last', 'previous', 'older', 'oldest', 'current',
]);
const SINGULAR_REFERENCE_WORDS = new Set(['it', 'its']);
const PLURAL_PAIR_WORDS = new Set(['both', 'them']);
const GENERIC_ALIAS_WORDS = new Set([
  'about', 'describe', 'image', 'images', 'list', 'photo', 'picture',
  'show', 'tell', 'this', 'visible', 'what', 'with',
]);
const COMPARISON_PATTERN =
  /\b(?:compare|comparison|contrast|difference|differences|different|differ|versus|vs)\b/i;
const EXPLICIT_PAIR_PATTERN =
  /\b(?:both|two|2)\s+(?:images?|photos?|pictures?)\b|\b(?:images?|photos?|pictures?)\s+(?:one|1)\s+(?:and|&)\s+(?:two|2)\b/i;

export interface ControlledPlanningImage {
  readonly entity: ImageEntity;
  readonly aliases: readonly string[];
  readonly evidence?: StructuredImageEvidence | null;
}

export interface ControlledImageTurnPlanningInput {
  readonly snapshot: CanonicalConversationSnapshot;
  readonly activation: PlannerActivationConfig;
  readonly images: readonly ControlledPlanningImage[];
  readonly activeComparisonImageIds?: readonly string[];
  readonly focusLedger?: ConversationFocusPlannerInput;
  readonly planner?: TurnPlanner;
}

export interface ControlledImageTurnPlanningResult {
  readonly scenarioClass: 'new-image' | 'image-follow-up' | 'image-comparison';
  readonly planning: TurnPlannerResult;
  readonly orderedImages: readonly ControlledPlanningImage[];
}

export function planControlledImageTurn(
  input: ControlledImageTurnPlanningInput,
): ControlledImageTurnPlanningResult | null {
  const orderedImages = [...input.images].sort(compareImages);
  const attached = orderedImages.filter(
    (image) => image.entity.sourceMessageId === input.snapshot.currentMessage.id,
  );
  const resolution = resolveRequestedImages(input, orderedImages, attached);
  if (resolution === null) return null;

  const referenceCandidates: PlanningReferenceCandidate[] = resolution.candidates.map(
    (candidate) => ({
      id: candidate.image.entity.id,
      targetType: 'image',
      match: candidate.selected ? 'exact' : 'active',
      materiallyPlausible: true,
      sourceMessageIds: [candidate.image.entity.sourceMessageId],
      assetAvailability: candidate.image.entity.assetAvailability,
    }),
  );
  referenceCandidates.push(...(resolution.unresolvedCandidateIds ?? []).map((id) => ({
    id,
    targetType: 'image' as const,
    match: 'active' as const,
    materiallyPlausible: true,
    sourceMessageIds: [],
    assetAvailability: 'missing' as const,
  })));
  const planner = input.planner ?? new TurnPlanner();
  const action =
    resolution.scenarioClass === 'image-comparison'
      ? 'compare'
      : resolution.scenarioClass === 'image-follow-up'
        && resolution.candidates.some(
          (candidate) => candidate.selected && candidate.image.evidence === null,
        )
        ? 'extract'
        : 'answer';
  const planning = planner.plan({
    turnId: input.snapshot.currentMessage.id,
    scenarioClass: resolution.scenarioClass,
    activation: input.activation,
    applicationState: {
      action,
      userText: input.snapshot.currentMessage.text,
      attachedImageIds: attached.map((image) => image.entity.id),
      availableImageIds: orderedImages
        .filter((image) => image.entity.assetAvailability === 'available')
        .map((image) => image.entity.id),
    },
    ledgerState: {
      activeTopicIds: [],
      activeEntities: [],
      activeComparisonTargetIds: [...(input.activeComparisonImageIds ?? [])],
      activeImageIds: orderedImages.map((image) => image.entity.id),
    },
    focusLedger: input.focusLedger,
    signals: {
      referenceCandidates,
      explicitMemoryCandidates: [],
      lexicalRetrievalCandidates: [],
      activeTopicMatches: [],
      activeEntityMatches: [],
      recentDependency: attached.length === 0,
      intent: resolution.scenarioClass === 'image-comparison' ? 'compare' : 'answer',
    },
  });
  return { scenarioClass: resolution.scenarioClass, planning, orderedImages };
}

interface RequestedImageCandidate {
  readonly image: ControlledPlanningImage;
  readonly selected: boolean;
}

interface RequestedImageResolution {
  readonly scenarioClass: ControlledImageTurnPlanningResult['scenarioClass'];
  readonly candidates: readonly RequestedImageCandidate[];
  readonly unresolvedCandidateIds?: readonly string[];
}

function resolveRequestedImages(
  input: ControlledImageTurnPlanningInput,
  ordered: readonly ControlledPlanningImage[],
  attached: readonly ControlledPlanningImage[],
): RequestedImageResolution | null {
  if (attached.length > 0) {
    return {
      scenarioClass: 'new-image',
      candidates: attached.map((image) => ({ image, selected: true })),
    };
  }
  if (ordered.length === 0) return null;

  const text = input.snapshot.currentMessage.text.toLowerCase();
  const tokens = new Set(text.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []);
  const explicit = explicitMatches(text, tokens, ordered);
  const comparisonRequested =
    COMPARISON_PATTERN.test(text)
    || tokens.has('both')
    || EXPLICIT_PAIR_PATTERN.test(text);
  const explicitPairRequested = EXPLICIT_PAIR_PATTERN.test(text);
  const pairReference = [...PLURAL_PAIR_WORDS].some((word) => tokens.has(word));
  const referenceRequested = comparisonRequested
    || [...REFERENCE_WORDS].some((word) => tokens.has(word))
    || explicit.length > 0;
  if (!referenceRequested) return null;

  if (comparisonRequested) {
    if (explicit.length > 2) {
      return ambiguousResolution('image-comparison', explicit);
    }
    const activePair = tokens.has('them')
      ? activePairFor(input.activeComparisonImageIds ?? [], ordered)
      : [];
    const selected = explicit.length === 2
      ? explicit
      : activePair.length === 2
        ? activePair
        : ordered.length === 2
          ? ordered
          : explicitPairRequested
            ? ordered.slice(-2)
            : [];
    return selected.length >= 2
      ? selectedResolution('image-comparison', selected)
      : ordered.length === 1
        ? incompleteComparisonResolution(ordered[0], input.snapshot.currentMessage.id)
        : ambiguousResolution('image-comparison', ordered);
  }

  if (pairReference && input.activeComparisonImageIds?.length === 2) {
    const pair = input.activeComparisonImageIds
      .map((id) => ordered.find((image) => image.entity.id === id))
      .filter((image): image is ControlledPlanningImage => image !== undefined);
    if (pair.length === 2) return selectedResolution('image-comparison', pair);
  }

  if (explicit.length === 1) return selectedResolution('image-follow-up', explicit);
  if (explicit.length > 1) return ambiguousResolution('image-follow-up', explicit);
  if (ordered.length === 1) return selectedResolution('image-follow-up', ordered);
  if ([...SINGULAR_REFERENCE_WORDS].some((word) => tokens.has(word))) {
    return ambiguousResolution('image-follow-up', ordered);
  }
  return ambiguousResolution('image-follow-up', ordered);
}

function incompleteComparisonResolution(
  available: ControlledPlanningImage,
  turnId: string,
): RequestedImageResolution {
  return {
    scenarioClass: 'image-comparison',
    candidates: [{ image: available, selected: false }],
    unresolvedCandidateIds: [`missing-comparison-side:${turnId}`],
  };
}

function activePairFor(
  activeIds: readonly string[],
  ordered: readonly ControlledPlanningImage[],
): ControlledPlanningImage[] {
  if (activeIds.length !== 2) return [];
  return activeIds
    .map((id) => ordered.find((image) => image.entity.id === id))
    .filter((image): image is ControlledPlanningImage => image !== undefined);
}

function explicitMatches(
  text: string,
  tokens: ReadonlySet<string>,
  ordered: readonly ControlledPlanningImage[],
): ControlledPlanningImage[] {
  const matches = new Map<string, ControlledPlanningImage>();
  for (const index of explicitOrdinalIndexes(text, ordered.length)) {
    const image = ordered[index];
    if (image !== undefined) matches.set(image.entity.id, image);
  }
  for (const image of ordered) {
    if (text.includes(image.entity.id.toLowerCase())) matches.set(image.entity.id, image);
    for (const alias of image.aliases) {
      const normalized = alias.toLowerCase().trim();
      if (
        normalized !== ''
        && (
          text.includes(normalized)
          || aliasTokens(normalized).some((token) => tokens.has(token))
        )
      ) {
        matches.set(image.entity.id, image);
      }
    }
  }
  return [...matches.values()].sort(compareImages);
}

function explicitOrdinalIndexes(text: string, imageCount: number): number[] {
  const indexes = new Set<number>();
  const ordinalFamilies: ReadonlyArray<readonly [number, RegExp]> = [
    [0, /\b(?:first|1st|fiest|frist)\b/i],
    [1, /\b(?:second|2nd)\b/i],
    [2, /\b(?:third|3rd)\b/i],
    [3, /\b(?:fourth|4th)\b/i],
    [4, /\b(?:fifth|5th)\b/i],
  ];
  for (const [index, pattern] of ordinalFamilies) {
    if (pattern.test(text)) indexes.add(index);
  }
  if (/\b(?:oldest|earliest)\s+(?:image|photo|picture)\b/i.test(text)) indexes.add(0);
  if (/\b(?:latest|last|current)\s+(?:image|photo|picture)\b/i.test(text)) {
    indexes.add(imageCount - 1);
  }
  if (/\b(?:previous|older)\s+(?:image|photo|picture)\b/i.test(text)) {
    indexes.add(imageCount - 2);
  }
  return [...indexes].filter((index) => index >= 0 && index < imageCount);
}

function aliasTokens(value: string): string[] {
  return (value.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .filter((token) => token.length >= 4 && !GENERIC_ALIAS_WORDS.has(token));
}

function selectedResolution(
  scenarioClass: RequestedImageResolution['scenarioClass'],
  images: readonly ControlledPlanningImage[],
): RequestedImageResolution {
  return { scenarioClass, candidates: images.map((image) => ({ image, selected: true })) };
}

function ambiguousResolution(
  scenarioClass: RequestedImageResolution['scenarioClass'],
  images: readonly ControlledPlanningImage[],
): RequestedImageResolution {
  return { scenarioClass, candidates: images.map((image) => ({ image, selected: false })) };
}

function compareImages(left: ControlledPlanningImage, right: ControlledPlanningImage): number {
  return left.entity.createdAt - right.entity.createdAt
    || left.entity.id.localeCompare(right.entity.id);
}
