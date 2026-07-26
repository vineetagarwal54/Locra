import { create } from 'zustand';

import {
  DEFAULT_RESPONSE_MODE,
  isResponseMode,
  type ResponseMode,
} from '../inference/ResponseMode';
import { storage } from '../storage/mmkv';

const RESPONSE_MODE_KEY = 'settings:response-mode';
const CROSS_CHAT_MEMORY_KEY = 'settings:cross-chat-memory-enabled';

interface SettingsState {
  responseMode: ResponseMode;
  defaultResponseMode: ResponseMode;
  setResponseMode: (mode: ResponseMode) => void;
  crossChatMemoryEnabled: boolean;
  setCrossChatMemoryEnabled: (enabled: boolean) => void;
}

function readCrossChatMemoryEnabled(): boolean {
  return storage.getString(CROSS_CHAT_MEMORY_KEY) === 'true';
}

function readResponseMode(): ResponseMode {
  const persisted = storage.getString(RESPONSE_MODE_KEY);
  return persisted !== undefined && isResponseMode(persisted)
    ? persisted
    : DEFAULT_RESPONSE_MODE;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  responseMode: readResponseMode(),
  defaultResponseMode: readResponseMode(),
  crossChatMemoryEnabled: readCrossChatMemoryEnabled(),
  setResponseMode: (responseMode: ResponseMode): void => {
    storage.set(RESPONSE_MODE_KEY, responseMode);
    set({ responseMode, defaultResponseMode: responseMode });
  },
  setCrossChatMemoryEnabled: (crossChatMemoryEnabled: boolean): void => {
    storage.set(CROSS_CHAT_MEMORY_KEY, String(crossChatMemoryEnabled));
    set({ crossChatMemoryEnabled });
  },
}));
