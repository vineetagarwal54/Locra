import { DurableImageStorage } from '../../../src/media/DurableImageStorage';

describe('DurableImageStorage', () => {
  it('copies a temporary image into conversation-scoped durable storage before deleting the source', async () => {
    const calls: string[] = [];
    const storage = new DurableImageStorage({
      documentRoot: '/documents',
      createId: () => 'image-1',
      ensureDirectory: async (path) => { calls.push(`mkdir:${path}`); },
      copyFile: async (source, destination) => { calls.push(`copy:${source}->${destination}`); },
      deleteFile: async (path) => { calls.push(`delete:${path}`); },
    });

    await expect(storage.persist('conversation/a', '/cache/picked.PNG')).resolves.toBe(
      '/documents/locra-conversations/conversation_a/images/image-1.png',
    );
    expect(calls).toEqual([
      'mkdir:/documents/locra-conversations/conversation_a/images',
      'copy:/cache/picked.PNG->/documents/locra-conversations/conversation_a/images/image-1.png',
      'delete:/cache/picked.PNG',
    ]);
  });

  it('does not delete the source when the durable copy fails', async () => {
    const deleteFile = jest.fn(async () => undefined);
    const storage = new DurableImageStorage({
      documentRoot: '/documents',
      createId: () => 'image-1',
      ensureDirectory: async () => undefined,
      copyFile: async () => { throw new Error('disk full'); },
      deleteFile,
    });

    await expect(storage.persist('conversation-a', '/cache/picked.jpg')).rejects.toThrow('disk full');
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('keeps the durable result usable when temporary-source cleanup fails', async () => {
    const storage = new DurableImageStorage({
      documentRoot: '/documents',
      createId: () => 'image-1',
      ensureDirectory: async () => undefined,
      copyFile: async () => undefined,
      deleteFile: async () => { throw new Error('source busy'); },
    });

    await expect(storage.persist('conversation-a', '/cache/picked.jpg')).resolves.toBe(
      '/documents/locra-conversations/conversation-a/images/image-1.jpg',
    );
  });

  it('reuses an image already stored inside the same conversation directory', async () => {
    const copyFile = jest.fn(async () => undefined);
    const deleteFile = jest.fn(async () => undefined);
    const storage = new DurableImageStorage({
      documentRoot: '/documents',
      createId: () => 'unused',
      ensureDirectory: async () => undefined,
      copyFile,
      deleteFile,
    });
    const durablePath = '/documents/locra-conversations/conversation-a/images/existing.jpg';

    await expect(storage.persist('conversation-a', durablePath)).resolves.toBe(durablePath);
    expect(copyFile).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
