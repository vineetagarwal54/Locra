import {
  ACTIVE_V1_MODEL_ID,
  MODEL_CANDIDATES,
  QWEN_V1_DESCRIPTOR,
  getModelCandidate,
  isModelCandidateId,
  resolveDeveloperModelOverride,
} from '../../../src/model/ActiveModel';

// Locra V1 has a single on-device model: Qwen3-VL-2B-Instruct via llama.rn. There
// is no ExecuTorch runtime and no multi-model registry.

describe('model candidate registry (Qwen-only V1)', () => {
  it('exposes exactly one candidate: the active Qwen V1 model', () => {
    expect(MODEL_CANDIDATES).toHaveLength(1);
    expect(MODEL_CANDIDATES[0].id).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
    expect(ACTIVE_V1_MODEL_ID).toBe('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
  });

  it('resolves the Qwen candidate and its aggregate download size', () => {
    const candidate = getModelCandidate('QWEN3_VL_2B_INSTRUCT_Q4_K_M');
    expect(candidate.displayName).toBe('Locra V1');
    expect(candidate.generationConfigId).toBe('qwen3-vl-2b-instruct-llamarn-v1');
    // Aggregate of the language GGUF + Q8_0 projector bytes.
    expect(candidate.integrityFallback.expectedSize).toBe(1_107_409_952 + 445_053_216);
  });

  it('recognizes only the Qwen model id', () => {
    expect(isModelCandidateId('QWEN3_VL_2B_INSTRUCT_Q4_K_M')).toBe(true);
    expect(isModelCandidateId('LFM2_5_VL_1_6B_QUANTIZED')).toBe(false);
    expect(isModelCandidateId('anything-else')).toBe(false);
  });

  it('has no developer model override in the single-runtime build', () => {
    expect(resolveDeveloperModelOverride(undefined)).toBeNull();
    expect(resolveDeveloperModelOverride('gemma4_e2b')).toBeNull();
  });

  it('ties the Qwen descriptor to the exact artifact manifest', () => {
    expect(QWEN_V1_DESCRIPTOR.runtime).toBe('llama.rn');
    expect(QWEN_V1_DESCRIPTOR.enabledBy).toBe('default_v1');
    expect(QWEN_V1_DESCRIPTOR.requiredArtifactIds).toEqual([
      'qwen_language_model',
      'qwen_multimodal_projector',
    ]);
  });
});
