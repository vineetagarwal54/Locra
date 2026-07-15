import { Directory, File, Paths } from 'expo-file-system';

const LOCRA_TEMP_FILE_PREFIXES = ['locra-picked-'] as const;
const LOCRA_TEMP_DIRECTORIES = ['locra-diagnostics'] as const;

export async function clearLocraTemporaryFiles(): Promise<void> {
  for (const entry of Paths.cache.list()) {
    if (entry instanceof File && LOCRA_TEMP_FILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
      entry.delete();
    }
    if (entry instanceof Directory && LOCRA_TEMP_DIRECTORIES.includes(entry.name as 'locra-diagnostics')) {
      entry.delete();
    }
  }
}
