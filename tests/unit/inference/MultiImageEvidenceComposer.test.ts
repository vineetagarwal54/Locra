import {
  composeMultiImageEvidence,
} from '../../../src/inference/MultiImageEvidenceComposer';
import type { ContextMediaEvidence } from '../../../src/types/models';

function evidence(id: string, text: string): ContextMediaEvidence {
  return {
    version: 'context-media-evidence-v1',
    id,
    sourceMessageId: `message-${id}`,
    modality: 'image',
    sourcePath: id,
    summary: text,
    facts: [],
    extractedText: [],
    uncertainty: [],
    createdAt: 1,
  };
}

describe('composeMultiImageEvidence', () => {
  it('labels each image independently and exposes insufficient evidence', () => {
    const result = composeMultiImageEvidence([
      { imageAssetId: 'asset-a', sourceMessageId: 'message-a', evidence: evidence('a', 'round item') },
      { imageAssetId: 'asset-b', sourceMessageId: 'message-b', evidence: null },
    ]);

    expect(result.items[0].summary).toContain('Image A evidence');
    expect(result.items[0].summary).toContain('Source: first referenced image');
    expect(result.items[0].summary).toContain('asset asset-a');
    expect(result.items[1].summary).toContain('Image B evidence');
    expect(result.items[1].summary).toContain('Evidence is insufficient');
    expect(result.complete).toBe(false);
    expect(result.missingImageAssetIds).toEqual(['asset-b']);
  });
});
