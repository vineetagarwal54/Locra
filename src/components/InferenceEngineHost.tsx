import { useEffect } from 'react';

import { useInferenceEngine } from '../inference/useInferenceEngine';
import type { ModelCandidate } from '../model/ActiveModel';
import { useInferenceStore } from '../store/inferenceStore';

/**
 * Mounts the one sanctioned ExecuTorch hook host and registers its plain handle
 * with the inference store. Screens drive inference through the store only.
 */
interface InferenceEngineHostProps {
  model: ModelCandidate;
}

export function InferenceEngineHost({ model }: InferenceEngineHostProps) {
  const registerEngine = useInferenceStore((s) => s.registerEngine);
  const engine = useInferenceEngine(model);

  useEffect(() => {
    registerEngine(engine);
    return () => registerEngine(null);
  }, [engine, registerEngine]);

  return null;
}
