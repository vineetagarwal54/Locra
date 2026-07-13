import { readFileSync } from 'fs';
import { join } from 'path';

import {
  QWEN_LLAMA_RN_VERSION,
  QWEN_RUNTIME_CONFIG,
  buildQwenInitLlamaParams,
  buildQwenInitMultimodalParams,
} from '../../../src/inference/llamaRn/QwenRuntimeConfig';
import { getResponseTokenBudget } from '../../../src/inference/ResponseMode';

// Pins the exact spike-validated CPU-only Qwen runtime config. Any drift from
// these values must be a deliberate, separately-justified change.

describe('Qwen runtime config', () => {
  it('pins the exact spike-tested llama.rn version', () => {
    expect(QWEN_LLAMA_RN_VERSION).toBe('0.12.5');
  });

  it('matches package.json and app.json to the pinned llama.rn version', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    expect(pkg.dependencies['llama.rn']).toBe('0.12.5');

    const appJson = readFileSync(join(process.cwd(), 'app.json'), 'utf8');
    expect(appJson).toContain('llama.rn');
  });

  it('is CPU-only on both the language model and the projector', () => {
    expect(QWEN_RUNTIME_CONFIG.nGpuLayers).toBe(0);
    expect(QWEN_RUNTIME_CONFIG.projectorUseGpu).toBe(false);
  });

  it('uses the spike-validated context and sampling baseline', () => {
    expect(QWEN_RUNTIME_CONFIG.nCtx).toBe(4096);
    expect(QWEN_RUNTIME_CONFIG.ctxShift).toBe(false);
    expect(QWEN_RUNTIME_CONFIG.useMlock).toBe(false);
    expect(QWEN_RUNTIME_CONFIG.temperature).toBe(0);
    expect(QWEN_RUNTIME_CONFIG.stopTokens).toEqual([]);
  });

  it('builds CPU-only initLlama params from a model path', () => {
    expect(buildQwenInitLlamaParams('/models/qwen.gguf')).toEqual({
      model: '/models/qwen.gguf',
      n_ctx: 4096,
      n_gpu_layers: 0,
      ctx_shift: false,
      use_mlock: false,
    });
  });

  it('builds CPU-only initMultimodal params from a projector path', () => {
    expect(buildQwenInitMultimodalParams('/models/mmproj.gguf')).toEqual({
      path: '/models/mmproj.gguf',
      use_gpu: false,
    });
  });

  it('uses the response-mode budgets as the only output token limits', () => {
    expect(getResponseTokenBudget('Low')).toBe(192);
    expect(getResponseTokenBudget('Medium')).toBe(384);
    expect(getResponseTokenBudget('High')).toBe(768);
  });
});
