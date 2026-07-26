import type { HiddenVisualEvidence } from '../../../src/inference/OutputPipelineTypes';
import { classifyRequest } from '../../../src/inference/RequestClassifier';
import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { EvidenceRepository } from '../../../src/persistence/EvidenceRepository';
import { ImageRepository } from '../../../src/persistence/ImageRepository';
import { MessageRepository } from '../../../src/persistence/MessageRepository';
import type { ConversationMessage } from '../../../src/types/models';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

const hiddenEvidence: HiddenVisualEvidence = {
  version: 'hidden-evidence-v1',
  imagePath: '/images/first.jpg',
  sourceQuestion: 'What is this?',
  subjectObject: 'receipt',
  visibleFeatures: ['paper'],
  visibleText: ['$12.00'],
  visibleCondition: 'readable',
  uncertainty: [],
  createdAt: '2026-07-26T00:00:00.000Z',
};

function userMessage(
  id: string,
  imageAssetId: string,
  path: string,
  createdAt: number,
): ConversationMessage {
  return {
    id,
    role: 'user',
    text: 'Describe this.',
    attachments: [{ kind: 'image', path, imageAssetId, available: true }],
    status: 'completed',
    errorMessage: null,
    createdAt,
  };
}

function assistantMessage(id: string, createdAt: number): ConversationMessage {
  return {
    id,
    role: 'assistant',
    text: 'Done.',
    attachments: [],
    status: 'completed',
    errorMessage: null,
    createdAt,
  };
}

describe('EvidenceRepository.resolveReferencedImageEvidence', () => {
  let database: TestDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(() => database.close());

  it('never returns evidence for a different image than the classifier reference', () => {
    new ConversationRepository(database.driver).createConversation({ id: 'conversation-a' });
    const messages = new MessageRepository(database.driver);
    const images = new ImageRepository(database.driver);
    const repository = new EvidenceRepository(database.driver);
    const priorMessages: ConversationMessage[] = [];

    for (let index = 1; index <= 3; index += 1) {
      const messageId = `user-${index}`;
      const assetId = `asset-${index}`;
      const path = `/images/${index}.jpg`;
      messages.appendUserMessage({
        id: messageId,
        conversationId: 'conversation-a',
        text: 'Describe this.',
        createdAt: index * 10,
      });
      const asset = images.createOrReuseAsset({
        id: assetId,
        conversationId: 'conversation-a',
        localPath: path,
        createdAt: index * 10,
      });
      images.linkToMessage(messageId, asset.id, 0);
      repository.saveEvidence({
        id: `evidence-${index}`,
        conversationId: 'conversation-a',
        sourceMessageId: messageId,
        imageAssetId: assetId,
        evidence: { ...hiddenEvidence, imagePath: path, subjectObject: `object-${index}` },
        sourceRevision: `revision-${index}`,
      });
      priorMessages.push(
        userMessage(messageId, assetId, path, index * 10),
        assistantMessage(`assistant-${index}`, index * 10 + 1),
      );
    }

    const classification = classifyRequest(
      {
        version: 'canonical-conversation-snapshot-v1',
        conversationId: 'conversation-a',
        priorMessages,
        currentMessage: {
          id: 'current',
          role: 'user',
          text: 'What was in the first image?',
          attachments: [],
          status: 'completed',
          errorMessage: null,
          createdAt: 100,
        },
        contextMemory: null,
      },
      'Medium',
      { enabled: false, conversationExcluded: false },
    );
    const resolved = repository.resolveReferencedImageEvidence({
      conversationId: 'conversation-a',
      imageAssetId: classification.referencedImageId ?? undefined,
    });

    expect(classification.referencedImageId).toBe('asset-1');
    expect(resolved).toEqual(expect.objectContaining({
      id: 'evidence-1',
      image_asset_id: 'asset-1',
      subject_object: 'object-1',
    }));
    expect(resolved?.image_asset_id).not.toBe('asset-2');
    expect(resolved?.image_asset_id).not.toBe('asset-3');
  });

  it('persists re-inferred evidence as a new version row for the same image asset', () => {
    new ConversationRepository(database.driver).createConversation({ id: 'conversation-a' });
    const messages = new MessageRepository(database.driver);
    const images = new ImageRepository(database.driver);
    const repository = new EvidenceRepository(database.driver, {
      now: () => 500,
      createId: jest.fn()
        .mockReturnValueOnce('evidence-original')
        .mockReturnValueOnce('evidence-reinferred')
        .mockReturnValueOnce('evidence-reinferred-newest'),
    });
    messages.appendUserMessage({
      id: 'user-image',
      conversationId: 'conversation-a',
      text: 'Describe this.',
    });
    messages.appendUserMessage({
      id: 'user-follow-up',
      conversationId: 'conversation-a',
      text: 'Read the exact text.',
    });
    messages.appendUserMessage({
      id: 'user-follow-up-2',
      conversationId: 'conversation-a',
      text: 'Read the exact text again.',
    });
    const asset = images.createOrReuseAsset({
      id: 'asset-1',
      conversationId: 'conversation-a',
      localPath: '/images/one.jpg',
    });
    images.linkToMessage('user-image', asset.id, 0);
    repository.saveEvidence({
      conversationId: 'conversation-a',
      sourceMessageId: 'user-image',
      imageAssetId: asset.id,
      evidence: hiddenEvidence,
      sourceRevision: 'revision-1',
    });

    repository.saveReinferredEvidence({
      conversationId: 'conversation-a',
      sourceMessageId: 'user-follow-up',
      imageAssetId: asset.id,
      evidence: { ...hiddenEvidence, visibleText: ['EXACT-42'] },
      sourceRevision: 'revision-1',
    });
    repository.saveReinferredEvidence({
      conversationId: 'conversation-a',
      sourceMessageId: 'user-follow-up-2',
      imageAssetId: asset.id,
      evidence: { ...hiddenEvidence, visibleText: ['NEWEST-84'] },
      sourceRevision: 'revision-1',
    });

    expect(repository.getEvidenceForMessage('user-follow-up')).toEqual([
      expect.objectContaining({
        id: 'evidence-reinferred',
        image_asset_id: 'asset-1',
        visible_text_json: '["EXACT-42"]',
      }),
    ]);
    expect(repository.listRetrievalSourceUnits('conversation-a')).toEqual([
      expect.objectContaining({
        id: 'evidence-reinferred-newest',
        imageAssetId: 'asset-1',
        text: expect.stringContaining('NEWEST-84'),
      }),
    ]);
  });
});
