import { QwenInferenceEngineHost } from './QwenInferenceEngineHost';

/**
 * Mounts the sole Locra V1 inference host. Qwen through llama.rn is the only
 * runtime; the host resolves its own artifact paths and registers a
 * runtime-neutral handle. There is no runtime picker or in-process switching.
 */
export function InferenceEngineHost() {
  return <QwenInferenceEngineHost />;
}
