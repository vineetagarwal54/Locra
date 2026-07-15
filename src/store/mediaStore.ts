import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';

interface MediaStoreState {
  pickImageFromLibrary: () => Promise<string | null>;
  discardTemporaryImage: (path: string) => Promise<void>;
}

export const useMediaStore = create<MediaStoreState>(() => ({
  pickImageFromLibrary,
  discardTemporaryImage,
}));

async function pickImageFromLibrary(): Promise<string | null> {
  const result = await File.pickFileAsync({ mimeTypes: ['image/*'] });
  if (result.canceled) {
    return null;
  }

  const destination = new File(
    Paths.cache,
    `locra-picked-${Date.now()}${getImageExtension(result.result)}`
  );
  await result.result.copy(destination, { overwrite: true });
  return toInferencePath(destination.uri);
}

function getImageExtension(file: File): string {
  const extension = file.extension.toLowerCase();
  return extension.startsWith('.') && extension.length > 1 ? extension : '.jpg';
}

function toInferencePath(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
}

export async function discardTemporaryImage(path: string): Promise<void> {
  const normalized = toInferencePath(path);
  const cacheRoot = toInferencePath(Paths.cache.uri).replace(/[\\/]+$/, '');
  if (normalized !== cacheRoot && !normalized.startsWith(`${cacheRoot}/`)) return;
  const file = new File(path.startsWith('file://') ? path : `file://${path}`);
  if (file.exists) file.delete();
}
