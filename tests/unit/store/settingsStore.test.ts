jest.mock('../../../src/storage/mmkv', () => ({
  storage: {
    getString: jest.fn(() => undefined),
    set: jest.fn(),
  },
}));

import { storage } from '../../../src/storage/mmkv';
import { useSettingsStore } from '../../../src/store/settingsStore';

describe('settingsStore response mode persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ responseMode: 'Medium' });
  });

  it('defaults to Medium and persists a selected mode', () => {
    expect(useSettingsStore.getState().responseMode).toBe('Medium');

    useSettingsStore.getState().setResponseMode('High');
    expect(storage.set).toHaveBeenCalledWith('settings:response-mode', 'High');
  });
});
