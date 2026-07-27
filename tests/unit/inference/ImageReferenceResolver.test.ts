import {
  resolveImageReferences,
  resolveDescriptiveImageReference,
  type ImageReferenceCandidate,
} from '../../../src/inference/ImageReferenceResolver';

function candidate(
  imageAssetId: string,
  searchText: string,
): ImageReferenceCandidate {
  return {
    imageAssetId,
    sourceMessageId: `message-${imageAssetId}`,
    localPath: `/images/${imageAssetId}.jpg`,
    available: true,
    createdAt: 1,
    searchText,
  };
}

describe('resolveDescriptiveImageReference', () => {
  it('returns the uniquely strongest evidence-backed match', () => {
    const result = resolveDescriptiveImageReference(
      'What was written on the receipt?',
      [
        candidate('receipt', 'shopping receipt Total $12.00'),
        candidate('chair', 'wooden chair near a window'),
      ],
    );

    expect(result).toEqual({ kind: 'unique', candidate: expect.objectContaining({
      imageAssetId: 'receipt',
    }) });
  });

  it('treats tied matches as ambiguous', () => {
    const result = resolveDescriptiveImageReference(
      'Show me the chair image again',
      [
        candidate('chair-a', 'wooden chair'),
        candidate('chair-b', 'metal chair'),
      ],
    );

    expect(result).toEqual({ kind: 'ambiguous' });
  });

  it('treats generic weak matches as ambiguous', () => {
    const result = resolveDescriptiveImageReference(
      'What was on the paper?',
      [
        candidate('receipt', 'paper receipt'),
        candidate('label', 'paper product label'),
      ],
    );

    expect(result).toEqual({ kind: 'ambiguous' });
  });

  it('returns none when no candidate matches', () => {
    const result = resolveDescriptiveImageReference(
      'Show me the bicycle image again',
      [
        candidate('receipt', 'shopping receipt'),
        candidate('chair', 'wooden chair'),
      ],
    );

    expect(result).toEqual({ kind: 'none' });
  });

  it('uses extracted text and assistant descriptions supplied by the caller', () => {
    const result = resolveDescriptiveImageReference(
      'What price was on the product label?',
      [
        candidate('label', 'Assistant: a product label. Extracted text: PRICE $19.95'),
        candidate('chair', 'Assistant: a chair. No visible text.'),
      ],
    );

    expect(result).toEqual({ kind: 'unique', candidate: expect.objectContaining({
      imageAssetId: 'label',
    }) });
  });
});

describe('resolveImageReferences', () => {
  const candidates = [
    candidate('alpha', 'red bicycle near a wall'),
    candidate('beta', 'blue bicycle beside a tree'),
    candidate('gamma', 'paper form with typed text'),
  ];

  it.each([
    ['Compare the first and third images', ['alpha', 'gamma']],
    ['What differs between image one and image three?', ['alpha', 'gamma']],
  ])('resolves multiple ordinal references in "%s"', (query, ids) => {
    const result = resolveImageReferences(query, candidates, { activeImageId: 'gamma' });
    expect(result.kind).toBe('multiple');
    expect(result.references.map((item) => item.imageAssetId)).toEqual(ids);
  });

  it('keeps weak descriptive references ambiguous instead of choosing by recency', () => {
    const result = resolveImageReferences(
      'Compare the bicycle pictures',
      candidates,
      { activeImageId: 'gamma', expectsMultiple: true },
    );
    expect(result.kind).toBe('ambiguous');
    expect(result.ambiguousCandidateIds).toEqual(['alpha', 'beta']);
  });

  it('reports a uniquely resolved missing original without substituting another image', () => {
    const unavailable = { ...candidate('serial', 'device serial plate'), available: false };
    const result = resolveImageReferences(
      'Read the serial plate photo',
      [unavailable, candidate('chair', 'wood chair')],
      { activeImageId: 'chair' },
    );
    expect(result).toEqual(expect.objectContaining({
      kind: 'single',
      references: [expect.objectContaining({ imageAssetId: 'serial', available: false })],
    }));
  });
});
