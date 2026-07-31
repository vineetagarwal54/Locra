import type { ConversationFocusPlannerInput } from '../memory/ConversationStateLedger';
import type { CanonicalConversationSnapshot } from '../types/models';

import type { ControlledPlanningImage } from './ControlledImageTurnPlanner';
import type { PlannerActivationConfig } from './PlannerActivation';
import {
  TurnPlanner,
  type PlanningAction,
  type PlanningReferenceCandidate,
  type TurnPlannerResult,
} from './TurnPlanner';

export type UniversalTurnAction = 'submit' | 'retry' | 'regenerate' | 'continue';

export interface UniversalTurnPlanningInput {
  readonly snapshot: CanonicalConversationSnapshot;
  readonly activation: PlannerActivationConfig;
  readonly images: readonly ControlledPlanningImage[];
  readonly focusLedger: ConversationFocusPlannerInput;
  readonly action: UniversalTurnAction;
  readonly planner?: TurnPlanner;
}

export interface UniversalTurnPlanningResult {
  readonly planning: TurnPlannerResult;
  readonly orderedImages: readonly ControlledPlanningImage[];
}

/**
 * Universal, non-semantic entry adapter. It exposes canonical application facts
 * and deterministic syntax candidates; TurnPlanner remains the only component
 * that resolves them into intent, references, modality, dependency, scenario,
 * and required context.
 */
export function planUniversalTurn(
  input: UniversalTurnPlanningInput,
): UniversalTurnPlanningResult {
  const orderedImages = withCurrentAttachment(input).sort(compareImages);
  const availableImages = orderedImages.filter(
    (image) => image.entity.assetAvailability === 'available',
  );
  const attachedImages = input.action === 'continue'
    ? []
    : availableImages.filter(
        (image) => image.entity.sourceMessageId === input.snapshot.currentMessage.id,
      );
  const referenceCandidates = deterministicReferenceCandidates(
    input,
    orderedImages,
    attachedImages,
  );
  const planner = input.planner ?? new TurnPlanner();
  const planning = planner.plan({
    turnId: input.snapshot.currentMessage.id,
    activation: input.activation,
    applicationState: {
      action: planningActionFor(input.action),
      userText: input.snapshot.currentMessage.text,
      attachedImageIds: attachedImages.map((image) => image.entity.id),
      availableImageIds: availableImages.map((image) => image.entity.id),
      directReferenceIds: referenceCandidates
        .filter((candidate) => candidate.match === 'direct')
        .map((candidate) => candidate.id),
      imageIdsWithEvidence: orderedImages
        .filter((image) => image.evidence !== null && image.evidence !== undefined)
        .map((image) => image.entity.id),
    },
    ledgerState: {
      activeTopicIds: input.focusLedger.activeTopicLabels.map(topicId),
      activeTopics: input.focusLedger.activeTopicLabels.map((label) => ({
        id: topicId(label),
        canonicalLabel: label,
        aliases: [],
      })),
      activeEntities: input.focusLedger.activeEntityLabels.map((label) => ({
        id: entityId(label),
        canonicalLabel: label,
        aliases: [],
      })),
      activeComparisonTargetIds:
        input.focusLedger.activeImageIds.length === 2
          ? [...input.focusLedger.activeImageIds]
          : [],
      activeImageIds: [...input.focusLedger.activeImageIds],
    },
    focusLedger: input.focusLedger,
    signals: {
      referenceCandidates,
      explicitMemoryCandidates: [],
      lexicalRetrievalCandidates: [],
      activeTopicMatches: [],
      activeEntityMatches: [],
    },
  });
  return { planning, orderedImages };
}

function withCurrentAttachment(
  input: UniversalTurnPlanningInput,
): ControlledPlanningImage[] {
  const images = [...input.images];
  if (
    input.action === 'continue'
    || images.some(
      (image) => image.entity.sourceMessageId === input.snapshot.currentMessage.id,
    )
  ) {
    return images;
  }
  const attachment = input.snapshot.currentMessage.attachments.find(
    (candidate) => candidate.kind === 'image',
  );
  if (attachment === undefined) return images;
  const id = attachment.imageAssetId ?? `message-image:${input.snapshot.currentMessage.id}`;
  images.push({
    entity: {
      id,
      conversationId: input.snapshot.conversationId,
      sourceMessageId: input.snapshot.currentMessage.id,
      ordinal: images.length,
      assetRevision: `attachment:${input.snapshot.currentMessage.id}`,
      assetAvailability: 'available',
      localAssetReference: attachment.path,
      evidenceIds: [],
      createdAt: input.snapshot.currentMessage.createdAt,
      updatedAt: input.snapshot.currentMessage.createdAt,
    },
    aliases: [],
    evidence: null,
  });
  return images;
}

