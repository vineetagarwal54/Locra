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
]);
const SINGULAR_REFERENCE_WORDS = new Set(['it', 'its']);
const PLURAL_PAIR_WORDS = new Set(['both', 'them']);

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
  const planning = planner.plan({
    turnId: input.snapshot.currentMessage.id,
    scenarioClass: resolution.scenarioClass,
    activation: input.activation,
    applicationState: {
      action: resolution.scenarioClass === 'image-comparison' ? 'compare' : 'answer',
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
  const comparisonRequested = tokens.has('compare') || tokens.has('both');
  const pairReference = [...PLURAL_PAIR_WORDS].some((word) => tokens.has(word));
  const referenceRequested = comparisonRequested
    || [...REFERENCE_WORDS].some((word) => tokens.has(word))
    || explicit.length > 0;
  if (!referenceRequested) return null;

  if (comparisonRequested) {
    const activePair = tokens.has('them')
      ? activePairFor(input.activeComparisonImageIds ?? [], ordered)
      : [];
    const selected = explicit.length >= 2
      ? explicit
      : activePair.length === 2
        ? activePair
        : ordered.length === 2
          ? ordered
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
  if (tokens.has('first') && ordered[0] !== undefined) matches.set(ordered[0].entity.id, ordered[0]);
  if (tokens.has('second') && ordered[1] !== undefined) matches.set(ordered[1].entity.id, ordered[1]);
  for (const image of ordered) {
    if (text.includes(image.entity.id.toLowerCase())) matches.set(image.entity.id, image);
    for (const alias of image.aliases) {
      const normalized = alias.toLowerCase().trim();
      if (normalized !== '' && text.includes(normalized)) matches.set(image.entity.id, image);
    }
  }
  return [...matches.values()].sort(compareImages);
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
