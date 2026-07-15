import type { ModelSetupPhase } from '../types/models';

export type InferenceReadiness =
  | { ready: true }
  | {
      ready: false;
      reason: 'checking' | 'not_installed' | 'downloading' | 'verifying' | 'failed';
      message: string;
      recoveryAction: 'wait' | 'open_setup' | 'retry_check' | 'redownload';
    };

export function getInferenceReadiness(state: {
  setupPhase: ModelSetupPhase;
  integrityVerified: boolean;
}): InferenceReadiness {
  if (state.setupPhase === 'ready' && state.integrityVerified) return { ready: true };
  switch (state.setupPhase) {
    case 'checking':
      return blocked('checking', 'Checking the on-device model…', 'wait');
    case 'not_installed':
      return blocked('not_installed', 'The on-device model needs to be downloaded.', 'open_setup');
    case 'preparing':
    case 'downloading':
      return blocked('downloading', 'The on-device model is still downloading.', 'wait');
    case 'paused':
      return blocked('downloading', 'The model download is paused.', 'open_setup');
    case 'verifying':
      return blocked('verifying', 'Locra is verifying the on-device model.', 'wait');
    case 'failed':
      return blocked('failed', 'Model setup needs attention before inference can start.', 'redownload');
    case 'ready':
      return blocked('failed', 'The model could not be verified.', 'retry_check');
  }
}

function blocked(
  reason: Exclude<InferenceReadiness, { ready: true }>['reason'],
  message: string,
  recoveryAction: Exclude<InferenceReadiness, { ready: true }>['recoveryAction'],
): InferenceReadiness {
  return { ready: false, reason, message, recoveryAction };
}
