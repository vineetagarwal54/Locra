import {
  QWEN3_VL_2B_INSTRUCT_BUNDLE,
  QWEN3_VL_2B_INSTRUCT_MODEL_ID,
  QWEN_LANGUAGE_ARTIFACT,
  QWEN_PROJECTOR_ARTIFACT,
  isArtifactReady,
  isBundleReady,
  isInvalidThinkingArtifactFilename,
  matchesArtifactDescriptor,
  type ArtifactReadiness,
} from '../../../src/model/ModelArtifactManifest';

// The manifest pins the EXACT approved Qwen3-VL-2B-Instruct artifacts recorded
// in implementation-audit.md. These values are the load-time trust anchor;
// neither a Thinking file nor an arbitrary .gguf is acceptable.

describe('Qwen artifact bundle manifest', () => {
  it('pins the exact active model id', () => {
    expect(QWEN3_VL_2B_INSTRUCT_MODEL_ID).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
    expect(QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
  });

  it('lists exactly the language GGUF and the Q8_0 projector', () => {
    expect(QWEN3_VL_2B_INSTRUCT_BUNDLE.artifacts).toHaveLength(2);
    expect(QWEN3_VL_2B_INSTRUCT_BUNDLE.artifacts.map((a) => a.artifactId)).toEqual([
      'qwen_language_model',
      'qwen_multimodal_projector',
    ]);
  });

  it('pins the language model filename, quantization, size, and SHA-256 from the Instruct source', () => {
    expect(QWEN_LANGUAGE_ARTIFACT.fileName).toBe('Qwen3VL-2B-Instruct-Q4_K_M.gguf');
    expect(QWEN_LANGUAGE_ARTIFACT.kind).toBe('language_gguf');
    expect(QWEN_LANGUAGE_ARTIFACT.quantization).toBe('Q4_K_M');
    expect(QWEN_LANGUAGE_ARTIFACT.expectedSizeBytes).toBe(1_107_409_952);
    expect(QWEN_LANGUAGE_ARTIFACT.expectedSha256).toBe(
      '089d75c52f4b7ffc56ba998ffc50aae89fcafc755f9e7208aacca281dca6c2ae'
    );
    expect(QWEN_LANGUAGE_ARTIFACT.sourceUri).toContain(
      '52d6c8ffea26cc873ac5ad116f8631268d7eb503'
    );
    expect(QWEN_LANGUAGE_ARTIFACT.sourceUri).toContain('Qwen3-VL-2B-Instruct-GGUF');
  });

  it('pins the Q8_0 projector filename, quantization, size, and SHA-256 from the Instruct source', () => {
    expect(QWEN_PROJECTOR_ARTIFACT.fileName).toBe('mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf');
    expect(QWEN_PROJECTOR_ARTIFACT.kind).toBe('multimodal_projector');
    expect(QWEN_PROJECTOR_ARTIFACT.quantization).toBe('Q8_0');
    expect(QWEN_PROJECTOR_ARTIFACT.expectedSizeBytes).toBe(445_053_216);
    expect(QWEN_PROJECTOR_ARTIFACT.expectedSha256).toBe(
      'f9a68fabba69c3b81e153367b2c7521030b0fa8bb0de400c9599c8e6725f9c82'
    );
    expect(QWEN_PROJECTOR_ARTIFACT.sourceUri).toContain(
      '52d6c8ffea26cc873ac5ad116f8631268d7eb503'
    );
  });

  it('rejects the Thinking-variant filenames as invalid for this feature', () => {
    expect(isInvalidThinkingArtifactFilename('Qwen3VL-2B-Thinking-Q4_K_M.gguf')).toBe(true);
    expect(isInvalidThinkingArtifactFilename('mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf')).toBe(true);
    expect(isInvalidThinkingArtifactFilename(QWEN_LANGUAGE_ARTIFACT.fileName)).toBe(false);
    expect(isInvalidThinkingArtifactFilename(QWEN_PROJECTOR_ARTIFACT.fileName)).toBe(false);
  });

  describe('independent verification', () => {
    const ready = (artifactId: string): ArtifactReadiness => ({
      artifactId,
      downloaded: true,
      integrityVerified: true,
    });

    it('treats an artifact as ready only when downloaded AND verified', () => {
      expect(isArtifactReady({ artifactId: 'x', downloaded: true, integrityVerified: true })).toBe(true);
      expect(isArtifactReady({ artifactId: 'x', downloaded: true, integrityVerified: false })).toBe(false);
      expect(isArtifactReady({ artifactId: 'x', downloaded: false, integrityVerified: true })).toBe(false);
    });

    it('is not bundle-ready when only the language model is verified', () => {
      expect(isBundleReady(QWEN3_VL_2B_INSTRUCT_BUNDLE, [ready('qwen_language_model')])).toBe(false);
    });

    it('is not bundle-ready when only the projector is verified', () => {
      expect(isBundleReady(QWEN3_VL_2B_INSTRUCT_BUNDLE, [ready('qwen_multimodal_projector')])).toBe(false);
    });

    it('is bundle-ready only when both artifacts are independently verified', () => {
      expect(
        isBundleReady(QWEN3_VL_2B_INSTRUCT_BUNDLE, [
          ready('qwen_language_model'),
          ready('qwen_multimodal_projector'),
        ])
      ).toBe(true);
    });

    it('matches a descriptor only when filename, size, and SHA-256 all agree', () => {
      const good = {
        fileName: QWEN_LANGUAGE_ARTIFACT.fileName,
        sizeBytes: QWEN_LANGUAGE_ARTIFACT.expectedSizeBytes,
        sha256: QWEN_LANGUAGE_ARTIFACT.expectedSha256.toUpperCase(),
      };
      expect(matchesArtifactDescriptor(QWEN_LANGUAGE_ARTIFACT, good)).toBe(true);
      expect(matchesArtifactDescriptor(QWEN_LANGUAGE_ARTIFACT, { ...good, sizeBytes: 1 })).toBe(false);
      expect(matchesArtifactDescriptor(QWEN_LANGUAGE_ARTIFACT, { ...good, sha256: 'deadbeef' })).toBe(false);
      // A projector file must never satisfy the language descriptor.
      expect(
        matchesArtifactDescriptor(QWEN_LANGUAGE_ARTIFACT, {
          fileName: QWEN_PROJECTOR_ARTIFACT.fileName,
          sizeBytes: QWEN_PROJECTOR_ARTIFACT.expectedSizeBytes,
          sha256: QWEN_PROJECTOR_ARTIFACT.expectedSha256,
        })
      ).toBe(false);
    });
  });
});
