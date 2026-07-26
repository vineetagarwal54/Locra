import type { ImageReferenceCandidate } from '../inference/ImageReferenceResolver';
import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';
import type { VisualEvidenceRow } from '../types/models';

import type { SqliteDriver } from './types';

export interface SaveEvidenceInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly imageAssetId: string;
  readonly evidence: HiddenVisualEvidence;
  readonly sourceRevision: string;
}

export interface EvidenceReference {
  readonly conversationId: string;
  readonly sourceMessageId?: string;
  readonly imageAssetId?: string;
}

export interface EvidenceRetrievalSourceUnit {
  readonly id: string;
  readonly conversationId: string;
  readonly sourceMessageId: string;
  readonly imageAssetId: string;
  readonly timestamp: number;
  readonly text: string;
  readonly sourceRevision: string;
  readonly evidenceVersion: string;
}

export interface EvidenceRepositoryDeps {
  readonly now?: () => number;
  readonly createId?: () => string;
}

export class EvidenceRepository {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(private readonly driver: SqliteDriver, deps: EvidenceRepositoryDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? defaultCreateId;
  }

  saveEvidence(input: SaveEvidenceInput): VisualEvidenceRow {
    const compatible = this.driver.getFirstSync<VisualEvidenceRow>(
      `SELECT * FROM visual_evidence
        WHERE source_message_id = ? AND image_asset_id = ?
          AND evidence_version = ? AND source_revision = ?
        ORDER BY created_at DESC, id ASC LIMIT 1`,
      [input.sourceMessageId, input.imageAssetId, input.evidence.version, input.sourceRevision],
    );
    if (compatible !== null) {
      return compatible;
    }
    const row: VisualEvidenceRow = {
      id: input.id ?? this.createId(),
      conversation_id: input.conversationId,
      source_message_id: input.sourceMessageId,
      image_asset_id: input.imageAssetId,
      evidence_version: input.evidence.version,
      subject_object: input.evidence.subjectObject,
      visible_features_json: JSON.stringify(input.evidence.visibleFeatures),
      visible_text_json: JSON.stringify(input.evidence.visibleText),
      visible_condition: input.evidence.visibleCondition,
      uncertainty_json: JSON.stringify(input.evidence.uncertainty),
      source_revision: input.sourceRevision,
      created_at: this.now(),
    };
    this.driver.runSync(
      `INSERT INTO visual_evidence
         (id, conversation_id, source_message_id, image_asset_id, evidence_version,
          subject_object, visible_features_json, visible_text_json, visible_condition,
          uncertainty_json, source_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.conversation_id, row.source_message_id, row.image_asset_id,
        row.evidence_version, row.subject_object, row.visible_features_json,
        row.visible_text_json, row.visible_condition, row.uncertainty_json,
        row.source_revision, row.created_at],
    );
    return row;
  }

  saveReinferredEvidence(input: SaveEvidenceInput): VisualEvidenceRow {
    const id = input.id ?? this.createId();
    return this.saveEvidence({
      ...input,
      id,
      sourceRevision: `${input.sourceRevision}:reinference:${id}`,
    });
  }

  getEvidenceForMessage(sourceMessageId: string): VisualEvidenceRow[] {
    return this.driver.getAllSync<VisualEvidenceRow>(
      `SELECT * FROM visual_evidence WHERE source_message_id = ?
        ORDER BY created_at DESC, id ASC`,
      [sourceMessageId],
    );
  }

  getActiveImageEvidence(conversationId: string): VisualEvidenceRow | null {
    return this.driver.getFirstSync<VisualEvidenceRow>(
      `SELECT evidence.* FROM visual_evidence evidence
        WHERE evidence.conversation_id = ?
          AND evidence.image_asset_id = (
            SELECT link.image_asset_id FROM message_image link
              JOIN message source ON source.id = link.message_id
             WHERE source.conversation_id = ?
             ORDER BY source.created_at DESC, link.ordinal DESC, link.image_asset_id ASC
             LIMIT 1
          )
        ORDER BY evidence.created_at DESC, evidence.rowid DESC
        LIMIT 1`,
      [conversationId, conversationId],
    );
  }

  resolveReferencedImageEvidence(reference: EvidenceReference): VisualEvidenceRow | null {
    if (reference.sourceMessageId === undefined && reference.imageAssetId === undefined) {
      return null;
    }
    const conditions = ['conversation_id = ?'];
    const params: string[] = [reference.conversationId];
    if (reference.sourceMessageId !== undefined) {
      conditions.push('source_message_id = ?');
      params.push(reference.sourceMessageId);
    }
    if (reference.imageAssetId !== undefined) {
      conditions.push('image_asset_id = ?');
      params.push(reference.imageAssetId);
    }
    return this.driver.getFirstSync<VisualEvidenceRow>(
      `SELECT * FROM visual_evidence WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      params,
    );
  }

