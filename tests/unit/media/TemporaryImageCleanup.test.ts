import { TemporaryImageCleanup } from '../../../src/media/TemporaryImageCleanup';

describe('TemporaryImageCleanup', () => {
  it('deletes only a derived file inside the cache directory', async () => {
    const deleteFile = jest.fn(async () => undefined);
    const cleanup = new TemporaryImageCleanup({ cacheRoot: '/cache', deleteFile });

    await cleanup.removeDerived('/cache/ImageManipulator/result.jpg', '/documents/original.jpg');

    expect(deleteFile).toHaveBeenCalledWith('/cache/ImageManipulator/result.jpg');
  });

  it('never deletes the durable source or a derived path outside cache', async () => {
    const deleteFile = jest.fn(async () => undefined);
    const cleanup = new TemporaryImageCleanup({ cacheRoot: '/cache', deleteFile });

    await cleanup.removeDerived('/documents/original.jpg', '/documents/original.jpg');
    await cleanup.removeDerived('/documents/another.jpg', '/documents/original.jpg');

    expect(deleteFile).not.toHaveBeenCalled();
  });
});
