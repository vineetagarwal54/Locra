import type { StartupRuntimeHost } from '../types/runtime';

export type { StartupRuntimeHost };

export interface StartupRuntimeSelection {
  readonly selectedHost: StartupRuntimeHost;
  readonly source: 'default';
  readonly processLocked: true;
}

// Qwen3-VL-2B-Instruct through llama.rn is the only Locra V1 inference runtime.
// There is no runtime picker, no in-process switching, and no ExecuTorch
// fallback — the selection is a fixed, process-locked constant.
const STARTUP_SELECTION: StartupRuntimeSelection = {
  selectedHost: 'qwen-llamarn',
  source: 'default',
  processLocked: true,
};

export function getStartupRuntimeSelection(): StartupRuntimeSelection {
  return STARTUP_SELECTION;
}
