import { sha256 } from 'js-sha256';

import type { ArtifactIntegrity, VerifiedArtifact } from './ModelDownloadManager';

export const MODEL_VERIFICATION_SCHEMA_VERSION = 1;

export interface VerifiedArtifactRecord {
  artifactId: string;
  fileName: string;
  expectedSize: number;
  expectedSha256: string;
  verifiedSize: number;
}

export interface ModelVerificationRecord {
  schemaVersion: number;
  modelId: string;
  manifestFingerprint: string;
  verifiedAt: number;
  artifacts: VerifiedArtifactRecord[];
}

export interface ResolvedArtifactManifest {
  artifact: VerifiedArtifact;
  integrity: ArtifactIntegrity;
}

export function createManifestFingerprint(
  modelId: string,
  artifacts: ReadonlyArray<ResolvedArtifactManifest>,
): string {
  const canonical = artifacts
    .map(({ artifact, integrity }) => ({
      artifactId: artifact.artifactId,
      fileName: artifact.fileName,
      expectedSize: integrity.expectedSize,
      expectedSha256: integrity.expectedSha256.trim().toLowerCase(),
    }))
    .sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  return sha256(JSON.stringify({ modelId, artifacts: canonical }));
}

export function parseVerificationRecord(value: string | null): ModelVerificationRecord | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isVerificationRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isRecordCurrent(
  record: ModelVerificationRecord,
  modelId: string,
  fingerprint: string,
  artifacts: ReadonlyArray<ResolvedArtifactManifest>,
): boolean {
  if (
    record.schemaVersion !== MODEL_VERIFICATION_SCHEMA_VERSION ||
    record.modelId !== modelId ||
    record.manifestFingerprint !== fingerprint ||
    record.artifacts.length !== artifacts.length
  ) {
    return false;
  }
  return artifacts.every(({ artifact, integrity }) => record.artifacts.some((entry) =>
    entry.artifactId === artifact.artifactId &&
    entry.fileName === artifact.fileName &&
    entry.expectedSize === integrity.expectedSize &&
    entry.verifiedSize === integrity.expectedSize &&
    entry.expectedSha256.toLowerCase() === integrity.expectedSha256.toLowerCase()
  ));
}

function isVerificationRecord(value: unknown): value is ModelVerificationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ModelVerificationRecord>;
  return Number.isInteger(record.schemaVersion) &&
    typeof record.modelId === 'string' &&
    typeof record.manifestFingerprint === 'string' &&
    typeof record.verifiedAt === 'number' &&
    Array.isArray(record.artifacts) &&
    record.artifacts.every(isArtifactRecord);
}

function isArtifactRecord(value: unknown): value is VerifiedArtifactRecord {
  if (typeof value !== 'object' || value === null) return false;
  const artifact = value as Partial<VerifiedArtifactRecord>;
  return typeof artifact.artifactId === 'string' &&
    typeof artifact.fileName === 'string' &&
    typeof artifact.expectedSize === 'number' &&
    typeof artifact.expectedSha256 === 'string' &&
    typeof artifact.verifiedSize === 'number';
}
