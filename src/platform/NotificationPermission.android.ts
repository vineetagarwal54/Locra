import { PermissionsAndroid, Platform } from 'react-native';

export async function requestDownloadNotificationPermission(): Promise<boolean> {
  if (Number(Platform.Version) < 33) {
    return true;
  }

  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    const alreadyGranted = await PermissionsAndroid.check(permission);
    if (alreadyGranted) {
      return true;
    }

    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
