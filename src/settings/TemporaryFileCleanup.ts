import { Directory, File, Paths } from 'expo-file-system';

import { EXPORT_DIR_NAME } from '../diagnostics/DiagnosticsExportService';

const LOCRA_TEMP_FILE_PREFIXES = ['locra-picked-'] as const;
// The diagnostics export directory holds the most-recent diagnostics ZIP; a
// temporary-file cleanup removes it (dropping the kept newest export too).
const LOCRA_TEMP_DIRECTORIES = [EXPORT_DIR_NAME] as const;

export async function clearLocraTemporaryFiles(): Promise<void> {
  for (const entry of Paths.cache.list()) {
    if (entry instanceof File && LOCRA_TEMP_FILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
      entry.delete();
    }
    if (entry instanceof Directory && LOCRA_TEMP_DIRECTORIES.includes(entry.name as typeof EXPORT_DIR_NAME)) {
      entry.delete();
    }
  }
}
