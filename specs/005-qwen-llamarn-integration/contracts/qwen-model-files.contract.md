# Contract: Qwen Model Files

## Purpose

Defines how the app downloads, verifies, stores, and reuses the two Qwen artifacts using the existing model lifecycle system while preserving the aggregate product-facing `modelStore` UI contract.

## Artifact set

```ts
type QwenArtifactKind = 'language_gguf' | 'multimodal_projector';

interface QwenArtifactDescriptor {
  artifactId: 'qwen_language_model' | 'qwen_multimodal_projector';
  kind: QwenArtifactKind;
  fileName: string;
  quantization: 'Q4_K_M' | 'Q8_0';
  sourceUri: string;
  expectedSha256: string;
  expectedSizeBytes: number;
}

interface QwenArtifactState {
  artifactId: QwenArtifactDescriptor['artifactId'];
  downloadStatus: 'not_started' | 'downloading' | 'paused' | 'downloaded' | 'failed';
  downloadProgress: number;
  integrityVerified: boolean;
  lastVerifiedAt: number | null;
  error: string | null;
}
```

`QwenArtifactState` is internal bundle-manager state. It must not become a separate product-facing Zustand/MMKV store.

## Required artifacts

- Qwen3-VL-2B-Instruct Q4_K_M GGUF language model.
- Qwen3-VL-2B-Instruct Q8_0 multimodal projector.

The Thinking model GGUF and Thinking projector are invalid for this feature.

## Preconditions

- Device compatibility must be checked before starting Qwen setup.
- The supported Qwen V1 platform is Android 13+ / API 33 minimum.
- Downloads must use the existing download UX and writable model directory.
- Artifacts must not be bundled into the APK.
- The product-facing model UI continues to consume the existing aggregate model state contract.

## Postconditions

- Setup is complete only when both artifacts are present with `downloadStatus: downloaded` and `integrityVerified: true`.
- Re-entering setup with verified files present triggers zero downloads.
- Existing LFM2.5 files are not modified during Qwen download or verification.
- A failed verification produces a recoverable error and prevents load.

## Verification rules

- Verify filename, size, and SHA-256 for each artifact independently.
- Verification of the GGUF must not imply projector verification.
- Verification of the projector must not imply GGUF verification.
- A mismatched projector/model pair must fail before load.
- Corrupt artifacts must not be reused as if verified.
- There is no separate `verified` download status. Readiness is represented by `downloadStatus: downloaded` plus `integrityVerified: true`.
