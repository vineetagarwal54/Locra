import { useEffect } from 'react';

import { registerInferenceEngine } from '../inference/InferenceEngineRegistry';
import { useQwenInferenceEngine } from '../inference/llamaRn/useQwenInferenceEngine';
import { getQwenArtifactPaths } from '../store/modelStore';

/**
 * Owns the sole Qwen llama.rn hook and registers its runtime-neutral handle.
 * All Qwen-specific hook calls live inside this host, so the parent selector
 * never conditionally calls a different runtime hook.
 */
export function QwenInferenceEngineHost() {
  const engine = useQwenInferenceEngine(getQwenArtifactPaths());

  useEffect(() => {
    registerInferenceEngine(engine);
    return () => registerInferenceEngine(null);
  }, [engine]);

  return null;
}
