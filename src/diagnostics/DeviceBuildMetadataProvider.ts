import DeviceInfo from 'react-native-device-info';

import type { DeviceBuildMetadata } from '../inference/InferenceQueue';

export function getCurrentDeviceBuildMetadata(): DeviceBuildMetadata {
  const appBuildId = `${DeviceInfo.getVersion()}+${DeviceInfo.getBuildNumber()}`;
  const gitCommitSha = process.env.EXPO_PUBLIC_LOCRA_GIT_COMMIT_SHA?.trim() || 'unknown';
  const gitBranch = process.env.EXPO_PUBLIC_LOCRA_GIT_BRANCH?.trim() || 'unknown';
  const workingTreeState = normalizeWorkingTreeState(
    process.env.EXPO_PUBLIC_LOCRA_WORKTREE_STATE,
  );
  return {
    deviceNameModel: `${DeviceInfo.getBrand()} ${DeviceInfo.getModel()}`,
    appBuildId,
    gitCommitSha,
    gitBranch,
    workingTreeState,
    buildIdentifier:
      process.env.EXPO_PUBLIC_LOCRA_BUILD_IDENTIFIER?.trim()
      || `${appBuildId}:${gitCommitSha.slice(0, 12)}-${workingTreeState}`,
    totalMemoryBytes: readNumericDeviceValue(DeviceInfo.getTotalMemorySync),
    runtimeUsedMemoryBytes: readNumericDeviceValue(DeviceInfo.getUsedMemorySync),
    // react-native-device-info 15 exposes memory and power state, but no Android
    // thermal-status API. Keep this explicitly unavailable instead of guessing.
    thermalState: null,
  };
}

function normalizeWorkingTreeState(
  value: string | undefined,
): 'clean' | 'dirty' | 'unknown' {
  return value === 'clean' || value === 'dirty' ? value : 'unknown';
}

function readNumericDeviceValue(read: () => number): number | null {
  try {
    const value = read();
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}
