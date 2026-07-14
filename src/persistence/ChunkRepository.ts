import type { MessageChunk } from '../retrieval/ChunkingService';
import type { RetrievalCandidate } from '../retrieval/types';
import type { ChunkRow } from '../types/models';

import { runInTransaction } from './sqlite/Transactions';
import type { SqliteDriver } from './types';

export class ChunkRepository {
  constructor(private readonly driver: SqliteDriver) {}

  upsertChunksForMessage(
    sourceMessageId: string,
    chunkVersion: string,
    chunks: readonly MessageChunk[],
  ): void {
    if (chunks.some((chunk) =>
      chunk.sourceMessageId !== sourceMessageId || chunk.chunkVersion !== chunkVersion)) {
      throw new Error('Every chunk must match the requested source message and version.');
    }
    runInTransaction(this.driver, () => {
      this.driver.runSync(
        'DELETE FROM chunk WHERE source_message_id = ? AND chunk_version = ?',
        [sourceMessageId, chunkVersion],
      );
      for (const chunk of chunks) {
        this.driver.runSync(
          `INSERT INTO chunk
             (id, conversation_id, source_message_id, image_asset_id, chunk_version,
              ordinal, start_offset, end_offset, text, source_revision, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [chunk.id, chunk.conversationId, chunk.sourceMessageId, chunk.imageAssetId,
            chunk.chunkVersion, chunk.ordinal, chunk.startOffset, chunk.endOffset,
            chunk.text, chunk.sourceRevision, chunk.createdAt],
        );
      }
    });
  }

  listForMessage(sourceMessageId: string, chunkVersion: string): ChunkRow[] {
    return this.driver.getAllSync<ChunkRow>(
      `SELECT * FROM chunk WHERE source_message_id = ? AND chunk_version = ?
       ORDER BY ordinal ASC`,
      [sourceMessageId, chunkVersion],
    );
  }

  listRetrievalSourceUnits(conversationIds: readonly string[]): RetrievalCandidate[] {
    if (conversationIds.length === 0) {
      return [];
    }
    const placeholders = conversationIds.map(() => '?').join(', ');
    const rows = this.driver.getAllSync<ChunkRow>(
      `SELECT * FROM chunk WHERE conversation_id IN (${placeholders})
       ORDER BY created_at DESC, id ASC LIMIT 500`,
      conversationIds,
    );
    return rows.map((row) => ({
      id: row.id,
      sourceConversationId: row.conversation_id,
      sourceMessageId: row.source_message_id,
      imageAssetId: row.image_asset_id,
      timestamp: row.created_at,
      contentType: 'chunk',
      text: row.text,
    }));
  }
}
