import { getNetworkStateAsync, NetworkStateType } from 'expo-network';

import type { DownloadConnectionType } from '../model/NetworkGate';

export async function getDownloadConnectionType(): Promise<DownloadConnectionType> {
  try {
    const state = await getNetworkStateAsync();
    switch (state.type) {
      case NetworkStateType.CELLULAR:
        return 'cellular';
      case NetworkStateType.WIFI:
        return 'wifi';
      case NetworkStateType.ETHERNET:
        return 'ethernet';
      case NetworkStateType.NONE:
        return 'none';
      case NetworkStateType.UNKNOWN:
        return 'unknown';
      default:
        return 'other';
    }
  } catch {
    return 'unknown';
  }
}
