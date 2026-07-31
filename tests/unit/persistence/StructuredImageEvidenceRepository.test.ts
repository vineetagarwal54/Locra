import type { HiddenVisualEvidence } from '../../../src/inference/OutputPipelineTypes';
import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { ImageEntityRepository } from '../../../src/persistence/ImageEntityRepository';
import { MessageRepository } from '../../../src/persistence/MessageRepository';
import {
  StructuredImageEvidenceRepository,
} from '../../../src/persistence/StructuredImageEvidenceRepository';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

const hiddenEvidence: HiddenVisualEvidence = {
  version: 'hidden-evidence-v1',
  imagePath: '/images/market.jpg',
  sourceQuestion: 'What is visible?',
  subjectObject: 'market stall',
  visibleObjects: ['apple', 'banana'],
  visibleFeatures: ['apples', 'two price labels'],
  visibleText: ['$3.99', 'BEST BY 2027-08-10', 'COUNT 12', 'SN A-184'],
  visibleCondition: 'readable',
  uncertainty: ['one label is partly obscured'],
  createdAt: '2026-07-28T00:00:00.000Z',
};

describe('StructuredImageEvidenceRepository', () => {
  let database: TestDatabase;
  let repository: StructuredImageEvidenceRepository;

  beforeEach(() => {
    database = createTestDatabase();
    new ConversationRepository(database.driver).createConversation({ id: 'conversation-1' });
    new MessageRepository(database.driver).appendUserMessage({
      id: 'message-1',
      conversationId: 'conversation-1',
      text: 'image',
    });
    new ImageEntityRepository(database.driver).create({
      id: 'image-1',
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      localAssetReference: '/images/market.jpg',
      assetRevision: 'asset-v1',
    });
    repository = new StructuredImageEvidenceRepository(database.driver, {
      now: () => 200,
      createId: () => 'evidence-1',
    });
  });

  afterEach(() => database.close());

  it('persists MVP identity, objects, text, numeric values, associations, uncertainty, and status', () => {
    const saved = repository.saveFromHiddenEvidence({
      conversationId: 'conversation-1',
      imageId: 'image-1',
      sourceMessageIds: ['message-1'],
      sourceRevision: 'asset-v1',
      hiddenEvidence,
    });

    expect(saved).toEqual(expect.objectContaining({
      id: 'evidence-1',
      imageId: 'image-1',
      sourceMessageIds: ['message-1'],
      summary: expect.stringContaining('market stall'),
      status: 'complete',
      visibleObjects: expect.arrayContaining([
        expect.objectContaining({ label: 'apple' }),
        expect.objectContaining({ label: 'banana' }),
      ]),
      extractedText: expect.arrayContaining([
        expect.objectContaining({ text: '$3.99' }),
      ]),
      numericValues: expect.arrayContaining([
        expect.objectContaining({ kind: 'price', rawText: '$3.99' }),
        expect.objectContaining({ kind: 'date', rawText: expect.stringContaining('2027-08-10') }),
        expect.objectContaining({ kind: 'count', rawText: expect.stringContaining('12') }),
        expect.objectContaining({ kind: 'serial', rawText: expect.stringContaining('A-184') }),
      ]),
      uncertainty: expect.objectContaining({
        notes: ['one label is partly obscured'],
      }),
    }));
    expect(saved.visibleObjects.map((object) => object.label)).not.toContain('$3.99');
    expect(saved.extractedText.map((span) => span.text)).not.toContain('apple');
    expect(repository.getLatestCompatible('image-1', 'asset-v1')).toEqual(saved);
  });

  it('marks incomplete extraction partial and malformed extraction failed', () => {
    const partial = repository.saveExtraction({
      id: 'partial',
      conversationId: 'conversation-1',
      imageId: 'image-1',
      sourceMessageIds: ['message-1'],
      sourceRevision: 'asset-v1',
      extraction: {
        summary: 'market',
        visibleObjects: [],
      },
    });
    const failed = repository.saveExtraction({
      id: 'failed',
      conversationId: 'conversation-1',
      imageId: 'image-1',
      sourceMessageIds: ['message-1'],
      sourceRevision: 'asset-v2',
      extraction: 'not structured',
    });

    expect(partial.status).toBe('partial');
    expect(failed.status).toBe('failed');
    expect(failed.summary).toBe('');
  });

  it('stales prior evidence on reinference and keeps versions separate', () => {
    repository.saveFromHiddenEvidence({
      conversationId: 'conversation-1',
      imageId: 'image-1',
      sourceMessageIds: ['message-1'],
      sourceRevision: 'asset-v1',
      hiddenEvidence,
    });

    repository.invalidateForReinference('image-1', 'asset-v2');

    expect(repository.listForImage('image-1')[0]?.status).toBe('stale');
    expect(repository.getLatestCompatible('image-1', 'asset-v2')).toBeNull();
  });

  it('accepts evidence-policy revisions derived from the current asset revision', () => {
    repository.saveFromHiddenEvidence({
      conversationId: 'conversation-1',
      imageId: 'image-1',
      sourceMessageIds: ['message-1'],
      sourceRevision: 'asset-v1:evidence:hidden-evidence-v1',
      hiddenEvidence,
    });

    expect(repository.getLatestCompatible('image-1', 'asset-v1')).toEqual(
      expect.objectContaining({
        sourceRevision: 'asset-v1:evidence:hidden-evidence-v1',
      }),
    );
  });

  it('never treats a text-only formatting retry as new visual evidence', () => {
    expect(() => repository.saveTextOnlyRetry({
      imageId: 'image-1',
      sourceMessageId: 'message-1',
      text: 'The image definitely shows a new price.',
    })).toThrow(/pixels/i);
    expect(repository.listForImage('image-1')).toEqual([]);
  });
});
