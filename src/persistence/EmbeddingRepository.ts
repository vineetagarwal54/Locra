import type { CompatibleEmbeddingCandidate } from '../retrieval/types';
import type { EmbeddingRow, EmbeddingState } from '../types/models';

import type { SqliteDriver } from './types';

export type EmbeddingSource =
  | { readonly kind: 'chunk'; readonly id: string }
  | { readonly kind: 'message'; readonly id: string }
  | { readonly kind: 'evidence'; readonly id: string }
  | { readonly kind: 'fact'; readonly id: string };

export interface EmbeddingUpsertInput {
  readonly id: string;
  readonly conversationId: string;
  readonly source: EmbeddingSource;
  readonly modelId: string;
  readonly modelArtifactHash: string;
  readonly embeddingVersion: string;
  readonly dimensions: number;
  readonly sourceRevision: string;
  readonly vector: Float32Array;
  readonly state: EmbeddingState;
  readonly createdAt: number;
}

interface CompatibleRow {
  id: string;
  source_conversation_id: string;
  source_message_id: string;
  image_asset_id: string | null;
  source_timestamp: number;
  content_type: 'chunk' | 'evidence' | 'fact';
  source_text: string;
  vector: Uint8Array;
}

export class EmbeddingRepository {
  constructor(private readonly driver: SqliteDriver) {}

  getCompatibleByScope(
    conversationIds: readonly string[],
    embeddingVersion: string,
    artifactHash: string,
  ): CompatibleEmbeddingCandidate[] {
    if (conversationIds.length === 0) {
      return [];
    }
    const placeholders = conversationIds.map(() => '?').join(', ');
    const rows = this.driver.getAllSync<CompatibleRow>(
      `SELECT embedding.id,
              embedding.conversation_id AS source_conversation_id,
              COALESCE(chunk.source_message_id, message.id, evidence.source_message_id,
                (SELECT MIN(message_id) FROM durable_fact_source
                  WHERE fact_id = fact.id)) AS source_message_id,
              COALESCE(chunk.image_asset_id, evidence.image_asset_id) AS image_asset_id,
              COALESCE(chunk.created_at, message.created_at, evidence.created_at, fact.created_at)
                AS source_timestamp,
              CASE WHEN embedding.evidence_id IS NOT NULL THEN 'evidence'
                   WHEN embedding.fact_id IS NOT NULL THEN 'fact'
                   ELSE 'chunk' END AS content_type,
              COALESCE(chunk.text, message.text,
                evidence.subject_object || '\n' || evidence.visible_features_json || '\n' ||
                  evidence.visible_text_json || '\n' || evidence.visible_condition,
                fact.value_text) AS source_text,
              embedding.vector
         FROM embedding
         LEFT JOIN chunk ON chunk.id = embedding.chunk_id
         LEFT JOIN message ON message.id = embedding.message_id
         LEFT JOIN visual_evidence evidence ON evidence.id = embedding.evidence_id
         LEFT JOIN durable_fact fact ON fact.id = embedding.fact_id
        WHERE embedding.conversation_id IN (${placeholders})
          AND embedding.embedding_version = ?
          AND embedding.model_artifact_hash = ?
          AND embedding.state = 'ready'
        ORDER BY source_timestamp DESC, embedding.id ASC`,
      [...conversationIds, embeddingVersion, artifactHash],
    );
    return rows.map((row) => ({
      id: row.id,
      sourceConversationId: row.source_conversation_id,
      sourceMessageId: row.source_message_id,
      imageAssetId: row.image_asset_id,
      timestamp: row.source_timestamp,
      contentType: row.content_type,
      text: row.source_text,
      vector: bytesToFloat32(row.vector),
    }));
  }

