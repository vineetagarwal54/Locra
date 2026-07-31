import type { HiddenVisualEvidence } from '../inference/OutputPipelineTypes';

import type { SqliteDriver } from './types';

export type StructuredImageEvidenceStatus = 'complete' | 'partial' | 'failed' | 'stale';

export interface VisibleObject {
  readonly id: string;
  readonly label: string;
  readonly attributes: readonly string[];
  readonly confidence: number;
}

export interface ExtractedTextSpan {
  readonly text: string;
  readonly confidence: number;
  readonly objectId?: string;
}

export type NumericEvidenceKind = 'price' | 'date' | 'count' | 'serial' | 'unit' | 'number';

export interface NumericEvidence {
  readonly kind: NumericEvidenceKind;
  readonly value: string;
  readonly rawText: string;
  readonly confidence: number;
  readonly unit?: string;
  readonly objectId?: string;
}

export interface EvidenceUncertainty {
  readonly overallConfidence: number;
  readonly notes: readonly string[];
}

export interface StructuredImageEvidence {
  readonly id: string;
  readonly conversationId: string;
  readonly imageId: string;
  readonly sourceMessageIds: readonly string[];
  readonly summary: string;
  readonly visibleObjects: readonly VisibleObject[];
  readonly extractedText: readonly ExtractedTextSpan[];
  readonly numericValues: readonly NumericEvidence[];
  readonly uncertainty: EvidenceUncertainty;
  readonly status: StructuredImageEvidenceStatus;
  readonly sourceRevision: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SaveHiddenEvidenceInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly imageId: string;
  readonly sourceMessageIds: readonly string[];
  readonly sourceRevision: string;
  readonly hiddenEvidence: HiddenVisualEvidence;
}

export interface SaveStructuredExtractionInput {
  readonly id?: string;
  readonly conversationId: string;
  readonly imageId: string;
  readonly sourceMessageIds: readonly string[];
  readonly sourceRevision: string;
  readonly extraction: unknown;
}

export interface StructuredImageEvidenceRepositoryDeps {
  readonly now?: () => number;
  readonly createId?: () => string;
}

interface StructuredImageEvidenceRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly image_asset_id: string;
  readonly source_message_ids_json: string;
  readonly summary: string;
  readonly visible_objects_json: string;
  readonly extracted_text_json: string;
  readonly numeric_values_json: string;
  readonly uncertainty_json: string;
  readonly status: StructuredImageEvidenceStatus;
  readonly source_revision: string;
  readonly created_at: number;
  readonly updated_at: number;
}

interface NormalizedExtraction {
  readonly summary: string;
  readonly visibleObjects: readonly VisibleObject[];
  readonly extractedText: readonly ExtractedTextSpan[];
  readonly numericValues: readonly NumericEvidence[];
  readonly uncertainty: EvidenceUncertainty;
  readonly status: 'complete' | 'partial' | 'failed';
}

export class StructuredImageEvidenceRepository {
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(
    private readonly driver: SqliteDriver,
    deps: StructuredImageEvidenceRepositoryDeps = {},
  ) {
    this.now = deps.now ?? Date.now;
    this.createId = deps.createId ?? defaultCreateId;
  }

  saveFromHiddenEvidence(input: SaveHiddenEvidenceInput): StructuredImageEvidence {
    const objectLabels = uniqueStrings(
      input.hiddenEvidence.visibleObjects ?? [input.hiddenEvidence.subjectObject],
    ).slice(0, 12);
    const visibleObjects = objectLabels.map((label, index) => ({
      id: `object-${index + 1}`,
      label,
      attributes:
        index === 0 ? uniqueStrings(input.hiddenEvidence.visibleFeatures).slice(0, 12) : [],
      confidence: confidenceFromUncertainty(input.hiddenEvidence.uncertainty),
    }));
    const unambiguousObjectId = visibleObjects.length === 1 ? visibleObjects[0].id : undefined;
    const normalized: NormalizedExtraction = {
      summary: [
        input.hiddenEvidence.subjectObject,
        input.hiddenEvidence.visibleCondition,
      ].filter((value) => value.trim() !== '').join(' — '),
      visibleObjects,
      extractedText: uniqueStrings(input.hiddenEvidence.visibleText).slice(0, 16).map((text) => ({
        text,
        confidence: confidenceFromUncertainty(input.hiddenEvidence.uncertainty),
        ...(unambiguousObjectId === undefined ? {} : { objectId: unambiguousObjectId }),
      })),
      numericValues: uniqueStrings(input.hiddenEvidence.visibleText).slice(0, 16).flatMap(
        (text) => numericEvidenceFromText(text, unambiguousObjectId),
      ),
      uncertainty: {
        overallConfidence: confidenceFromUncertainty(input.hiddenEvidence.uncertainty),
        notes: [...input.hiddenEvidence.uncertainty],
      },
      status: 'complete',
    };
    return this.saveNormalized({ ...input, extraction: normalized });
  }

