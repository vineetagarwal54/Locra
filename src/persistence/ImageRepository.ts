import type { ImageAssetRow } from '../types/models';

import { runInTransaction } from './sqlite/Transactions';
import type { SqliteDriver } from './types';

export interface CreateImageAssetInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly localPath: string;
  readonly contentHash?: string | null;
  readonly createdAt?: number;
}

export interface ImageRepositoryDeps {
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly deleteFile?: (path: string) => void;
}

export class ImageRepository {
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly deleteFile: ((path: string) => void) | null;

  constructor(private readonly driver: SqliteDriver, deps: ImageRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? defaultCreateId;
    this.deleteFile = deps.deleteFile ?? null;
  }

  createOrReuseAsset(input: CreateImageAssetInput): ImageAssetRow {
    const existing = this.driver.getFirstSync<ImageAssetRow>(
      'SELECT * FROM image_asset WHERE local_path = ?',
      [input.localPath],
    );
    if (existing !== null) {
      if (existing.conversation_id !== input.conversationId) {
        throw new Error('An image asset cannot be shared across conversations.');
      }
      return existing;
    }
    const row: ImageAssetRow = {
      id: input.id ?? this.createId(),
      conversation_id: input.conversationId,
      local_path: input.localPath,
      available: 1,
      content_hash: input.contentHash ?? null,
      created_at: input.createdAt ?? this.now(),
    };
    this.driver.runSync(
      `INSERT INTO image_asset
         (id, conversation_id, local_path, available, content_hash, created_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
      [row.id, row.conversation_id, row.local_path, row.content_hash, row.created_at],
    );
    return row;
  }

  getAsset(id: string): ImageAssetRow | null {
    return this.driver.getFirstSync<ImageAssetRow>('SELECT * FROM image_asset WHERE id = ?', [id]);
  }

  getAssetsForMessage(messageId: string): ImageAssetRow[] {
    return this.driver.getAllSync<ImageAssetRow>(
      `SELECT asset.* FROM image_asset asset
         JOIN message_image link ON link.image_asset_id = asset.id
        WHERE link.message_id = ?
        ORDER BY link.ordinal ASC, asset.id ASC`,
      [messageId],
    );
  }

  linkToMessage(messageId: string, imageAssetId: string, ordinal: number): void {
    this.driver.runSync(
      `INSERT OR IGNORE INTO message_image
         (message_id, image_asset_id, ordinal, created_at)
       VALUES (?, ?, ?, ?)`,
      [messageId, imageAssetId, ordinal, this.now()],
    );
  }

  markMissing(imageAssetId: string): void {
    this.driver.runSync('UPDATE image_asset SET available = 0 WHERE id = ?', [imageAssetId]);
  }

  unlinkForMessage(messageId: string): void {
    const deletedPaths = runInTransaction(this.driver, () => {
      const assets = this.getAssetsForMessage(messageId);
      this.driver.runSync('DELETE FROM visual_evidence WHERE source_message_id = ?', [messageId]);
      this.driver.runSync('DELETE FROM message_image WHERE message_id = ?', [messageId]);
      const paths: string[] = [];
      for (const asset of assets) {
        const remaining = this.driver.getFirstSync<{ n: number }>(
          'SELECT COUNT(*) AS n FROM message_image WHERE image_asset_id = ?',
          [asset.id],
        )?.n ?? 0;
        if (remaining === 0) {
          this.driver.runSync('DELETE FROM image_asset WHERE id = ?', [asset.id]);
          paths.push(asset.local_path);
        }
      }
      return paths;
    });
    if (this.deleteFile !== null) {
      for (const path of deletedPaths) {
        this.deleteFile(path);
      }
    }
  }
}

function defaultCreateId(): string {
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
