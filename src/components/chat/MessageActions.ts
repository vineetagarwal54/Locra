import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

export interface MessageActionDependencies {
  setClipboardText(text: string): Promise<void>;
  share(text: string): Promise<void>;
}

const platformDependencies: MessageActionDependencies = {
  setClipboardText: async (text) => {
    await Clipboard.setStringAsync(text);
  },
  share: async (text) => {
    await Share.share({ message: text });
  },
};

export function copyText(
  text: string,
  dependencies: MessageActionDependencies = platformDependencies,
): Promise<void> {
  return dependencies.setClipboardText(text);
}

export function shareText(
  text: string,
  dependencies: MessageActionDependencies = platformDependencies,
): Promise<void> {
  return dependencies.share(text);
}
