import type { MicrophonePermissionAdapter } from './VoiceModelLifecycle';

export const voicePermissionAdapter: MicrophonePermissionAdapter = {
  request: async (): Promise<boolean> => false,
};
