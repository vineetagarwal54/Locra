// Qwen3-VL-2B-Instruct llama.rn runtime configuration (Spec 005, T026).
//
// These constants are the EXACT spike-validated CPU-only baseline recorded in
// implementation-audit.md. The spike is used only for llama.rn lifecycle and
// configuration patterns — never for Thinking-model behavior. GPU is disabled
// on both the language model (`nGpuLayers: 0`) and the projector
// (`projectorUseGpu: false`); the Qwen3-VL Q4_K_M + Q8_0 projector hangs on the
// OpenCL vision path, so V1 is CPU-only.

/** The exact spike-tested llama.rn version. Pinned, never resolved to a newer release. */
export const QWEN_LLAMA_RN_VERSION = '0.12.5';

export interface QwenRuntimeConfig {
  readonly nCtx: number;
  readonly nGpuLayers: number;
  readonly projectorUseGpu: boolean;
  readonly ctxShift: boolean;
  readonly useMlock: boolean;
  readonly temperature: number;
  /** Empty unless a later verification record justifies explicit stop tokens. */
  readonly stopTokens: ReadonlyArray<string>;
}

export const QWEN_RUNTIME_CONFIG: QwenRuntimeConfig = {
  nCtx: 4096,
  nGpuLayers: 0,
  projectorUseGpu: false,
  ctxShift: false,
  useMlock: false,
  temperature: 0,
  stopTokens: [],
};

/** llama.rn `initLlama` parameters for the language model (CPU-only). */
export interface QwenInitLlamaParams {
  readonly model: string;
  readonly n_ctx: number;
  readonly n_gpu_layers: number;
  readonly ctx_shift: boolean;
  readonly use_mlock: boolean;
}

export function buildQwenInitLlamaParams(
  modelPath: string,
  config: QwenRuntimeConfig = QWEN_RUNTIME_CONFIG
): QwenInitLlamaParams {
  return {
    model: modelPath,
    n_ctx: config.nCtx,
    n_gpu_layers: config.nGpuLayers,
    ctx_shift: config.ctxShift,
    use_mlock: config.useMlock,
  };
}

/** llama.rn `initMultimodal` parameters for the projector (CPU-only). */
export interface QwenInitMultimodalParams {
  readonly path: string;
  readonly use_gpu: boolean;
}

export function buildQwenInitMultimodalParams(
  projectorPath: string,
  config: QwenRuntimeConfig = QWEN_RUNTIME_CONFIG
): QwenInitMultimodalParams {
  return {
    path: projectorPath,
    use_gpu: config.projectorUseGpu,
  };
}
