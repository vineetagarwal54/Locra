describe('active model presentation metadata', () => {
  it('uses the selected model display name and integrity size', () => {
    jest.resetModules();
    jest.doMock('../../../src/model/ActiveModel', () => ({
      activeModel: {
        displayName: 'Gemma 4 E2B · Multimodal',
        integrityFallback: { expectedSize: 4_371_419_520 },
      },
    }));

    const presentation = require('../../../src/model/ModelPresentation') as typeof import('../../../src/model/ModelPresentation');

    expect(presentation.MODEL_DISPLAY_NAME).toBe('Gemma 4 E2B · Multimodal');
    expect(presentation.MODEL_TOTAL_BYTES).toBe(4_371_419_520);
    expect(presentation.MODEL_DOWNLOAD_SIZE_LABEL).toBe('4.1 GB');
    expect(presentation.MODEL_STORAGE_REQUIRED_BYTES).toBe(Math.round(4_371_419_520 * 1.12));
    expect(presentation.formatDownloadedOfTotal(1)).toBe('4.1 GB / 4.1 GB');
  });
});
