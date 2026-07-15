import { Directory, File, Paths } from 'expo-file-system';

const CONVERSATION_DIRECTORY = 'locra-conversations';
const IMAGE_DIRECTORY = 'images';

export interface DurableImageStorageDeps {
  readonly documentRoot: string;
  readonly createId: () => string;
  readonly ensureDirectory: (path: string) => Promise<void>;
  readonly copyFile: (source: string, destination: string) => Promise<void>;
  readonly deleteFile: (path: string) => Promise<void>;
}

export class DurableImageStorage {
  constructor(private readonly deps: DurableImageStorageDeps) {}

  async persist(conversationId: string, sourcePath: string): Promise<string> {
    const directory = joinPath(
      this.deps.documentRoot,
      CONVERSATION_DIRECTORY,
      sanitizeSegment(conversationId),
      IMAGE_DIRECTORY,
    );
    const normalizedSource = normalizePath(sourcePath);
    if (isWithinDirectory(normalizedSource, directory)) {
      return normalizedSource;
    }

    await this.deps.ensureDirectory(directory);
    const destination = joinPath(
      directory,
      `${sanitizeSegment(this.deps.createId())}${imageExtension(normalizedSource)}`,
    );
    await this.deps.copyFile(normalizedSource, destination);
    try {
      await this.deps.deleteFile(normalizedSource);
    } catch {
      // The durable copy is authoritative; abandoned cache cleanup is best-effort.
    }
    return destination;
  }
}

export const durableImageStorage = new DurableImageStorage({
  documentRoot: normalizePath(Paths.document.uri),
  createId: createImageId,
  ensureDirectory: async (path) => {
    const directory = new Directory(toFileUri(path));
    if (!directory.exists) {
      directory.create({ idempotent: true, intermediates: true });
    }
  },
  copyFile: async (source, destination) => {
    await new File(toFileUri(source)).copy(new File(toFileUri(destination)));
  },
  deleteFile: async (path) => {
    const file = new File(toFileUri(path));
    if (file.exists) file.delete();
  },
});

export function isDurableConversationImage(path: string): boolean {
  const root = joinPath(normalizePath(Paths.document.uri), CONVERSATION_DIRECTORY);
  return isWithinDirectory(normalizePath(path), root);
}

function imageExtension(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? '';
  const match = name.match(/\.[a-zA-Z0-9]{1,5}$/);
  return match === null ? '.jpg' : match[0].toLowerCase();
}

function sanitizeSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return sanitized === '' ? 'unknown' : sanitized;
}

function normalizePath(path: string): string {
  return path.replace(/^file:\/\//, '').replace(/[\\/]+$/, '');
}

function joinPath(root: string, ...segments: string[]): string {
  return [normalizePath(root), ...segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ''))]
    .filter((segment) => segment !== '')
    .join('/');
}

function isWithinDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

function createImageId(): string {
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
