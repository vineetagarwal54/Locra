import type { ModelSetupPhase } from '../types/models';

export type LaunchRoute =
  | 'Welcome'
  | 'ModelIntro'
  | 'DownloadProgress'
  | 'Chat';

export interface LaunchRoutingState {
  readonly welcomeCompleted: boolean;
  readonly setupPhase: ModelSetupPhase;
}

export function resolveLaunchRoute(state: LaunchRoutingState): LaunchRoute {
  if (!state.welcomeCompleted) {
    return 'Welcome';
  }
  if (state.setupPhase === 'ready') {
    return 'Chat';
  }
  return state.setupPhase === 'downloading' || state.setupPhase === 'paused' || state.setupPhase === 'verifying'
    ? 'DownloadProgress'
    : 'ModelIntro';
}
