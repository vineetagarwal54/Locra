import type { ImageEntity } from '../persistence/ImageEntityRepository';
import type { StructuredImageEvidence } from '../persistence/StructuredImageEvidenceRepository';
import type { TurnPlan } from '../planning/types';
import type {
  CanonicalConversationContext,
  ContextMediaEvidence,
} from '../types/models';

import { composeMultiImageEvidence } from './MultiImageEvidenceComposer';

export interface ControlledImageContextSource {
  readonly image: ImageEntity;
  readonly evidence: StructuredImageEvidence | null;
}

export function assembleControlledImageContext(
  plan: TurnPlan,
  sources: readonly ControlledImageContextSource[],
): CanonicalConversationContext {
  const byId = new Map(sources.map((source) => [source.image.id, source]));
  const ordered = plan.vision.imageReferenceIds.map((imageId) => byId.get(imageId) ?? null);
  const mediaEvidence = plan.vision.strategy === 'compare-evidence'
    ? composeMultiImageEvidence(ordered.map((source, index) => ({
        imageAssetId: plan.vision.imageReferenceIds[index],
        sourceMessageId: source?.image.sourceMessageId ?? `missing:${index}`,
        evidence: source?.evidence === null
          || source === null
          || source.image.assetAvailability !== 'available'
          ? null
          : toContextEvidence(source.image, source.evidence),
      }))).items
    : ordered.flatMap((source) =>
        source?.evidence === null || source === null
          ? []
          : [toContextEvidence(source.image, source.evidence)],
      );
  const usedUnits = mediaEvidence.reduce(
    (total, evidence) => total + evidence.summary.length
      + evidence.facts.reduce((sum, fact) => sum + fact.length, 0)
      + evidence.extractedText.reduce((sum, text) => sum + text.length, 0),
    0,
  );
  return {
    version: 'canonical-conversation-v2',
    recentTurns: [],
    mediaEvidence,
    importantFacts: [],
    olderSummary: null,
    budget: {
      policyId: 'controlled-image-plan-v1',
      maximumUnits: usedUnits,
      usedUnits,
    },
  };
}

function toContextEvidence(
  image: ImageEntity,
  evidence: StructuredImageEvidence,
): ContextMediaEvidence {
  return {
    version: 'context-media-evidence-v1',
    id: evidence.id,
    sourceMessageId: image.sourceMessageId,
    modality: 'image',
    sourcePath: image.id,
    summary: evidence.summary,
    facts: [
      ...evidence.visibleObjects.map((object) =>
        [object.label, ...object.attributes].filter((value) => value !== '').join(': '),
      ),
      ...evidence.numericValues.map((value) => value.rawText),
    ],
    extractedText: evidence.extractedText.map((span) => span.text),
    uncertainty: [...evidence.uncertainty.notes],
    createdAt: evidence.createdAt,
  };
}
