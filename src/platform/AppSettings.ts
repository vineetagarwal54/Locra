import { Linking } from 'react-native';

export async function openAndroidAppSettings(): Promise<void> {
  await Linking.openSettings();
}
