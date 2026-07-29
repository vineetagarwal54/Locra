import {
  resolveImageReferences,
  type ImageReferenceCandidate,
} from '../../../src/inference/ImageReferenceResolver';

function candidate(
  id: string,
  searchText: string,
  available = true,
): ImageReferenceCandidate {
  return {
    imageAssetId: id,
    sourceMessageId: `message-${id}`,
    localPath: `/images/${id}.jpg`,
    available,
    createdAt: id.charCodeAt(0),
    searchText,
  };
}

describe('Wave B image reference resolution', () => {
  const images = [
    candidate('a', 'red apples market stall'),
    candidate('b', 'blue bicycle by a tree'),
  ];

  it('resolves a semantically active visual follow-up only when no other candidate matches', () => {
    const result = resolveImageReferences('What are their prices?', images, {
      activeImageId: 'a',
      activeVisualReference: true,
    });

    expect(result).toEqual({
      kind: 'active',
      references: [expect.objectContaining({ imageAssetId: 'a' })],
      ambiguousCandidateIds: [],
    });
  });

  it('resolves an explicitly older image without selecting the active image', () => {
    const result = resolveImageReferences('Inspect the first image again', images, {
      activeImageId: 'b',
    });

    expect(result.kind).toBe('single');
    expect(result.references.map((reference) => reference.imageAssetId)).toEqual(['a']);
  });

  it('leaves multiple plausible candidates unresolved with no selected pixels or evidence', () => {
    const result = resolveImageReferences('Inspect the item again', [
      candidate('a', 'market item'),
      candidate('b', 'store item'),
    ], {
      activeImageId: 'b',
    });

    expect(result.kind).toBe('ambiguous');
    expect(result.references).toEqual([]);
    expect(result.ambiguousCandidateIds).toEqual(['a', 'b']);
  });

  it('does not use refusal-like assistant prose to resolve a fresh inspection', () => {
    const result = resolveImageReferences('Inspect the receipt again', [
      {
        ...candidate('a', ''),
        assistantAnswer: 'I cannot inspect the receipt because the image is unavailable.',
      },
      candidate('b', 'wood chair'),
    ], {
      activeImageId: 'a',
    });

    expect(result).toEqual({
      kind: 'none',
      references: [],
      ambiguousCandidateIds: [],
    });
  });

  it('retains the selected image identity when its asset is missing', () => {
    const result = resolveImageReferences('Read the first image', [
      candidate('a', 'receipt', false),
      candidate('b', 'chair'),
    ], {
      activeImageId: 'b',
    });

    expect(result.references).toEqual([
      expect.objectContaining({ imageAssetId: 'a', available: false }),
    ]);
  });
});
