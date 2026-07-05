import { File, FileMode } from 'expo-file-system';
import { sha256 } from 'js-sha256';

// The app verifies the model's integrity itself — ExecuTorch does not (research.md,
// data-model.md `OnDeviceModel`).
//
// Memory safety (constitution Principle IV): the `.pte` is ~2.4 GB, and
// expo-crypto has no incremental/streaming digest, so a one-shot hash would pull
// the entire file into a JS ArrayBuffer and blow the budget on 6–8 GB devices.
// Instead we stream the file through a native FileHandle in bounded chunks and
// fold each chunk into an incremental SHA-256 — peak memory stays at one chunk.
// Any read/hash failure resolves to `false` (never throws) so a corrupt/missing
// model routes to the setup screen rather than into an inference attempt.

const CHUNK_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
const YIELD_EVERY_CHUNKS = 8; // let the JS thread breathe roughly every 64 MB

export async function verifyModelIntegrity(fileUri: string, expectedSha256: string): Promise<boolean> {
  try {
    const file = new File(fileUri);
    if (!file.exists) {
      return false;
    }

    const total = file.size;
    const handle = file.open(FileMode.ReadOnly);
    try {
      const hasher = sha256.create();
      let read = 0;
      let chunksSinceYield = 0;
      while (read < total) {
        const chunk = handle.readBytes(Math.min(CHUNK_SIZE_BYTES, total - read));
        if (chunk.length === 0) {
          break;
        }
        hasher.update(chunk);
        read += chunk.length;
        if (++chunksSinceYield >= YIELD_EVERY_CHUNKS) {
          chunksSinceYield = 0;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      return hasher.hex() === expectedSha256.trim().toLowerCase();
    } finally {
      handle.close();
    }
  } catch {
    return false;
  }
}
