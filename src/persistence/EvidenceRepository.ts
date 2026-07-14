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
         JOIN message source ON source.id = evidence.source_message_id
         JOIN message_image link
           ON link.message_id = source.id AND link.image_asset_id = evidence.image_asset_id
        WHERE evidence.conversation_id = ?
        ORDER BY source.created_at DESC, link.ordinal DESC, evidence.created_at DESC, evidence.id ASC
        LIMIT 1`,
      [conversationId],
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
        ORDER BY created_at DESC, id ASC LIMIT 1`,
      params,
    );
  }

  listRetrievalSourceUnits(conversationId: string): EvidenceRetrievalSourceUnit[] {
    const rows = this.driver.getAllSync<VisualEvidenceRow>(
      `SELECT * FROM visual_evidence WHERE conversation_id = ?
        ORDER BY created_at DESC, id ASC LIMIT 100`,
      [conversationId],
    );
    return rows.map(toRetrievalSourceUnit);
  }
}

function toRetrievalSourceUnit(row: VisualEvidenceRow): EvidenceRetrievalSourceUnit {
  const pieces = [
    row.subject_object,
    ...parseStringArray(row.visible_features_json),
    ...parseStringArray(row.visible_text_json),
    row.visible_condition,
    ...parseStringArray(row.uncertainty_json),
  ].filter((piece) => piece.trim() !== '');
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sourceMessageId: row.source_message_id,
    imageAssetId: row.image_asset_id,
    timestamp: row.created_at,
    text: pieces.join('\n'),
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
