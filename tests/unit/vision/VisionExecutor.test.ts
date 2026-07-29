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
