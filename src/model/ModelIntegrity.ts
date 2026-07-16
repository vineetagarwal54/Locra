import NativeModelIntegrity, {
  type ModelIntegrityProgressEvent,
} from '../native/NativeModelIntegrity';

// Android streams bounded chunks on its own executor. JS receives only progress
// snapshots and the final boolean, so hashing cannot block the JS event loop or
// hold a complete model artifact in memory.
export interface ModelIntegrityProgress {
  bytesRead: number;
  totalBytes: number;
  progress: number;
}

let nextRequestId = 0;

export async function verifyModelIntegrity(
  fileUri: string,
  expectedSha256: string,
  onProgress?: (progress: ModelIntegrityProgress) => void,
): Promise<boolean> {
  if (NativeModelIntegrity === null) return false;
  const requestId = `model-integrity-${++nextRequestId}`;
  const subscription = NativeModelIntegrity.addListener('onProgress', (event: ModelIntegrityProgressEvent) => {
    if (event.requestId !== requestId) return;
    onProgress?.({
      bytesRead: event.bytesRead,
      totalBytes: event.totalBytes,
      progress: clampProgress(event.progress),
    });
  });
  try {
    return await NativeModelIntegrity.verifyFile(
      requestId,
      fileUri,
      expectedSha256.trim().toLowerCase(),
    );
  } catch {
    return false;
  } finally {
    subscription.remove();
  }
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
