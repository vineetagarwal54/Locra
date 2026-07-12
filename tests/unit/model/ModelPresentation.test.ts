import type { ModelCandidate } from '../../../src/model/ActiveModel';
import { createModelPresentation } from '../../../src/model/ModelPresentation';

describe('selected model presentation metadata', () => {
  it('uses the supplied descriptor display name and integrity size', () => {
    const model = {
      displayName: 'Gemma 4 E2B Multimodal',
      integrityFallback: { expectedSize: 4_371_419_520 },
    } as ModelCandidate;

    const presentation = createModelPresentation(model);

    expect(presentation.displayName).toBe('Gemma 4 E2B Multimodal');
    expect(presentation.downloadSizeLabel).toBe('4.1 GB');
    expect(presentation.storageRequiredBytes).toBe(Math.round(4_371_419_520 * 1.12));
    expect(presentation.formatDownloadedOfTotal(1)).toBe('4.1 GB / 4.1 GB');
  });
});
