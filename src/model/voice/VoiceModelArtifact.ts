// Real download/verify/persist/remove adapter for the offline Whisper voice model.
//
// Lives OUTSIDE `src/voice` on purpose: the offline architecture guard forbids
// networking calls inside `src/voice`, and downloading the model is a network
// operation. The recognizer runtime (`src/voice/WhisperVoiceRuntime.ts`) only ever
// reads the already-downloaded file from local storage.
//
// The model is stored in its OWN directory (`locra-voice-models/<id>`), entirely
// separate from the Qwen language model + vision projector, so voice setup and
// removal never touch the Qwen artifacts or any conversation data.

import { Directory, File, Paths } from 'expo-file-system';

import {
  DEFAULT_VOICE_MODEL,
  VOICE_MODEL_DIR_NAME,
  voiceModelFiles,
  type VoiceModelDescriptor,
} from '../../voice/VoiceModelDescriptor';
import type { VoiceArtifactAdapter } from '../../voice/VoiceModelLifecycle';
import { verifyModelIntegrity } from '../ModelIntegrity';

/** Absolute directory (no trailing slash, no `file://`-stripping) holding a model's files. */
export function voiceModelDirectory(descriptor: VoiceModelDescriptor = DEFAULT_VOICE_MODEL): string {
  return modelDirectory(descriptor).uri;
}

function modelDirectory(descriptor: VoiceModelDescriptor): Directory {
  return new Directory(Paths.document, VOICE_MODEL_DIR_NAME, descriptor.id);
}

/**
 * Downloads, verifies, persists, and removes the configured Zipformer model.
 * Implements the {@link VoiceArtifactAdapter} the lifecycle consumes.
 */
export class VoiceModelArtifactAdapter implements VoiceArtifactAdapter {
  constructor(private readonly descriptor: VoiceModelDescriptor = DEFAULT_VOICE_MODEL) {}

  get storageBytes(): number {
    return this.descriptor.approxSizeBytes;
  }

  /** Ready = every model file is present on disk (integrity is checked by verify()). */
  async isReady(): Promise<boolean> {
    const directory = modelDirectory(this.descriptor);
    if (!directory.exists) {
      return false;
    }
    return voiceModelFiles(this.descriptor).every((name) => new File(directory, name).exists);
  }

  /**
   * Downloads all model files into the model directory, reporting a single
   * aggregate 0..1 progress weighted by each file's known size. A partial file
   * from a prior aborted attempt is deleted before re-downloading so a retry is
   * always a clean transfer.
   */
  async download(onProgress: (progress: number) => void): Promise<void> {
    const directory = modelDirectory(this.descriptor);
    if (!directory.exists) {
      directory.create({ intermediates: true });
    }

    const names = voiceModelFiles(this.descriptor);
    const totalBytes = names.reduce((sum, name) => sum + this.specFor(name).sizeBytes, 0);
    const written = new Map<string, number>();
    const emit = (): void => {
      let downloaded = 0;
      for (const value of written.values()) {
        downloaded += value;
      }
      onProgress(totalBytes > 0 ? Math.min(1, downloaded / totalBytes) : 0);
    };

    for (const name of names) {
      const destination = new File(directory, name);
      if (destination.exists) {
        destination.delete();
      }
      const url = `${this.descriptor.downloadBaseUrl}/${name}`;
      const task = File.createDownloadTask(url, destination, {
        onProgress: ({ bytesWritten }) => {
          written.set(name, bytesWritten);
          emit();
        },
      });
      await task.downloadAsync();
      // Pin this file to its full known size so aggregate progress is exact even
      // if the final progress callback under-reported.
      written.set(name, this.specFor(name).sizeBytes);
      emit();
    }
  }

  /** Verifies every downloaded file against its SHA-256 using the native hasher. */
  async verify(): Promise<boolean> {
    const directory = modelDirectory(this.descriptor);
    for (const name of voiceModelFiles(this.descriptor)) {
      const file = new File(directory, name);
      if (!file.exists) {
        return false;
      }
      if (!(await verifyModelIntegrity(file.uri, this.specFor(name).sha256))) {
        return false;
      }
    }
    return true;
  }

  /** Deletes the whole voice model directory. Never touches Qwen or conversations. */
  async remove(): Promise<void> {
    const directory = modelDirectory(this.descriptor);
    if (directory.exists) {
      directory.delete();
    }
  }

  private specFor(name: string): { sha256: string; sizeBytes: number } {
    const spec = this.descriptor.checksums[name];
    if (spec === undefined) {
      throw new Error(`No checksum configured for voice model file "${name}".`);
    }
    return spec;
  }
}
