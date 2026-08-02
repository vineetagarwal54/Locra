import DeviceInfo from 'react-native-device-info';

import type { DeviceBuildMetadata } from '../inference/InferenceQueue';

import { BUILD_PROVENANCE } from './buildProvenance';

const UNKNOWN = 'unknown';

/** Empty/whitespace build-provenance strings degrade to the explicit fallback. */
function normalize(value: string): string {
  return value.trim() === '' ? UNKNOWN : value;
}

export function getCurrentDeviceBuildMetadata(): DeviceBuildMetadata {
  return {
    deviceNameModel: `${DeviceInfo.getBrand()} ${DeviceInfo.getModel()}`,
    appBuildId: `${DeviceInfo.getVersion()}+${DeviceInfo.getBuildNumber()}`,
    gitCommitSha: normalize(BUILD_PROVENANCE.gitCommitSha),
    gitBranch: normalize(BUILD_PROVENANCE.gitBranch),
    // Preserved as-is: `null` means the dirty state was genuinely unknown at build.
    gitDirty: BUILD_PROVENANCE.gitDirty,
  };
}