  listImageReferenceCandidates(conversationId: string): ImageReferenceCandidate[] {
    const imageRows = this.driver.getAllSync<{
      image_asset_id: string;
      source_message_id: string;
      local_path: string;
      available: number;
      created_at: number;
    }>(
      `SELECT asset.id AS image_asset_id, source.id AS source_message_id,
              asset.local_path, asset.available, source.created_at
         FROM image_asset asset
         JOIN message_image link ON link.image_asset_id = asset.id
         JOIN message source ON source.id = link.message_id
        WHERE source.conversation_id = ?
        ORDER BY source.created_at ASC, link.ordinal ASC, asset.id ASC`,
      [conversationId],
    );
    const messages = this.driver.getAllSync<{ id: string; text: string; created_at: number }>(
      `SELECT id, text, created_at FROM message
        WHERE conversation_id = ?
        ORDER BY created_at ASC, id ASC`,
      [conversationId],
    );
    const evidenceByAsset = new Map<string, VisualEvidenceRow[]>();
    for (const row of this.latestEvidencePerImageVersion(conversationId)) {
      const rows = evidenceByAsset.get(row.image_asset_id) ?? [];
      rows.push(row);
      evidenceByAsset.set(row.image_asset_id, rows);
    }

    return imageRows.map((image, index) => {
      const nextImageCreatedAt = imageRows[index + 1]?.created_at ?? Number.POSITIVE_INFINITY;
      const associatedText = messages
        .filter(
          (message) =>
            message.created_at >= image.created_at &&
            message.created_at < nextImageCreatedAt,
        )
        .map((message) => message.text);
      const evidenceText = (evidenceByAsset.get(image.image_asset_id) ?? [])
        .flatMap(evidenceSearchPieces);
      return {
        imageAssetId: image.image_asset_id,
        sourceMessageId: image.source_message_id,
        localPath: image.local_path,
        available: image.available === 1,
        createdAt: image.created_at,
        searchText: [...associatedText, ...evidenceText].join('\n'),
      };
    });
  }

  listRetrievalSourceUnits(conversationId: string): EvidenceRetrievalSourceUnit[] {
    return this.latestEvidencePerImageVersion(conversationId)
      .slice(0, 100)
      .map(toRetrievalSourceUnit);
  }

  private latestEvidencePerImageVersion(conversationId: string): VisualEvidenceRow[] {
    const rows = this.driver.getAllSync<VisualEvidenceRow>(
      `SELECT * FROM visual_evidence WHERE conversation_id = ?
        ORDER BY created_at DESC, rowid DESC`,
      [conversationId],
    );
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.image_asset_id}\u0000${row.evidence_version}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

function evidenceSearchPieces(row: VisualEvidenceRow): string[] {
  return [
    row.subject_object,
    ...parseStringArray(row.visible_features_json),
    ...parseStringArray(row.visible_text_json),
    row.visible_condition,
    ...parseStringArray(row.uncertainty_json),
  ].filter((piece) => piece.trim() !== '');
}

function toRetrievalSourceUnit(row: VisualEvidenceRow): EvidenceRetrievalSourceUnit {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    imageAssetId: row.image_asset_id,
    timestamp: row.created_at,
    text: evidenceSearchPieces(row).join('\n'),
    sourceRevision: row.source_revision,
    evidenceVersion: row.evidence_version,
  };
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
    ? parsed
    : [];
}

function defaultCreateId(): string {
  return `evidence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
