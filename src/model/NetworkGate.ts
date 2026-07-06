export type DownloadConnectionType =
  | 'cellular'
  | 'wifi'
  | 'ethernet'
  | 'none'
  | 'unknown'
  | 'other';

export interface NetworkGateStorage {
  set(key: string, value: string | number | boolean | ArrayBuffer): void;
  getBoolean(key: string): boolean | undefined;
}

export interface NetworkGateDeps {
  storage: NetworkGateStorage;
  getConnectionType: () => Promise<DownloadConnectionType>;
}

export type NetworkGateResult =
  | {
      status: 'allowed';
      connectionType: DownloadConnectionType;
      usedPersistedChoice: boolean;
    }
  | {
      status: 'warning';
      connectionType: 'cellular';
    };

const DOWNLOAD_ANYWAY_KEY = 'model:download-anyway-on-cellular';

export async function evaluateNetworkGate({
  storage: gateStorage,
  getConnectionType,
}: NetworkGateDeps): Promise<NetworkGateResult> {
  const connectionType = await getConnectionType();
  const persistedChoice = gateStorage.getBoolean(DOWNLOAD_ANYWAY_KEY) === true;

  if (connectionType === 'cellular' && !persistedChoice) {
    return {
      status: 'warning',
      connectionType,
    };
  }

  return {
    status: 'allowed',
    connectionType,
    usedPersistedChoice: connectionType === 'cellular' && persistedChoice,
  };
}

export function allowCellularDownload(gateStorage: NetworkGateStorage): void {
  gateStorage.set(DOWNLOAD_ANYWAY_KEY, true);
}
