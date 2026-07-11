import DeviceInfo from 'react-native-device-info';

import type { DeviceBuildMetadata } from '../inference/InferenceQueue';

export function getCurrentDeviceBuildMetadata(): DeviceBuildMetadata {
  return {
    deviceNameModel: `${DeviceInfo.getBrand()} ${DeviceInfo.getModel()}`,
    appBuildId: `${DeviceInfo.getVersion()}+${DeviceInfo.getBuildNumber()}`,
  };
}
