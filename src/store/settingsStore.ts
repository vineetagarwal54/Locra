import { create } from 'zustand';

import {
  DEFAULT_RESPONSE_MODE,
  isResponseMode,
  type ResponseMode,
} from '../inference/ResponseMode';
import { storage } from '../storage/mmkv';

const RESPONSE_MODE_KEY = 'settings:response-mode';

interface SettingsState {
  responseMode: ResponseMode;
  setResponseMode: (mode: ResponseMode) => void;
}

function readResponseMode(): ResponseMode {
  const persisted = storage.getString(RESPONSE_MODE_KEY);
  return persisted !== undefined && isResponseMode(persisted)
    ? persisted
    : DEFAULT_RESPONSE_MODE;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  responseMode: readResponseMode(),
  setResponseMode: (responseMode: ResponseMode): void => {
    storage.set(RESPONSE_MODE_KEY, responseMode);
    set({ responseMode });
  },
}));
