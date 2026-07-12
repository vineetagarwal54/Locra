import { Platform } from 'react-native';
import { getTotalMemorySync } from 'react-native-device-info';

import type { DeviceCompatibilityResult } from '../types/models';
import type { StartupRuntimeHost } from '../types/runtime';

// plan.md's 6-8GB RAM target device floor; matches the illustrative reason
// string in data-model.md ("Locra requires at least 6GB").
const MIN_RAM_BYTES = 6 * 1024 * 1024 * 1024;

// Android 13 — confirmed decision (research.md Flagged Risk 2), not the
// project's previously stated API 26.
const MIN_ANDROID_API_LEVEL = 33;

export function checkDeviceCompatibility(): DeviceCompatibilityResult {
  try {
    const osVersion = String(Platform.Version);

    if (Platform.OS !== 'android') {
      return {
        isSupported: false,
        totalMemoryBytes: 0,
        osVersion,
        reason: 'Locra Phase 1 supports Android only.',
      };
    }

    const apiLevel = Number(Platform.Version);
    const totalMemoryBytes = getTotalMemorySync();

    if (apiLevel < MIN_ANDROID_API_LEVEL) {
      return {
        isSupported: false,
        totalMemoryBytes,
        osVersion,
        reason: `Android 13 or newer is required (this device is running API level ${apiLevel}).`,
      };
    }

    if (totalMemoryBytes < MIN_RAM_BYTES) {
      const deviceGb = (totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1);
      return {
        isSupported: false,
        totalMemoryBytes,
        osVersion,
        reason: `This device has ${deviceGb}GB RAM; Locra requires at least 6GB.`,
      };
    }

    return {
      isSupported: true,
      totalMemoryBytes,
      osVersion,
      reason: null,
    };
  } catch {
    return {
      isSupported: false,
      totalMemoryBytes: 0,
      osVersion: 'unknown',
      reason: 'Unable to determine device compatibility.',
    };
  }
}

/**
 * Compatibility-before-load for the runtime selected at startup (Spec 005, T020).
 * The Qwen V1 runtime shares the existing Android 13+/API 33, 6 GB RAM floor
 * (CPU-only, `n_gpu_layers: 0`), so both hosts reuse the same gate; this wrapper
 * makes the active-model check explicit rather than adding a Qwen-only subsystem.
 */
export function checkActiveModelCompatibility(
  runtimeHost: StartupRuntimeHost
): DeviceCompatibilityResult {
  // Both the ExecuTorch and Qwen hosts share the same Android 13+/6 GB floor.
  void runtimeHost;
  return checkDeviceCompatibility();
}