  saveExtraction(input: SaveStructuredExtractionInput): StructuredImageEvidence {
    return this.saveNormalized({
      ...input,
      extraction: normalizeExtraction(input.extraction),
    });
  }

  getLatestCompatible(
    imageId: string,
    sourceRevision: string,
  ): StructuredImageEvidence | null {
    const rows = this.driver.getAllSync<StructuredImageEvidenceRow>(
      `SELECT * FROM structured_image_evidence
        WHERE image_asset_id = ? AND status != 'stale'
        ORDER BY created_at DESC, rowid DESC`,
      [imageId],
    );
    const row = rows.find(
      (candidate) =>
        candidate.source_revision === sourceRevision
        || candidate.source_revision.startsWith(`${sourceRevision}:`),
    );
    return row === undefined ? null : toEvidence(row);
  }

  listForImage(imageId: string): StructuredImageEvidence[] {
    return this.driver.getAllSync<StructuredImageEvidenceRow>(
      `SELECT * FROM structured_image_evidence
        WHERE image_asset_id = ?
        ORDER BY created_at DESC, rowid DESC`,
      [imageId],
    ).map(toEvidence);
  }

  invalidateForReinference(imageId: string, nextSourceRevision: string): number {
    return this.driver.runSync(
      `UPDATE structured_image_evidence
          SET status = 'stale', updated_at = ?
        WHERE image_asset_id = ? AND source_revision != ? AND status != 'stale'`,
      [this.now(), imageId, nextSourceRevision],
    ).changes;
  }

  saveTextOnlyRetry(_input: {
    readonly imageId: string;
    readonly sourceMessageId: string;
    readonly text: string;
  }): never {
    throw new Error('A text-only retry cannot claim new visual facts without pixels.');
  }

