import type { AssetAvailability } from '../planning/types';

import type { SqliteDriver } from './types';

export interface ImageEntity {
  readonly id: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly assetRevision: string;
  readonly assetAvailability: AssetAvailability;
  readonly localAssetReference: string;
  readonly evidenceIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateImageEntityInput {
  readonly id: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly localAssetReference: string;
  readonly assetRevision: string;
  readonly contentHash?: string | null;
  readonly createdAt?: number;
}

export interface ImageEntityRepositoryDeps {
  readonly now?: () => number;
}

interface ImageEntityRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly local_path: string;
  readonly asset_revision: string;
  readonly asset_availability: AssetAvailability;
  readonly created_at: number;
  readonly updated_at: number;
  readonly source_message_id: string;
}

export class ImageEntityRepository {
  private readonly now: () => number;

  constructor(
    private readonly driver: SqliteDriver,
    deps: ImageEntityRepositoryDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
  }

  create(input: CreateImageEntityInput): ImageEntity {
    const existing = this.get(input.id);
    if (existing !== null) {
      if (
        existing.conversationId !== input.conversationId
        || existing.sourceMessageId !== input.sourceMessageId
      ) {
        throw new Error('Image identity cannot move between canonical sources.');
      }
      return existing;
    }
    const createdAt = input.createdAt ?? this.now();
    this.driver.withTransactionSync(() => {
      this.driver.runSync(
        `INSERT INTO image_asset
          (id, conversation_id, local_path, available, content_hash,
           asset_revision, asset_availability, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, 'available', ?, ?)`,
        [
          input.id,
          input.conversationId,
          input.localAssetReference,
          input.contentHash ?? null,
          input.assetRevision,
          createdAt,
          createdAt,
        ],
      );
      this.driver.runSync(
        `INSERT OR IGNORE INTO message_image
          (message_id, image_asset_id, ordinal, created_at)
         VALUES (?, ?, 0, ?)`,
        [input.sourceMessageId, input.id, createdAt],
      );
    });
    return this.require(input.id);
  }

  get(imageId: string): ImageEntity | null {
    const row = this.driver.getFirstSync<ImageEntityRow>(
      `SELECT asset.id, asset.conversation_id, asset.local_path,
              asset.asset_revision, asset.asset_availability,
              asset.created_at, asset.updated_at,
              link.message_id AS source_message_id
         FROM image_asset asset
         JOIN message_image link ON link.image_asset_id = asset.id
        WHERE asset.id = ?
        ORDER BY link.ordinal ASC, link.created_at ASC, link.message_id ASC
        LIMIT 1`,
      [imageId],
    );
    return row === null ? null : this.toEntity(row);
  }

  updateAvailability(
    imageId: string,
    availability: AssetAvailability,
  ): ImageEntity {
    const current = this.require(imageId);
    const updatedAt = this.now();
    const nextRevision =
      `${current.assetRevision}:availability:${availability}:${updatedAt}`;
    this.driver.runSync(
      `UPDATE image_asset
          SET available = ?, asset_availability = ?,
              asset_revision = ?, updated_at = ?
        WHERE id = ?`,
      [
        availability === 'available' ? 1 : 0,
        availability,
        nextRevision,
        updatedAt,
        imageId,
      ],
    );
    return this.require(imageId);
  }

  updateRevision(imageId: string, assetRevision: string): ImageEntity {
    this.require(imageId);
    this.driver.runSync(
      `UPDATE image_asset
          SET asset_revision = ?, updated_at = ?
        WHERE id = ?`,
      [assetRevision, this.now(), imageId],
    );
    return this.require(imageId);
  }

  private require(imageId: string): ImageEntity {
    const entity = this.get(imageId);
    if (entity === null) {
      throw new Error(`Unknown image entity: ${imageId}`);
    }
    return entity;
  }

  private toEntity(row: ImageEntityRow): ImageEntity {
    const evidenceIds = this.driver.getAllSync<{ id: string }>(
      `SELECT id FROM structured_image_evidence
        WHERE image_asset_id = ?
        ORDER BY created_at ASC, id ASC`,
      [row.id],
    ).map((evidence) => evidence.id);
    return {
      id: row.id,
      conversationId: row.conversation_id,
      sourceMessageId: row.source_message_id,
      assetRevision: row.asset_revision,
      assetAvailability: row.asset_availability,
      localAssetReference: row.local_path,
      evidenceIds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
