import { PermissionsAndroid } from 'react-native';

import type { MicrophonePermissionAdapter } from './VoiceModelLifecycle';

export const voicePermissionAdapter: MicrophonePermissionAdapter = {
  request: async (): Promise<boolean> =>
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO) ===
    PermissionsAndroid.RESULTS.GRANTED,
};
