import {
  CHUNK_MAX_CHARACTERS,
  CHUNK_OVERLAP_CHARACTERS,
  ChunkingService,
} from '../../../src/retrieval/ChunkingService';

describe('ChunkingService', () => {
  const service = new ChunkingService('chunk-v1');

  it('pins the deterministic window and overlap sizes', () => {
    expect(CHUNK_MAX_CHARACTERS).toBe(800);
    expect(CHUNK_OVERLAP_CHARACTERS).toBe(120);
  });

  it('keeps a short original unchanged as one source-referenced unit', () => {
    const text = '  Keep the original spacing.  ';
    const chunks = service.chunk({
      id: 'message-1',
      conversationId: 'conversation-1',
      text,
      sourceRevision: 'revision-1',
      createdAt: 100,
    });

    expect(chunks).toEqual([expect.objectContaining({
      sourceMessageId: 'message-1',
      text,
      ordinal: 0,
      startOffset: 0,
      endOffset: text.length,
      chunkVersion: 'chunk-v1',
    })]);
  });

  it('records stable ordinal and character offsets for overlapping windows', () => {
    const text = Array.from({ length: 1_600 }, (_, index) => String(index % 10)).join('');
    const chunks = service.chunk({
      id: 'message-2',
      conversationId: 'conversation-1',
      imageAssetId: 'image-1',
      text,
      sourceRevision: 'revision-2',
      createdAt: 200,
    });

    expect(chunks.map((chunk) => [chunk.ordinal, chunk.startOffset, chunk.endOffset])).toEqual([
      [0, 0, 800],
      [1, 680, 1_480],
      [2, 1_360, 1_600],
    ]);
    expect(chunks.every((chunk) => chunk.text === text.slice(chunk.startOffset, chunk.endOffset))).toBe(true);
  });
});

