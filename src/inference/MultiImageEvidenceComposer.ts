import type { ContextMediaEvidence } from '../types/models';

export interface MultiImageEvidenceInput {
  readonly imageAssetId: string;
  readonly sourceMessageId: string;
  readonly evidence: ContextMediaEvidence | null;
}

export interface MultiImageEvidenceComposition {
  readonly items: readonly ContextMediaEvidence[];
  readonly complete: boolean;
  readonly missingImageAssetIds: readonly string[];
}

export function composeMultiImageEvidence(
  inputs: readonly MultiImageEvidenceInput[],
): MultiImageEvidenceComposition {
  const missingImageAssetIds = inputs
    .filter((input) => input.evidence === null)
    .map((input) => input.imageAssetId);
  const items = inputs.map((input, index) => {
    const label = imageLabel(index);
    if (input.evidence === null) {
      return {
        version: 'context-media-evidence-v1' as const,
        id: `comparison-missing:${input.imageAssetId}`,
        sourceMessageId: input.sourceMessageId,
        modality: 'image' as const,
        sourcePath: input.imageAssetId,
        summary:
          `${label} is insufficient. Do not infer unsupported attributes for this image.`,
        facts: [],
        extractedText: [],
        uncertainty: ['Comparison is incomplete for this image.'],
        createdAt: 0,
      };
    }
    return {
      ...input.evidence,
      summary: `${label}:\n${input.evidence.summary}`,
      facts: [...input.evidence.facts],
      extractedText: [...input.evidence.extractedText],
      uncertainty: [...input.evidence.uncertainty],
    };
  });
  return {
    items,
    complete: missingImageAssetIds.length === 0,
    missingImageAssetIds,
  };
}

function imageLabel(index: number): string {
  return `Image ${String.fromCharCode(65 + index)} evidence`;
}
