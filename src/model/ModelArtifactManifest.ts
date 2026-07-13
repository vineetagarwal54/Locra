// Generalized model-artifact bundle manifest (Spec 005, T016).
//
// This replaces the implicit ".pte is the model" readiness assumption with an
// EXACT manifest of independently-verified artifacts. A bundle is ready only
// when every artifact it lists is present AND integrity-verified — "any .gguf
// exists" (or "any .pte exists") is never readiness.
//
// The pinned Qwen3-VL-2B-Instruct descriptors below come from the approved
// Instruct source recorded in implementation-audit.md (Hugging Face
// `Qwen/Qwen3-VL-2B-Instruct-GGUF`, commit
// 52d6c8ffea26cc873ac5ad116f8631268d7eb503) — NOT from the Thinking spike.
// Thinking filenames/digests are explicitly invalid for this feature.

export type ModelArtifactKind = 'language_gguf' | 'multimodal_projector';

export type ModelArtifactQuantization = 'Q4_K_M' | 'Q8_0';

export interface ModelArtifactDescriptor {
  /** Stable internal id for one required file. */
  readonly artifactId: string;
  readonly kind: ModelArtifactKind;
  /** Exact expected local filename; used to locate the file on disk / in fetch results. */
  readonly fileName: string;
  readonly quantization?: ModelArtifactQuantization;
  /** Download source consumed by the existing download system. */
  readonly sourceUri: string;
  readonly expectedSha256: string;
  readonly expectedSizeBytes: number;
}

export interface ModelArtifactBundleManifest {
  /** The exact active model id this bundle satisfies (never a Thinking id). */
  readonly activeModelId: string;
  readonly artifacts: ReadonlyArray<ModelArtifactDescriptor>;
}

/** Per-artifact readiness projected from the internal bundle-manager state. */
export interface ArtifactReadiness {
  readonly artifactId: string;
  readonly downloaded: boolean;
  readonly integrityVerified: boolean;
}

// ── Qwen3-VL-2B-Instruct bundle (approved Instruct artifacts) ────────────────

export const QWEN3_VL_2B_INSTRUCT_MODEL_ID = 'QWEN3_VL_2B_INSTRUCT_Q4_K_M';

const QWEN_INSTRUCT_RESOLVE_BASE =
  'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/52d6c8ffea26cc873ac5ad116f8631268d7eb503';

export const QWEN_LANGUAGE_ARTIFACT: ModelArtifactDescriptor = {
  artifactId: 'qwen_language_model',
  kind: 'language_gguf',
  fileName: 'Qwen3VL-2B-Instruct-Q4_K_M.gguf',
  quantization: 'Q4_K_M',
  sourceUri: `${QWEN_INSTRUCT_RESOLVE_BASE}/Qwen3VL-2B-Instruct-Q4_K_M.gguf`,
  expectedSha256: '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae',
  expectedSizeBytes: 1_107_409_952,
};

export const QWEN_PROJECTOR_ARTIFACT: ModelArtifactDescriptor = {
  artifactId: 'qwen_multimodal_projector',
  kind: 'multimodal_projector',
  fileName: 'mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf',
  quantization: 'Q8_0',
  sourceUri: `${QWEN_INSTRUCT_RESOLVE_BASE}/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf`,
  expectedSha256: 'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82',
  expectedSizeBytes: 445_053_216,
};

export const QWEN3_VL_2B_INSTRUCT_BUNDLE: ModelArtifactBundleManifest = {
  activeModelId: QWEN3_VL_2B_INSTRUCT_MODEL_ID,
  artifacts: [QWEN_LANGUAGE_ARTIFACT, QWEN_PROJECTOR_ARTIFACT],
};

// Thinking-variant filenames the Instruct integration must reject if they ever
// appear where an Instruct artifact is expected (data-model.md validation rule).
const INVALID_THINKING_FILENAMES: ReadonlyArray<string> = [
  'Qwen3VL-2B-Thinking-Q4_K_M.gguf',
  'mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf',
];

export function isInvalidThinkingArtifactFilename(fileName: string): boolean {
  return INVALID_THINKING_FILENAMES.includes(fileName);
}

/** A single artifact is ready only when it is both downloaded and integrity-verified. */
export function isArtifactReady(readiness: ArtifactReadiness): boolean {
  return readiness.downloaded && readiness.integrityVerified;
}

/**
 * A bundle is ready only when EVERY manifest artifact is independently ready.
 * Verification of one artifact never implies verification of another.
 */
export function isBundleReady(
  manifest: ModelArtifactBundleManifest,
  states: ReadonlyArray<ArtifactReadiness>
): boolean {
  return manifest.artifacts.every((artifact) => {
    const state = states.find((entry) => entry.artifactId === artifact.artifactId);
    return state !== undefined && isArtifactReady(state);
  });
}

/**
 * Independent, exact match of an on-disk file against one descriptor. Filename,
 * byte size, and SHA-256 must all match; a match on one field never stands in
 * for another (a mismatched projector/model pair must fail before load).
 */
export function matchesArtifactDescriptor(
  descriptor: ModelArtifactDescriptor,
  actual: { fileName: string; sizeBytes: number; sha256: string }
): boolean {
  return (
    actual.fileName === descriptor.fileName &&
    actual.sizeBytes === descriptor.expectedSizeBytes &&
    actual.sha256.trim().toLowerCase() === descriptor.expectedSha256.toLowerCase()
  );
}
