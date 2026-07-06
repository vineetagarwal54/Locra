import {
  allowCellularDownload,
  evaluateNetworkGate,
  type NetworkGateStorage,
} from '../../../src/model/NetworkGate';

class TestNetworkGateStorage implements NetworkGateStorage {
  private readonly values = new Map<string, string | number | boolean | ArrayBuffer>();

  set(key: string, value: string | number | boolean | ArrayBuffer): void {
    this.values.set(key, value);
  }

  getBoolean(key: string): boolean | undefined {
    const value = this.values.get(key);
    return typeof value === 'boolean' ? value : undefined;
  }
}

function makeStorage(): TestNetworkGateStorage {
  return new TestNetworkGateStorage();
}

describe('NetworkGate', () => {
  it('returns a warning state on cellular instead of silently downloading or blocking', async () => {
    const storage = makeStorage();

    await expect(
      evaluateNetworkGate({
        storage,
        getConnectionType: async () => 'cellular',
      })
    ).resolves.toEqual({
      status: 'warning',
      connectionType: 'cellular',
    });
  });

  it('allows download without a warning on WiFi', async () => {
    const storage = makeStorage();

    await expect(
      evaluateNetworkGate({
        storage,
        getConnectionType: async () => 'wifi',
      })
    ).resolves.toEqual({
      status: 'allowed',
      connectionType: 'wifi',
      usedPersistedChoice: false,
    });
  });

  it('honors a persisted download-anyway choice without re-prompting on cellular', async () => {
    const storage = makeStorage();
    allowCellularDownload(storage);

    await expect(
      evaluateNetworkGate({
        storage,
        getConnectionType: async () => 'cellular',
      })
    ).resolves.toEqual({
      status: 'allowed',
      connectionType: 'cellular',
      usedPersistedChoice: true,
    });
  });
});
