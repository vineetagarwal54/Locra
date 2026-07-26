import {
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
