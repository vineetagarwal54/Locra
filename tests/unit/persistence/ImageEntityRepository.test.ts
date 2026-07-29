import { ConversationRepository } from '../../../src/persistence/ConversationRepository';
import { ImageEntityRepository } from '../../../src/persistence/ImageEntityRepository';
import { MessageRepository } from '../../../src/persistence/MessageRepository';
import { createTestDatabase, type TestDatabase } from '../../helpers/nodeSqliteDriver';

describe('ImageEntityRepository', () => {
  let database: TestDatabase;
  let repository: ImageEntityRepository;

  beforeEach(() => {
    database = createTestDatabase();
    new ConversationRepository(database.driver).createConversation({ id: 'conversation-1' });
    new MessageRepository(database.driver).appendUserMessage({
      id: 'message-1',
      conversationId: 'conversation-1',
      text: 'image',
    });
    repository = new ImageEntityRepository(database.driver, { now: () => 100 });
  });

  afterEach(() => database.close());

  it('persists stable identity, provenance, revision, availability, and local reference', () => {
    const entity = repository.create({
      id: 'image-1',
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      localAssetReference: '/images/one.jpg',
      assetRevision: 'sha256:one',
    });

    expect(repository.get('image-1')).toEqual(entity);
    expect(entity).toEqual(expect.objectContaining({
      id: 'image-1',
      sourceMessageId: 'message-1',
      assetRevision: 'sha256:one',
      assetAvailability: 'available',
      evidenceIds: [],
    }));
  });

  it('versions availability changes without deleting identity or provenance', () => {
    repository.create({
      id: 'image-1',
      conversationId: 'conversation-1',
      sourceMessageId: 'message-1',
      localAssetReference: '/images/one.jpg',
      assetRevision: 'sha256:one',
    });

    const missing = repository.updateAvailability('image-1', 'missing');
    const deleted = repository.updateAvailability('image-1', 'deleted');

    expect(missing.assetRevision).not.toBe('sha256:one');
    expect(deleted.assetAvailability).toBe('deleted');
    expect(deleted.sourceMessageId).toBe('message-1');
    expect(deleted.localAssetReference).toBe('/images/one.jpg');
  });
});
