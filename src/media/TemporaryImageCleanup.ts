import { File, Paths } from 'expo-file-system';

export interface TemporaryImageCleanupDeps {
  readonly cacheRoot: string;
  readonly deleteFile: (path: string) => Promise<void>;
}

export class TemporaryImageCleanup {
  constructor(private readonly deps: TemporaryImageCleanupDeps) {}

  async removeDerived(derivedPath: string, sourcePath: string): Promise<void> {
    const derived = normalizePath(derivedPath);
    const source = normalizePath(sourcePath);
    const cacheRoot = normalizePath(this.deps.cacheRoot).replace(/[\\/]+$/, '');
    if (derived === source || !derived.startsWith(`${cacheRoot}/`)) return;
    await this.deps.deleteFile(derived);
  }
}

export const temporaryImageCleanup = new TemporaryImageCleanup({
  cacheRoot: Paths.cache.uri,
  deleteFile: async (path) => {
    const file = new File(path.startsWith('file://') ? path : `file://${path}`);
    if (file.exists) file.delete();
  },
});

function normalizePath(path: string): string {
  return path.replace(/^file:\/\//, '');
}