  private saveNormalized(input: {
    readonly id?: string;
    readonly conversationId: string;
    readonly imageId: string;
    readonly sourceMessageIds: readonly string[];
    readonly sourceRevision: string;
    readonly extraction: NormalizedExtraction;
  }): StructuredImageEvidence {
    const now = this.now();
    const id = input.id ?? this.createId();
    this.driver.runSync(
      `INSERT INTO structured_image_evidence
        (id, conversation_id, image_asset_id, source_message_ids_json, summary,
         visible_objects_json, extracted_text_json, numeric_values_json,
         uncertainty_json, status, source_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.conversationId,
        input.imageId,
        JSON.stringify(uniqueStrings(input.sourceMessageIds)),
        input.extraction.summary,
        JSON.stringify(input.extraction.visibleObjects),
        JSON.stringify(input.extraction.extractedText),
        JSON.stringify(input.extraction.numericValues),
        JSON.stringify(input.extraction.uncertainty),
        input.extraction.status,
        input.sourceRevision,
        now,
        now,
      ],
    );
    return this.require(id);
  }

  private require(id: string): StructuredImageEvidence {
    const row = this.driver.getFirstSync<StructuredImageEvidenceRow>(
      'SELECT * FROM structured_image_evidence WHERE id = ?',
      [id],
    );
    if (row === null) {
      throw new Error(`Structured image evidence was not persisted: ${id}`);
    }
    return toEvidence(row);
  }
}

function normalizeExtraction(value: unknown): NormalizedExtraction {
  if (!isRecord(value)) {
    return failedExtraction();
  }
  const summary = readString(value.summary);
  const visibleObjects = readVisibleObjects(value.visibleObjects);
  const extractedText = readExtractedText(value.extractedText);
  const numericValues = readNumericValues(value.numericValues);
  const uncertainty = readUncertainty(value.uncertainty);
  const allFieldsPresent =
    summary !== null
    && visibleObjects !== null
    && extractedText !== null
    && numericValues !== null
    && uncertainty !== null;
  const anyUsable =
    summary !== null
    || (visibleObjects?.length ?? 0) > 0
    || (extractedText?.length ?? 0) > 0
    || (numericValues?.length ?? 0) > 0;

  if (!anyUsable) {
    return failedExtraction();
  }
  return {
    summary: summary ?? '',
    visibleObjects: visibleObjects ?? [],
    extractedText: extractedText ?? [],
    numericValues: numericValues ?? [],
    uncertainty: uncertainty ?? { overallConfidence: 0.5, notes: ['Incomplete extraction.'] },
    status: allFieldsPresent ? 'complete' : 'partial',
  };
}

function failedExtraction(): NormalizedExtraction {
  return {
    summary: '',
    visibleObjects: [],
    extractedText: [],
    numericValues: [],
    uncertainty: { overallConfidence: 0, notes: ['Structured extraction failed.'] },
    status: 'failed',
  };
}

function numericEvidenceFromText(text: string, objectId?: string): NumericEvidence[] {
  const price = text.match(/[$€£]\s?\d+(?:[.,]\d{1,2})?/);
  if (price !== null) {
    return [{
      kind: 'price',
      value: price[0].replace(/\s/g, ''),
      rawText: text,
      confidence: 0.95,
      ...(objectId === undefined ? {} : { objectId }),
    }];
  }
  const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (date !== null) {
    return [{
      kind: 'date',
      value: date[0],
      rawText: text,
      confidence: 0.9,
      ...(objectId === undefined ? {} : { objectId }),
    }];
  }
  const count = /\bcount\s*[:#]?\s*(\d+)\b/i.exec(text);
  if (count !== null) {
    return [{
      kind: 'count',
      value: count[1],
      rawText: text,
      confidence: 0.9,
      ...(objectId === undefined ? {} : { objectId }),
    }];
  }
  const serial = /\b(?:sn|serial)\s*[:#]?\s*([a-z0-9-]+)\b/i.exec(text);
  if (serial !== null) {
    return [{
      kind: 'serial',
      value: serial[1],
      rawText: text,
      confidence: 0.9,
      ...(objectId === undefined ? {} : { objectId }),
    }];
  }
  return [];
}

function confidenceFromUncertainty(uncertainty: readonly string[]): number {
  return uncertainty.length === 0 ? 1 : Math.max(0.5, 1 - uncertainty.length * 0.1);
}

function toEvidence(row: StructuredImageEvidenceRow): StructuredImageEvidence {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    imageId: row.image_asset_id,
    sourceMessageIds: parseJson(row.source_message_ids_json, isStringArray, []),
    summary: row.summary,
    visibleObjects: parseJson(row.visible_objects_json, isVisibleObjectArray, []),
    extractedText: parseJson(row.extracted_text_json, isExtractedTextArray, []),
    numericValues: parseJson(row.numeric_values_json, isNumericEvidenceArray, []),
    uncertainty: parseJson(
      row.uncertainty_json,
      isEvidenceUncertainty,
      { overallConfidence: 0, notes: ['Malformed uncertainty metadata.'] },
    ),
    status: row.status,
    sourceRevision: row.source_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readVisibleObjects(value: unknown): VisibleObject[] | null {
  return isVisibleObjectArray(value) ? value : null;
}

function readExtractedText(value: unknown): ExtractedTextSpan[] | null {
  return isExtractedTextArray(value) ? value : null;
}

function readNumericValues(value: unknown): NumericEvidence[] | null {
  return isNumericEvidenceArray(value) ? value : null;
}

function readUncertainty(value: unknown): EvidenceUncertainty | null {
  return isEvidenceUncertainty(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function parseJson<T>(
  value: string,
  guard: (candidate: unknown) => candidate is T,
  fallback: T,
): T {
  try {
    const parsed: unknown = JSON.parse(value);
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isVisibleObjectArray(value: unknown): value is VisibleObject[] {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item)
    && typeof item.id === 'string'
    && typeof item.label === 'string'
    && isStringArray(item.attributes)
    && typeof item.confidence === 'number',
  );
}

function isExtractedTextArray(value: unknown): value is ExtractedTextSpan[] {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item)
    && typeof item.text === 'string'
    && typeof item.confidence === 'number'
    && (item.objectId === undefined || typeof item.objectId === 'string'),
  );
}

function isNumericEvidenceArray(value: unknown): value is NumericEvidence[] {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item)
    && isNumericKind(item.kind)
    && typeof item.value === 'string'
    && typeof item.rawText === 'string'
    && typeof item.confidence === 'number'
    && (item.unit === undefined || typeof item.unit === 'string')
    && (item.objectId === undefined || typeof item.objectId === 'string'),
  );
}

function isEvidenceUncertainty(value: unknown): value is EvidenceUncertainty {
  return isRecord(value)
    && typeof value.overallConfidence === 'number'
    && isStringArray(value.notes);
}

function isNumericKind(value: unknown): value is NumericEvidenceKind {
  return (
    value === 'price'
    || value === 'date'
    || value === 'count'
    || value === 'serial'
    || value === 'unit'
    || value === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function defaultCreateId(): string {
  return `structured-evidence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
