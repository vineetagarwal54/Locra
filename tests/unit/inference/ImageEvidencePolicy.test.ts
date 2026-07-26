import { evaluateImageEvidenceAvailability } from '../../../src/inference/ImageEvidencePolicy';

describe('evaluateImageEvidenceAvailability', () => {
  it.each([
    {
      assetAvailable: true,
      hasEvidence: true,
      pixelDependent: true,
      expected: 'use-original',
    },
    {
      assetAvailable: true,
      hasEvidence: false,
      pixelDependent: true,
      expected: 'use-original',
    },
    {
      assetAvailable: false,
      hasEvidence: true,
      pixelDependent: true,
      expected: 'original-unavailable',
    },
    {
      assetAvailable: false,
      hasEvidence: false,
      pixelDependent: true,
      expected: 'original-unavailable',
    },
    {
      assetAvailable: true,
      hasEvidence: true,
      pixelDependent: false,
      expected: 'use-evidence',
    },
    {
      assetAvailable: true,
      hasEvidence: false,
      pixelDependent: false,
      expected: 'use-original',
    },
    {
      assetAvailable: false,
      hasEvidence: true,
      pixelDependent: false,
      expected: 'use-evidence',
    },
    {
      assetAvailable: false,
      hasEvidence: false,
      pixelDependent: false,
      expected: 'evidence-unavailable',
    },
  ])(
    'returns $expected for asset=$assetAvailable evidence=$hasEvidence pixel=$pixelDependent',
    ({ expected, ...input }) => {
      expect(evaluateImageEvidenceAvailability(input)).toEqual({ kind: expected });
    },
  );
});
