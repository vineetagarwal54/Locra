import type { CanonicalConversationContext } from '../types/models';

import type { HiddenVisualEvidence } from './OutputPipelineTypes';

export type GroundingSourceKind =
  | 'stored-image-evidence'
  | 'fresh-image-evidence'
  | 'same-chat-retrieval'
  | 'cross-chat-retrieval';

export interface GroundingSource {
  readonly kind: GroundingSourceKind;
  readonly sourceId: string;
  readonly conversationId: string | null;
  readonly messageId: string | null;
  readonly imageAssetId: string | null;
  readonly content: string;
}

export interface GroundingSourceSet {
  readonly version: 'grounding-source-set-v1';
  readonly sources: readonly GroundingSource[];
}

export function createGroundingSourceSet(
  context: CanonicalConversationContext,
  freshEvidence: HiddenVisualEvidence | null,
  currentConversationId: string | null,
): GroundingSourceSet {
  const stored: GroundingSource[] = context.mediaEvidence.map((evidence) => ({
    kind: 'stored-image-evidence',
    sourceId: evidence.id,
    conversationId: currentConversationId,
    messageId: evidence.sourceMessageId,
    imageAssetId: evidence.sourcePath,
    content: [
      evidence.summary,
      ...evidence.facts,
      ...evidence.extractedText,
      ...evidence.uncertainty,
    ].join(' '),
  }));
  const retrieved: GroundingSource[] = context.importantFacts
    .filter((fact) => fact.id.startsWith('retrieved:'))
    .map((fact) => {
      const conversationId = fact.id.split(':')[1] ?? null;
      return {
        kind: conversationId === currentConversationId
          ? 'same-chat-retrieval'
          : 'cross-chat-retrieval',
        sourceId: fact.id,
        conversationId,
        messageId: fact.sourceMessageId,
        imageAssetId: null,
        content: fact.text,
      };
    });
  const fresh: GroundingSource[] = freshEvidence === null
    ? []
    : [{
        kind: 'fresh-image-evidence',
        sourceId: `fresh:${freshEvidence.createdAt}`,
        conversationId: currentConversationId,
        messageId: null,
        imageAssetId: freshEvidence.imagePath,
        content: [
          freshEvidence.subjectObject,
          ...freshEvidence.visibleFeatures,
          ...freshEvidence.visibleText,
          freshEvidence.visibleCondition,
          ...freshEvidence.uncertainty,
        ].join(' '),
      }];
  return {
    version: 'grounding-source-set-v1',
    sources: [...stored, ...fresh, ...retrieved].map((source) => ({ ...source })),
  };
}
