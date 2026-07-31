import {
  VisionExecutor,
  type VisionExecutorSources,
} from '../../../src/inference/VisionExecutor';
import type { VisionExecutionPlan } from '../../../src/planning/types';

function plan(
  strategy: VisionExecutionPlan['strategy'],
  imageReferenceIds: readonly string[] = [],
): VisionExecutionPlan {
  return { strategy, imageReferenceIds, evidenceIds: [] };
}

function sources(): VisionExecutorSources {
  return {
    getImage: jest.fn((imageId: string) => ({
      id: imageId,
      conversationId: 'conversation-1',
      sourceMessageId: `message-${imageId}`,
      ordinal: 0,
      assetRevision: 'asset-v1',
      assetAvailability: 'available' as const,
      localAssetReference: `/images/${imageId}.jpg`,
      evidenceIds: [`evidence-${imageId}`],
      createdAt: 1,
      updatedAt: 1,
    })),
    getEvidence: jest.fn((imageId: string) => ({
      id: `evidence-${imageId}`,
      conversationId: 'conversation-1',
      imageId,
      sourceMessageIds: [`message-${imageId}`],
      summary: `summary-${imageId}`,
      visibleObjects: [],
      extractedText: [],
      numericValues: [],
      uncertainty: { overallConfidence: 1, notes: [] },
      status: 'complete' as const,
      sourceRevision: 'asset-v1',
      createdAt: 1,
      updatedAt: 1,
    })),
  };
}

