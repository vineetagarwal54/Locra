import { useEffect } from 'react';

import { useInferenceEngine } from '../inference/useInferenceEngine';
import { useInferenceStore } from '../store/inferenceStore';

/**
 * Mounts the one sanctioned ExecuTorch hook host and registers its plain handle
 * with the inference store. Screens drive inference through the store only.
 */
export function InferenceEngineHost() {
  const registerEngine = useInferenceStore((s) => s.registerEngine);
  const engine = useInferenceEngine();

  useEffect(() => {
    registerEngine(engine);
    return () => registerEngine(null);
  }, [engine, registerEngine]);

  return null;
}
