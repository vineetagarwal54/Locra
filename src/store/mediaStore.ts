import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';

interface MediaStoreState {
  pickImageFromLibrary: () => Promise<string | null>;
}

export const useMediaStore = create<MediaStoreState>(() => ({
  pickImageFromLibrary,
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
