// Best-effort cleanup of orphaned voice temporary audio left behind by a crash or
// force-kill mid-recording. audio-studio writes each recording as a `<uuid>.wav`
// directly in the document directory; the runtime deletes it on stop/cancel/
// release, but a hard crash can leave one behind. This sweeps them at startup.
//
// It ONLY touches top-level `.wav` files in the document directory. Downloaded
// Whisper model files live in the `locra-voice-models/<id>/` subdirectory and are
// `.bin`, so they are never affected. Cleanup is fully best-effort and never
// throws, so it can never crash app startup.

import { Directory, File, Paths } from 'expo-file-system';

/** Removes orphaned `<uuid>.wav` temp recordings from the document directory. */
export function cleanupOrphanedVoiceAudio(): void {
  try {
    const directory = new Directory(Paths.document);
    if (!directory.exists) {
      return;
    }
    for (const entry of directory.list()) {
      if (entry instanceof File && entry.name.toLowerCase().endsWith('.wav')) {
        try {
          if (entry.exists) {
            entry.delete();
          }
        } catch {
          // A single undeletable leftover must not stop the sweep or startup.
        }
      }
    }
  } catch {
    // Listing/stat can fail on some devices — cleanup is optional, never fatal.
  }
}
