import { evaluateImageEvidenceAvailability } from '../../../src/inference/ImageEvidencePolicy';
import type { HiddenVisualEvidence } from '../../../src/inference/OutputPipelineTypes';
import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { EvidenceRepository } from '../../../src/persistence/EvidenceRepository';
import { ImageRepository } from '../../../src/persistence/ImageRepository';
import { MessageRepository } from '../../../src/persistence/MessageRepository';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

const evidence: HiddenVisualEvidence = {
  version: 'evidence-v1',
  imagePath: '/images/mug.jpg',
  sourceQuestion: 'What is this?',
  subjectObject: 'ceramic mug',
  visibleFeatures: ['blue glaze'],
  visibleText: ['LOC-42'],
  visibleCondition: 'chipped handle',
  uncertainty: ['size unknown'],
  createdAt: '2026-07-13T12:00:00.000Z',
};

describe('image persistence', () => {
  let database: TestDatabase;
  let images: ImageRepository;
  let evidenceRepository: EvidenceRepository;
  let messages: MessageRepository;
  const deletedPaths: string[] = [];

  beforeEach(() => {
    deletedPaths.length = 0;
    database = createTestDatabase();
    new ConversationRepository(database.driver, { now: () => 100 }).createConversation({ id: 'c1' });
    messages = new MessageRepository(database.driver, { now: () => 200 });
    images = new ImageRepository(database.driver, {
      now: () => 300,
      createId: () => 'asset-1',
      deleteFile: (path) => deletedPaths.push(path),
    });
    evidenceRepository = new EvidenceRepository(database.driver, {
      now: () => 400,
      createId: () => 'evidence-1',
    });
  });

  afterEach(() => database.close());

  it('reuses one physical asset and deletes it only after its final message link is removed', () => {
    const firstMessage = messages.appendUserMessage({ id: 'm1', conversationId: 'c1', text: 'first' });
    const secondMessage = messages.appendUserMessage({ id: 'm2', conversationId: 'c1', text: 'second' });
    const firstAsset = images.createOrReuseAsset({ conversationId: 'c1', localPath: evidence.imagePath });
    const reusedAsset = images.createOrReuseAsset({ conversationId: 'c1', localPath: evidence.imagePath });
    images.linkToMessage(firstMessage.id, firstAsset.id, 0);
    images.linkToMessage(secondMessage.id, firstAsset.id, 0);

    expect(reusedAsset.id).toBe(firstAsset.id);
    expect(images.getAssetsForMessage(firstMessage.id)).toEqual([firstAsset]);

    images.unlinkForMessage(firstMessage.id);
    expect(images.getAsset(firstAsset.id)).not.toBeNull();
    expect(deletedPaths).toEqual([]);

    images.unlinkForMessage(secondMessage.id);
    expect(images.getAsset(firstAsset.id)).toBeNull();
    expect(deletedPaths).toEqual([evidence.imagePath]);
  });

  it('stores missing-file state without discarding reusable evidence', () => {
    const message = messages.appendUserMessage({ id: 'm1', conversationId: 'c1', text: 'image' });
    const asset = images.createOrReuseAsset({ conversationId: 'c1', localPath: evidence.imagePath });
    images.linkToMessage(message.id, asset.id, 0);
    evidenceRepository.saveEvidence({
      conversationId: 'c1',
      sourceMessageId: message.id,
      imageAssetId: asset.id,
      evidence,
      sourceRevision: 'sha256:image+parser-v1',
    });

    images.markMissing(asset.id);

    expect(images.getAsset(asset.id)?.available).toBe(0);
    expect(evidenceRepository.getEvidenceForMessage(message.id)).toHaveLength(1);
    expect(evaluateImageEvidenceAvailability({ assetAvailable: false, hasEvidence: true, pixelDependent: false }))
      .toEqual({ kind: 'use-evidence' });
    expect(evaluateImageEvidenceAvailability({ assetAvailable: false, hasEvidence: true, pixelDependent: true }))
      .toEqual({ kind: 'original-unavailable' });
  });

  it('reconciles missing originals without replacing their stored path or evidence', () => {
    const message = messages.appendUserMessage({ id: 'm1', conversationId: 'c1', text: 'image' });
    const asset = images.createOrReuseAsset({ conversationId: 'c1', localPath: evidence.imagePath });
    images.linkToMessage(message.id, asset.id, 0);
    evidenceRepository.saveEvidence({
      conversationId: 'c1', sourceMessageId: message.id, imageAssetId: asset.id,
      evidence, sourceRevision: 'revision-1',
    });

    const reconciled = images.reconcileAvailability((path) => path !== evidence.imagePath);

    expect(reconciled).toBe(1);
    expect(images.getAsset(asset.id)).toEqual(expect.objectContaining({
      local_path: evidence.imagePath,
      available: 0,
    }));
    expect(evidenceRepository.getEvidenceForMessage(message.id)).toHaveLength(1);
  });

  it('reuses compatible evidence and resolves the active or explicitly referenced image deterministically', () => {
    const firstMessage = messages.appendUserMessage({ id: 'm1', conversationId: 'c1', text: 'first', createdAt: 201 });
    const secondMessage = messages.appendUserMessage({ id: 'm2', conversationId: 'c1', text: 'second', createdAt: 202 });
    const firstAsset = images.createOrReuseAsset({ id: 'asset-1', conversationId: 'c1', localPath: evidence.imagePath });
    const secondAsset = images.createOrReuseAsset({ id: 'asset-2', conversationId: 'c1', localPath: '/images/label.jpg' });
    images.linkToMessage(firstMessage.id, firstAsset.id, 0);
    images.linkToMessage(secondMessage.id, secondAsset.id, 0);
    const first = evidenceRepository.saveEvidence({
      id: 'evidence-1', conversationId: 'c1', sourceMessageId: firstMessage.id,
      imageAssetId: firstAsset.id, evidence, sourceRevision: 'revision-1',
    });
    const reused = evidenceRepository.saveEvidence({
      id: 'should-not-insert', conversationId: 'c1', sourceMessageId: firstMessage.id,
      imageAssetId: firstAsset.id, evidence, sourceRevision: 'revision-1',
    });
    evidenceRepository.saveEvidence({
      id: 'evidence-2', conversationId: 'c1', sourceMessageId: secondMessage.id,
      imageAssetId: secondAsset.id, evidence: { ...evidence, imagePath: '/images/label.jpg' },
      sourceRevision: 'revision-2',
    });

    expect(reused.id).toBe(first.id);
    expect(evidenceRepository.getActiveImageEvidence('c1')?.image_asset_id).toBe(secondAsset.id);
    expect(evidenceRepository.resolveReferencedImageEvidence({ conversationId: 'c1', sourceMessageId: firstMessage.id })?.id)
      .toBe(first.id);
  });

  it('exposes source-attributed deterministic retrieval units', () => {
    const message = messages.appendUserMessage({ id: 'm1', conversationId: 'c1', text: 'image', createdAt: 201 });
    const asset = images.createOrReuseAsset({ conversationId: 'c1', localPath: evidence.imagePath });
    images.linkToMessage(message.id, asset.id, 0);
    evidenceRepository.saveEvidence({
      conversationId: 'c1', sourceMessageId: message.id, imageAssetId: asset.id,
      evidence, sourceRevision: 'revision-1',
    });

    expect(evidenceRepository.listRetrievalSourceUnits('c1')).toEqual([{
      id: 'evidence-1',
      conversationId: 'c1',
      sourceMessageId: 'm1',
      imageAssetId: 'asset-1',
      timestamp: 400,
      text: 'ceramic mug\nblue glaze\nLOC-42\nchipped handle\nsize unknown',
      sourceRevision: 'revision-1',
      evidenceVersion: 'evidence-v1',
    }]);
  });
});
