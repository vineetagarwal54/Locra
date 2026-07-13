import {
  QWEN3_VL_2B_INSTRUCT_BUNDLE,
  QWEN3_VL_2B_INSTRUCT_MODEL_ID,
} from './ModelArtifactManifest';

// Locra V1 runs a single on-device model: Qwen3-VL-2B-Instruct through llama.rn.


export type ModelCandidateId = typeof QWEN3_VL_2B_INSTRUCT_MODEL_ID;

export interface ModelIntegrityFallback {
  expectedSha256: string;
  expectedSize: number;
}

export interface ModelCandidate {
  readonly id: ModelCandidateId;
  readonly displayName: string;
  readonly description: string;
  readonly generationConfigId: string;
  /** Aggregate download size of the Qwen bundle (language GGUF + projector). */
  readonly integrityFallback: ModelIntegrityFallback;
}

const QWEN_TOTAL_BYTES = QWEN3_VL_2B_INSTRUCT_BUNDLE.artifacts.reduce(
  (sum, artifact) => sum + artifact.expectedSizeBytes,
  0
);

const QWEN_CANDIDATE: ModelCandidate = {
  id: QWEN3_VL_2B_INSTRUCT_MODEL_ID,
  displayName: 'Locra V1',
  description: 'On-device vision-language model running fully offline.',
  generationConfigId: 'qwen3-vl-2b-instruct-llamarn-v1',
  integrityFallback: {
    // Per-artifact SHA-256 is pinned in the artifact manifest and verified
    // independently; the bundle carries no single aggregate digest.
    expectedSha256: '',
    expectedSize: QWEN_TOTAL_BYTES,
  },
};

export const MODEL_CANDIDATES: ReadonlyArray<ModelCandidate> = [QWEN_CANDIDATE];

export function getModelCandidate(id: ModelCandidateId): ModelCandidate {
  void id;
  return QWEN_CANDIDATE;
}

export function isModelCandidateId(raw: string): raw is ModelCandidateId {
  return raw === QWEN3_VL_2B_INSTRUCT_MODEL_ID;
}

/** No developer model override exists in the single-runtime V1 build. */
export function resolveDeveloperModelOverride(_raw: string | undefined): ModelCandidate | null {
  return null;
}

// ── Qwen internal V1 descriptor ──────────────────────────────────────────────

export interface QwenInternalModelDescriptor {
  readonly id: typeof QWEN3_VL_2B_INSTRUCT_MODEL_ID;
  readonly runtime: 'llama.rn';
  readonly displayName: string;
  readonly description: string;
  /** Safe aggregate generation-config id for diagnostics; not a raw native internal. */
  readonly generationConfigId: string;
  readonly enabledBy: 'default_v1';
  readonly requiredArtifactIds: ReadonlyArray<string>;
}

export const QWEN_V1_DESCRIPTOR: QwenInternalModelDescriptor = {
  id: QWEN3_VL_2B_INSTRUCT_MODEL_ID,
  runtime: 'llama.rn',
  displayName: QWEN_CANDIDATE.displayName,
  description: QWEN_CANDIDATE.description,
  generationConfigId: QWEN_CANDIDATE.generationConfigId,
  enabledBy: 'default_v1',
  requiredArtifactIds: QWEN3_VL_2B_INSTRUCT_BUNDLE.artifacts.map((artifact) => artifact.artifactId),
};

/** The active V1 model id, tied to the exact Qwen artifact manifest. */
export const ACTIVE_V1_MODEL_ID = QWEN3_VL_2B_INSTRUCT_MODEL_ID;

/** The active model id for the startup-selected runtime (always Qwen in V1). */
export function resolveActiveModelId(): string {
  return ACTIVE_V1_MODEL_ID;
}

