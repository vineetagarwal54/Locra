import { create } from 'zustand';

import { storage } from '../storage/mmkv';

const HAS_SEEN_WELCOME_KEY = 'hasSeenWelcome';

interface OnboardingStoreState {
  hasSeenWelcome: boolean;
  completeWelcome: () => void;
}

export const useOnboardingStore = create<OnboardingStoreState>((set) => ({
  hasSeenWelcome: hasCompletedWelcome(),
  completeWelcome: (): void => {
    storage.set(HAS_SEEN_WELCOME_KEY, true);
    set({ hasSeenWelcome: true });
  },
}));

export function hasCompletedWelcome(): boolean {
  return storage.getBoolean(HAS_SEEN_WELCOME_KEY) ?? false;
}