function deterministicReferenceCandidates(
  input: UniversalTurnPlanningInput,
  orderedImages: readonly ControlledPlanningImage[],
  attachedImages: readonly ControlledPlanningImage[],
): PlanningReferenceCandidate[] {
  const text = normalize(input.snapshot.currentMessage.text);
  const candidates = new Map<string, PlanningReferenceCandidate>();
  for (const image of attachedImages) {
    addCandidate(candidates, imageCandidate(image, 'direct'));
  }
  for (const image of exactImageMatches(text, orderedImages)) {
    addCandidate(candidates, imageCandidate(image, 'direct'));
  }

  const comparison = isExplicitComparison(text);
  const activeImages = activeAvailableImages(input.focusLedger, orderedImages);
  if (comparison) {
    if (activeImages.length === 2) {
      for (const image of activeImages) {
        addCandidate(candidates, imageCandidate(image, 'exact'));
      }
    } else if (exactImageMatches(text, orderedImages).length < 2) {
      for (const image of activeImages) {
        addCandidate(candidates, imageCandidate(image, 'active'));
      }
      addCandidate(candidates, {
        id: `missing-comparison-side:${input.snapshot.currentMessage.id}`,
        targetType: 'image',
        match: 'active',
        materiallyPlausible: true,
        sourceMessageIds: [],
        assetAvailability: 'missing',
      });
    }
    return [...candidates.values()];
  }

  if (hasExplicitImageReference(text)) {
    if (candidates.size === 0) {
      addActiveImages(candidates, activeImages);
      addLedgerUnresolved(candidates, input.focusLedger, orderedImages);
    }
    return [...candidates.values()];
  }
  if (hasExactCodeReference(text) && input.focusLedger.activeArtifactMessageId !== null) {
    addCandidate(candidates, {
      id: input.focusLedger.activeArtifactMessageId,
      targetType: input.focusLedger.activeArtifactKind ?? 'code',
      match: 'exact',
      materiallyPlausible: true,
      sourceMessageIds: [input.focusLedger.activeArtifactMessageId],
    });
    return [...candidates.values()];
  }
  if (hasExactDocumentReference(text) && input.focusLedger.activeArtifactMessageId !== null) {
    addCandidate(candidates, {
      id: input.focusLedger.activeArtifactMessageId,
      targetType: input.focusLedger.activeArtifactKind ?? 'document',
      match: 'exact',
      materiallyPlausible: true,
      sourceMessageIds: [input.focusLedger.activeArtifactMessageId],
    });
    return [...candidates.values()];
  }
  if (hasFocusPronoun(text)) {
    if (input.focusLedger.unresolvedReference !== null) {
      addLedgerUnresolved(candidates, input.focusLedger, orderedImages);
    } else if (activeImages.length > 0) {
      addActiveImages(candidates, activeImages);
    } else if (input.focusLedger.activeArtifactMessageId !== null) {
      addCandidate(candidates, {
        id: input.focusLedger.activeArtifactMessageId,
        targetType: input.focusLedger.activeArtifactKind ?? 'code',
        match: 'exact',
        materiallyPlausible: true,
        sourceMessageIds: [input.focusLedger.activeArtifactMessageId],
      });
    } else if (input.focusLedger.activeAssistantMessageId !== null) {
      addCandidate(candidates, {
        id: input.focusLedger.activeAssistantMessageId,
        targetType: 'message',
        match: 'exact',
        materiallyPlausible: true,
        sourceMessageIds: [input.focusLedger.activeAssistantMessageId],
      });
    }
  }
  return [...candidates.values()];
}

function exactImageMatches(
  text: string,
  images: readonly ControlledPlanningImage[],
): ControlledPlanningImage[] {
  const matches = new Map<string, ControlledPlanningImage>();
  for (const image of images) {
    if (text.includes(image.entity.id.toLowerCase())) {
      matches.set(image.entity.id, image);
    }
  }
  for (const index of explicitOrdinalIndexes(text, images.length)) {
    const image = images[index];
    if (image !== undefined) matches.set(image.entity.id, image);
  }
  return [...matches.values()].sort(compareImages);
}

