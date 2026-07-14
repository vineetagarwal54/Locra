import type { DeviceResourcePolicy, ResourceLease } from '../../../src/inference/DeviceResourcePolicy';
import { EmbeddingBackfill, EMBEDDING_BACKFILL_BATCH_LIMIT } from '../../../src/retrieval/EmbeddingBackfill';
import { EmbeddingService } from '../../../src/retrieval/EmbeddingService';
import type { NativeEmbeddingBinding } from '../../../src/retrieval/EmbeddingService';
import type { EmbeddingRow } from '../../../src/types/models';

function policy(release: jest.Mock): DeviceResourcePolicy {
  const lease: ResourceLease = { operation: 'embedding', release };
  return {
    acquire: jest.fn(async () => lease),
    tryAcquire: jest.fn(() => lease),
    isBusy: jest.fn(() => false),
    current: jest.fn(() => null),
  };
}

describe('EmbeddingService lifecycle', () => {
  const manifest = {
    modelId: 'embed-model', modelPath: '/models/embed.gguf', modelArtifactHash: 'sha256',
    embeddingVersion: 'embedding-v1', dimensions: 3,
  };

  it('exposes manifest identity and releases context and lease on success', async () => {
    const releaseLease = jest.fn();
    const releaseContext = jest.fn(async () => undefined);
    const binding: NativeEmbeddingBinding = {
      initLlama: jest.fn(async () => ({
        embedding: jest.fn(async () => ({ embedding: [1, 2, 3] })),
        release: releaseContext,
      })),
    };
    const service = new EmbeddingService(manifest, binding, policy(releaseLease));

    await expect(service.embed(['hello'])).resolves.toEqual([new Float32Array([1, 2, 3])]);
    expect(service).toEqual(expect.objectContaining({
      modelId: 'embed-model', modelArtifactHash: 'sha256',
      embeddingVersion: 'embedding-v1', dimensions: 3,
    }));
    expect(releaseContext).toHaveBeenCalled();
    expect(releaseLease).toHaveBeenCalled();
  });

  it('releases the resource lease when initialization fails', async () => {
    const releaseLease = jest.fn();
    const binding: NativeEmbeddingBinding = {
      initLlama: jest.fn(async () => { throw new Error('load failed'); }),
    };
    const service = new EmbeddingService(manifest, binding, policy(releaseLease));

    await expect(service.embed(['hello'])).rejects.toThrow('load failed');
    expect(releaseLease).toHaveBeenCalled();
  });

  it('persists manifest metadata, source revision, failure state, and a 25-item batch cap', async () => {
    expect(EMBEDDING_BACKFILL_BATCH_LIMIT).toBe(25);
    const pending = Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}` })) as EmbeddingRow[];
    const repository = {
      upsert: jest.fn(),
      pendingBatch: jest.fn(() => pending.slice(0, 25)),
      getSourceText: jest.fn(() => 'source text'),
      updateResult: jest.fn(),
      updateState: jest.fn(),
    };
    const service = {
      ...manifest,
      embed: jest.fn()
        .mockResolvedValueOnce([new Float32Array([1, 2, 3])])
        .mockRejectedValue(new Error('embedding failed')),
    } as unknown as EmbeddingService;
    const backfill = new EmbeddingBackfill(repository, service, { yieldToUi: async () => undefined });
    backfill.enqueue([{
      id: 'work-1', conversationId: 'conversation-1',
      source: { kind: 'message', id: 'message-1' }, sourceRevision: 'revision-1', createdAt: 10,
    }]);

    await backfill.runIdleBatch();

    expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'embed-model', modelArtifactHash: 'sha256', embeddingVersion: 'embedding-v1',
      dimensions: 3, sourceRevision: 'revision-1', state: 'pending',
    }));
    expect(repository.pendingBatch).toHaveBeenCalledWith(25);
    expect(repository.updateResult).toHaveBeenCalledTimes(1);
    expect(repository.updateState).toHaveBeenCalledWith('row-1', 'failed');
  });
});