describe('VisionExecutor', () => {
  it.each([
    ['none', [], 'not-produced'],
    ['reuse-evidence', ['image-a'], 'reused'],
    ['inspect-original', ['image-a'], 'freshly-inspected'],
    ['inspect-and-structure', ['image-a'], 'freshly-structured'],
    ['compare-evidence', ['image-a', 'image-b'], 'reused'],
  ] as const)('executes the authoritative %s strategy without replanning', (
    strategy,
    imageIds,
    evidenceAction,
  ) => {
    const executor = new VisionExecutor(sources());
    const requested = plan(strategy, imageIds);
    const result = executor.execute(requested, new AbortController().signal);

    expect(result.strategy).toBe(strategy);
    expect(result.evidenceAction).toBe(evidenceAction);
    expect(result.replanned).toBe(false);
  });

  it('fails safely when provider capability is missing', () => {
    const executor = new VisionExecutor(sources(), {
      supportsImageInput: false,
      supportsStructuredExtraction: false,
    });

    const result = executor.execute(
      plan('inspect-and-structure', ['image-a']),
      new AbortController().signal,
    );

    expect(result.status).toBe('capability-unavailable');
    expect(result.imageInputs).toEqual([]);
  });

  it.each(['missing', 'deleted', 'unsupported'] as const)(
    'does not substitute another image when the planned asset is %s',
    (assetAvailability) => {
      const source = sources();
      source.getImage = () => ({
        id: 'image-a',
        conversationId: 'conversation-1',
        sourceMessageId: 'message-a',
        ordinal: 0,
        assetRevision: 'asset-v1',
        assetAvailability,
        localAssetReference: '/images/a.jpg',
        evidenceIds: ['evidence-a'],
        createdAt: 1,
        updatedAt: 1,
      });
      const result = new VisionExecutor(source).execute(
        plan('inspect-original', ['image-a']),
        new AbortController().signal,
      );

      expect(result.status).toBe('asset-unavailable');
      expect(result.missingImageIds).toEqual(['image-a']);
      expect(result.imageInputs).toEqual([]);
    },
  );

  it('preserves separate comparison sides and reports one missing side', () => {
    const source = sources();
    const originalGetImage = source.getImage;
    const originalGetEvidence = source.getEvidence;
    source.getImage = (imageId) =>
      imageId === 'image-b'
        ? {
            id: imageId,
            conversationId: 'conversation-1',
            sourceMessageId: 'message-b',
            ordinal: 0,
            assetRevision: 'asset-v1',
            assetAvailability: 'missing',
            localAssetReference: '/images/b.jpg',
            evidenceIds: [],
            createdAt: 1,
            updatedAt: 1,
          }
        : originalGetImage(imageId);
    source.getEvidence = (imageId) =>
      imageId === 'image-b' ? null : originalGetEvidence(imageId);

    const result = new VisionExecutor(source).execute(
      plan('compare-evidence', ['image-a', 'image-b']),
      new AbortController().signal,
    );

    expect(result.status).toBe('partial');
    expect(result.imageInputs).toEqual([
      expect.objectContaining({ imageId: 'image-a' }),
    ]);
    expect(result.missingImageIds).toEqual(['image-b']);
    expect(result.failureReason).toBe('comparison-side-unavailable:image-b');
  });

  it('reports a missing comparison asset even when stale retained evidence exists', () => {
    const source = sources();
    const originalGetImage = source.getImage;
    source.getImage = (imageId) => imageId === 'image-b'
      ? {
          ...originalGetImage(imageId),
          id: imageId,
          assetAvailability: 'missing',
        } as NonNullable<ReturnType<typeof originalGetImage>>
      : originalGetImage(imageId);

    const result = new VisionExecutor(source).execute(
      plan('compare-evidence', ['image-a', 'image-b']),
      new AbortController().signal,
    );

    expect(result.status).toBe('partial');
    expect(result.imageInputs.map((input) => input.imageId)).toEqual(['image-a']);
    expect(result.missingImageIds).toEqual(['image-b']);
  });

  it('reinspects the same selected image when complete evidence cannot answer OCR', () => {
    const source = sources();
    const result = new VisionExecutor(source).execute(
      plan('reuse-evidence', ['image-a']),
      new AbortController().signal,
      { question: 'Read the visible text.' },
    );

    expect(result.imageInputs).toEqual([
      expect.objectContaining({
        imageId: 'image-a',
        localAssetReference: '/images/image-a.jpg',
        evidence: null,
      }),
    ]);
    expect(result.pixelInspectionImageIds).toEqual(['image-a']);
    expect(result.requiresStructuredExtraction).toBe(true);
    expect(result.imageDiagnostics).toEqual([
      expect.objectContaining({
        imageId: 'image-a',
        evidenceStatus: 'complete',
        sufficiencyResult: 'insufficient',
        sufficiencyReason: 'readable-text-missing',
        action: 'pixel-inspection',
      }),
    ]);
    expect(source.getImage).toHaveBeenCalledWith('image-a');
    expect(source.getImage).not.toHaveBeenCalledWith(expect.stringMatching(/other|active/));
  });

  it('reuses complete evidence when it contains the required structured field', () => {
    const source = sources();
    source.getEvidence = (imageId) => ({
      id: `evidence-${imageId}`,
      conversationId: 'conversation-1',
      imageId,
      sourceMessageIds: [`message-${imageId}`],
      summary: `label on ${imageId}`,
      visibleObjects: [],
      extractedText: [{ text: 'SN A-184', confidence: 1 }],
      numericValues: [{
        kind: 'serial',
        value: 'A-184',
        rawText: 'SN A-184',
        confidence: 1,
      }],
      uncertainty: { overallConfidence: 1, notes: [] },
      status: 'complete',
      sourceRevision: 'asset-v1',
      createdAt: 1,
      updatedAt: 1,
    });

    const result = new VisionExecutor(source).execute(
      plan('reuse-evidence', ['image-older']),
      new AbortController().signal,
      { question: 'What is the serial number?' },
    );

    expect(result.evidenceAction).toBe('reused');
    expect(result.pixelInspectionImageIds).toEqual([]);
    expect(result.imageInputs).toEqual([
      expect.objectContaining({
        imageId: 'image-older',
        localAssetReference: null,
        evidence: expect.objectContaining({ imageId: 'image-older' }),
      }),
    ]);
    expect(result.imageDiagnostics[0]).toEqual(expect.objectContaining({
      sufficiencyResult: 'sufficient',
      sufficiencyReason: 'serial-field-covered',
      action: 'reused-evidence',
    }));
  });

  it('reinspects only the insufficient selected comparison side and preserves provenance', () => {
    const source = sources();
    const originalGetEvidence = source.getEvidence;
    source.getEvidence = (imageId) => imageId === 'image-a'
      ? {
          ...originalGetEvidence(imageId),
          imageId,
          numericValues: [{
            kind: 'price',
            value: '$3.99',
            rawText: '$3.99',
            confidence: 1,
          }],
        } as NonNullable<ReturnType<typeof originalGetEvidence>>
      : originalGetEvidence(imageId);

    const result = new VisionExecutor(source).execute(
      plan('compare-evidence', ['image-a', 'image-b']),
      new AbortController().signal,
      { question: 'Compare their prices.' },
    );

    expect(result.status).toBe('ready');
    expect(result.pixelInspectionImageIds).toEqual(['image-b']);
    expect(result.imageInputs).toEqual([
      expect.objectContaining({
        imageId: 'image-a',
        localAssetReference: null,
        evidence: expect.objectContaining({ imageId: 'image-a' }),
      }),
      expect.objectContaining({
        imageId: 'image-b',
        localAssetReference: '/images/image-b.jpg',
        evidence: null,
      }),
    ]);
    expect(result.imageDiagnostics.map((diagnostic) => ({
      imageId: diagnostic.imageId,
      action: diagnostic.action,
      side: diagnostic.comparisonProvenance?.side,
    }))).toEqual([
      { imageId: 'image-a', action: 'reused-evidence', side: 0 },
      { imageId: 'image-b', action: 'pixel-inspection', side: 1 },
    ]);
  });

  it('treats stale or revision-mismatched evidence as insufficient without substituting', () => {
    const source = sources();
    const originalGetEvidence = source.getEvidence;
    source.getEvidence = (imageId) => ({
      ...originalGetEvidence(imageId),
      status: 'stale',
    }) as NonNullable<ReturnType<typeof originalGetEvidence>>;

    const result = new VisionExecutor(source).execute(
      plan('reuse-evidence', ['image-older']),
      new AbortController().signal,
      { question: 'What is visible?' },
    );

    expect(result.imageInputs.map((input) => input.imageId)).toEqual(['image-older']);
    expect(result.pixelInspectionImageIds).toEqual(['image-older']);
    expect(result.imageDiagnostics[0]).toEqual(expect.objectContaining({
      evidenceStatus: 'stale',
      sufficiencyReason: 'stale-evidence',
      action: 'pixel-inspection',
    }));
  });

  it('honors cancellation before resolving any assets', () => {
    const source = sources();
    const controller = new AbortController();
    controller.abort();

    const result = new VisionExecutor(source).execute(
      plan('inspect-original', ['image-a']),
      controller.signal,
    );

    expect(result.status).toBe('cancelled');
    expect(source.getImage).not.toHaveBeenCalled();
  });
});
