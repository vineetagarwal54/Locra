import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const GUARDED_DIRECTORIES = [
  'src/persistence',
  'src/retrieval',
  'src/inference',
  'src/voice',
] as const;

const FORBIDDEN = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /from\s+['"]expo-network['"]/,
  /from\s+['"](?:net|tls|dgram|react-native-tcp-socket)['"]/,
  /from\s+['"]@kesha-antonov\/react-native-background-downloader['"]/,
] as const;

describe('offline architecture guard', () => {
  it('keeps inference, retrieval, persistence, and voice free of networking calls', () => {
    const violations: string[] = [];
    for (const directory of GUARDED_DIRECTORIES) {
      for (const file of sourceFiles(join(process.cwd(), directory))) {
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const pattern of FORBIDDEN) {
          if (pattern.test(source)) {
            violations.push(`${file}: ${pattern.source}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