function explicitOrdinalIndexes(text: string, imageCount: number): number[] {
  const indexes = new Set<number>();
  const ordinals: ReadonlyArray<readonly [number, string]> = [
    [0, 'first'],
    [0, '1st'],
    [1, 'second'],
    [1, '2nd'],
    [2, 'third'],
    [2, '3rd'],
    [3, 'fourth'],
    [3, '4th'],
    [4, 'fifth'],
    [4, '5th'],
  ];
  for (const [index, ordinal] of ordinals) {
    if (hasToken(text, ordinal)) indexes.add(index);
  }
  if (text.includes('oldest image') || text.includes('earliest image')) indexes.add(0);
  if (text.includes('latest image') || text.includes('last image')
    || text.includes('current image')) {
    indexes.add(imageCount - 1);
  }
  if (text.includes('previous image') || text.includes('older image')) {
    indexes.add(imageCount - 2);
  }
  return [...indexes].filter((index) => index >= 0 && index < imageCount);
}

function addActiveImages(
  candidates: Map<string, PlanningReferenceCandidate>,
  images: readonly ControlledPlanningImage[],
): void {
  for (const image of images) addCandidate(candidates, imageCandidate(image, 'exact'));
}

function addLedgerUnresolved(
  candidates: Map<string, PlanningReferenceCandidate>,
  ledger: ConversationFocusPlannerInput,
  images: readonly ControlledPlanningImage[],
): void {
  const unresolved = ledger.unresolvedReference;
  if (unresolved === null) return;
  for (const imageId of unresolved.candidateIds) {
    const image = images.find((candidate) => candidate.entity.id === imageId);
    if (image !== undefined) addCandidate(candidates, imageCandidate(image, 'active'));
  }
}

function activeAvailableImages(
  ledger: ConversationFocusPlannerInput,
  images: readonly ControlledPlanningImage[],
): ControlledPlanningImage[] {
  return ledger.activeImageIds.map(
    (imageId) => images.find(
      (image) =>
        image.entity.id === imageId
        && image.entity.assetAvailability === 'available',
    ),
  ).filter((image): image is ControlledPlanningImage => image !== undefined);
}

function imageCandidate(
  image: ControlledPlanningImage,
  match: PlanningReferenceCandidate['match'],
): PlanningReferenceCandidate {
  return {
    id: image.entity.id,
    targetType: 'image',
    match,
    materiallyPlausible: true,
    sourceMessageIds: [image.entity.sourceMessageId],
    assetAvailability: image.entity.assetAvailability,
  };
}

function addCandidate(
  candidates: Map<string, PlanningReferenceCandidate>,
  candidate: PlanningReferenceCandidate,
): void {
  candidates.set(`${candidate.targetType}:${candidate.id}`, candidate);
}

function planningActionFor(action: UniversalTurnAction): PlanningAction {
  return action === 'submit' ? 'none' : action;
}

function isExplicitComparison(text: string): boolean {
  return text === 'compare'
    || text.startsWith('compare ')
    || text.includes(' both images')
    || text.startsWith('both images')
    || text.includes(' the two images')
    || text.startsWith('the two images');
}

function hasExplicitImageReference(text: string): boolean {
  return [
    'image', 'images', 'photo', 'photos', 'picture', 'pictures',
  ].some((token) => hasToken(text, token));
}

function hasExactCodeReference(text: string): boolean {
  return text.includes('the code you gave')
    || text.includes('that code')
    || text.includes('this code');
}

function hasExactDocumentReference(text: string): boolean {
  return text.includes('the document you gave')
    || text.includes('that document')
    || text.includes('this document');
}

function hasFocusPronoun(text: string): boolean {
  return ['it', 'its', 'that', 'this', 'them', 'they', 'their', 'those', 'one', 'each']
    .some((token) => hasToken(text, token));
}

function hasToken(text: string, token: string): boolean {
  return ` ${text} `.includes(` ${token} `);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9:_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function topicId(label: string): string {
  return `topic:${label}`;
}

function entityId(label: string): string {
  return `entity:${label}`;
}

function compareImages(
  left: ControlledPlanningImage,
  right: ControlledPlanningImage,
): number {
  return left.entity.createdAt - right.entity.createdAt
    || left.entity.id.localeCompare(right.entity.id);
}
