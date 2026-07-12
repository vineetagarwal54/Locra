import { useEffect } from 'react';

import { useQwenInferenceEngine } from '../inference/llamaRn/useQwenInferenceEngine';
import { useInferenceStore } from '../store/inferenceStore';
import { getQwenArtifactPaths } from '../store/modelStore';

/**
 * Owns the sole Qwen llama.rn hook and registers its runtime-neutral handle.
 * All Qwen-specific hook calls live inside this host, so the parent selector
 * never conditionally calls a different runtime hook.
 */
export function QwenInferenceEngineHost() {
  const registerEngine = useInferenceStore((state) => state.registerEngine);
  const engine = useQwenInferenceEngine(getQwenArtifactPaths());

  useEffect(() => {
    registerEngine(engine);
    return () => registerEngine(null);
  }, [engine, registerEngine]);

  return null;
}