  upsert(input: EmbeddingUpsertInput): void {
    const sourceColumns = sourceColumnValues(input.source);
    this.driver.runSync(
      `INSERT INTO embedding
         (id, conversation_id, chunk_id, message_id, evidence_id, fact_id, model_id,
          model_artifact_hash, embedding_version, dimensions, source_revision, vector,
          state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         chunk_id = excluded.chunk_id, message_id = excluded.message_id,
         evidence_id = excluded.evidence_id, fact_id = excluded.fact_id,
         model_id = excluded.model_id, model_artifact_hash = excluded.model_artifact_hash,
         embedding_version = excluded.embedding_version, dimensions = excluded.dimensions,
         source_revision = excluded.source_revision, vector = excluded.vector,
         state = excluded.state, updated_at = excluded.updated_at`,
      [input.id, input.conversationId, ...sourceColumns, input.modelId,
        input.modelArtifactHash, input.embeddingVersion, input.dimensions,
        input.sourceRevision, float32ToBytes(input.vector), input.state,
        input.createdAt, input.createdAt],
    );
  }

  getById(id: string): EmbeddingRow | null {
    return this.driver.getFirstSync<EmbeddingRow>('SELECT * FROM embedding WHERE id = ?', [id]);
  }

  markStaleByRevision(source: EmbeddingSource, currentRevision: string): void {
    const column = sourceColumn(source.kind);
    this.driver.runSync(
      `UPDATE embedding SET state = 'stale', updated_at = ?
        WHERE ${column} = ? AND source_revision <> ? AND state IN ('ready','rebuilding')`,
      [Date.now(), source.id, currentRevision],
    );
  }

  pendingBatch(limit: number): EmbeddingRow[] {
    const boundedLimit = Math.min(25, Math.max(0, Math.floor(limit)));
    return this.driver.getAllSync<EmbeddingRow>(
      `SELECT * FROM embedding WHERE state IN ('pending','stale')
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      [boundedLimit],
    );
  }

  getSourceText(row: EmbeddingRow): string | null {
    if (row.chunk_id !== null) {
      return this.driver.getFirstSync<{ text: string }>(
        'SELECT text FROM chunk WHERE id = ?', [row.chunk_id],
      )?.text ?? null;
    }
    if (row.message_id !== null) {
      return this.driver.getFirstSync<{ text: string }>(
        'SELECT text FROM message WHERE id = ?', [row.message_id],
      )?.text ?? null;
    }
    if (row.evidence_id !== null) {
      const evidence = this.driver.getFirstSync<{
        subject_object: string;
        visible_features_json: string;
        visible_text_json: string;
        visible_condition: string;
      }>('SELECT * FROM visual_evidence WHERE id = ?', [row.evidence_id]);
      return evidence === null ? null : [
        evidence.subject_object,
        evidence.visible_features_json,
        evidence.visible_text_json,
        evidence.visible_condition,
      ].join('\n');
    }
    if (row.fact_id !== null) {
      return this.driver.getFirstSync<{ value_text: string }>(
        'SELECT value_text FROM durable_fact WHERE id = ?', [row.fact_id],
      )?.value_text ?? null;
    }
    return null;
  }

  updateResult(id: string, vector: Float32Array, state: 'ready'): void {
    this.driver.runSync(
      'UPDATE embedding SET vector = ?, state = ?, updated_at = ? WHERE id = ?',
      [float32ToBytes(vector), state, Date.now(), id],
    );
  }

  updateState(id: string, state: 'failed'): void {
    this.driver.runSync(
      'UPDATE embedding SET state = ?, updated_at = ? WHERE id = ?',
      [state, Date.now(), id],
    );
  }
}

function sourceColumnValues(source: EmbeddingSource): [string | null, string | null, string | null, string | null] {
  return [
    source.kind === 'chunk' ? source.id : null,
    source.kind === 'message' ? source.id : null,
    source.kind === 'evidence' ? source.id : null,
    source.kind === 'fact' ? source.id : null,
  ];
}

function sourceColumn(kind: EmbeddingSource['kind']): string {
  if (kind === 'chunk') return 'chunk_id';
  if (kind === 'message') return 'message_id';
  if (kind === 'evidence') return 'evidence_id';
  return 'fact_id';
}

function float32ToBytes(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

function bytesToFloat32(bytes: Uint8Array): Float32Array {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Float32Array(copy);
}
