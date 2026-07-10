import { getFreeDiskStorage } from 'react-native-device-info';

import { MODEL_STORAGE_REQUIRED_BYTES } from './ModelPresentation';

// ─────────────────────────────────────────────────────────────────────────────
// Free-space check for the model-setup flow (design.md §7.7 Insufficient
// Storage). This is presentation/recovery support only — it reads real device
// free space and compares it against the model's required install size. It does
// NOT download, verify, pause, resume, or otherwise touch the download lifecycle
// in ModelDownloadManager / modelStore.
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageAvailability {
  /** Bytes the install needs (download size + unpack/load headroom). */
  requiredBytes: number;
  /** Real free bytes on the device, or null if it could not be determined. */
  availableBytes: number | null;
  /** How many more bytes the user must free up (0 when already sufficient). */
  shortfallBytes: number;
  sufficient: boolean;
}

// Reads real device free space via react-native-device-info (the same native
// module DeviceCompatibility already uses for total memory).
export async function getStorageAvailability(): Promise<StorageAvailability> {
  const requiredBytes = MODEL_STORAGE_REQUIRED_BYTES;
  try {
    const availableBytes = await getFreeDiskStorage();
    if (typeof availableBytes !== 'number' || !Number.isFinite(availableBytes) || availableBytes < 0) {
      // Unknown free space: never strand the user pre-flight — let the real
      // download surface a genuine ENOSPC failure instead of blocking here.
      return { requiredBytes, availableBytes: null, shortfallBytes: 0, sufficient: true };
    }
    const shortfallBytes = Math.max(0, requiredBytes - availableBytes);
    return { requiredBytes, availableBytes, shortfallBytes, sufficient: shortfallBytes === 0 };
  } catch {
    return { requiredBytes, availableBytes: null, shortfallBytes: 0, sufficient: true };
  }
}

// Matches the free-space failure messages the native downloader / filesystem
// raise, so those route to the Insufficient Storage recovery screen instead of
// the generic failed state (design.md §7.7).
const STORAGE_ERROR_PATTERN =
  /enospc|no space left|not enough (free )?space|insufficient (disk |free )?(storage|space)|storage is full|disk (is )?full|out of (disk )?space/i;

export function isStorageError(error: string | null | undefined): boolean {
  if (error === null || error === undefined || error === '') {
    return false;
  }
  return STORAGE_ERROR_PATTERN.test(error);
}
