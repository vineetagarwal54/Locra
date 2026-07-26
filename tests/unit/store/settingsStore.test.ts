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
    useSettingsStore.setState({ crossChatMemoryEnabled: false });
  });

  it('defaults to Medium and persists a selected mode', () => {
    expect(useSettingsStore.getState().responseMode).toBe('Medium');

    useSettingsStore.getState().setResponseMode('High');
    expect(storage.set).toHaveBeenCalledWith('settings:response-mode', 'High');
  });

  it('defaults cross-chat memory off and persists explicit changes', () => {
    expect(useSettingsStore.getState().crossChatMemoryEnabled).toBe(false);

    useSettingsStore.getState().setCrossChatMemoryEnabled(true);

    expect(storage.set).toHaveBeenCalledWith(
      'settings:cross-chat-memory-enabled',
      'true',
    );
    expect(useSettingsStore.getState().crossChatMemoryEnabled).toBe(true);
  });
});
