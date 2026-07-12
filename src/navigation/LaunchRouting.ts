import type { ModelDownloadStatus } from '../types/models';

export type LaunchRoute =
  | 'Welcome'
  | 'ModelIntro'
  | 'DownloadProgress'
  | 'Chat';

export interface LaunchRoutingState {
  readonly welcomeCompleted: boolean;
  readonly modelReady: boolean;
  readonly downloadStatus: ModelDownloadStatus;
}

export function resolveLaunchRoute(state: LaunchRoutingState): LaunchRoute {
  if (!state.welcomeCompleted) {
    return 'Welcome';
  }
  if (state.modelReady) {
    return 'Chat';
  }
  return state.downloadStatus === 'downloading' || state.downloadStatus === 'paused'
    ? 'DownloadProgress'
    : 'ModelIntro';
}
