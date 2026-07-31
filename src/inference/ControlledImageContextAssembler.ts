import type { ImageEntity } from '../persistence/ImageEntityRepository';
import type { StructuredImageEvidence } from '../persistence/StructuredImageEvidenceRepository';
import type { TurnPlan } from '../planning/types';
import type {
  CanonicalConversationContext,
  CanonicalConversationSnapshot,
  CanonicalContextTurn,
  ConversationMessage,
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

export function assemblePlannedTurnContext(
  plan: TurnPlan,
  snapshot: CanonicalConversationSnapshot,
  sources: readonly ControlledImageContextSource[],
): CanonicalConversationContext {
  const imageContext = assembleControlledImageContext(plan, sources);
  const recentTurns = plannedRecentTurns(plan, snapshot);
  const recentUnits = recentTurns.reduce(
    (total, turn) => total + turn.question.length + (turn.answer?.length ?? 0),
    0,
  );
  return {
    ...imageContext,
    recentTurns,
    budget: {
      policyId: 'authoritative-turn-plan-v1',
      maximumUnits: imageContext.budget.usedUnits + recentUnits,
      usedUnits: imageContext.budget.usedUnits + recentUnits,
    },
  };
}

function plannedRecentTurns(
  plan: TurnPlan,
  snapshot: CanonicalConversationSnapshot,
): CanonicalContextTurn[] {
  const requiredMessageIds = new Set(
    plan.requiredContextSources
      .filter((source) =>
        source.sourceType === 'recent-turn'
        || source.sourceType === 'code'
        || source.sourceType === 'document',
      )
      .flatMap((source) => [source.sourceId, ...source.sourceMessageIds]),
  );
  const messages = snapshot.priorMessages;
  const selected = new Map<string, CanonicalContextTurn>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined || !requiredMessageIds.has(message.id)) continue;
    const pair = pairFor(messages, index);
    if (pair !== null) selected.set(pair.key, pair.turn);
  }
  return [...selected.values()];
}

function pairFor(
  messages: readonly ConversationMessage[],
  index: number,
): { readonly key: string; readonly turn: CanonicalContextTurn } | null {
  const message = messages[index];
  if (message === undefined) return null;
  if (message.role === 'user') {
    const assistant = messages.slice(index + 1).find(
      (candidate) => candidate.role === 'assistant' && candidate.status === 'completed',
    );
    return {
      key: message.id,
      turn: { question: message.text, answer: assistant?.text ?? null },
    };
  }
  for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
    const user = messages[userIndex];
    if (user?.role === 'user') {
      return {
        key: user.id,
        turn: { question: user.text, answer: message.text },
      };
    }
  }
  return null;
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
