// Regenerates src/diagnostics/buildProvenance.ts with the current Git build
// provenance (commit SHA, branch, dirty flag). Cross-platform (Node only, no shell
// built-ins) so it runs identically on Windows and POSIX. Isolated: it touches
// exactly one source file and nothing else.
//
// Usage:  node scripts/generate-build-provenance.mjs
//
// If Git is unavailable (e.g. a source tarball with no .git), it writes the safe
// "unavailable" fallback so the diagnostics export still builds. Never throws.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', 'src', 'diagnostics', 'buildProvenance.ts');

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const commit = git(['rev-parse', 'HEAD']) ?? '';
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '';
// `git status --porcelain` prints one line per change; empty output means clean.
const statusOutput = git(['status', '--porcelain']);
const dirty = statusOutput === null ? null : statusOutput.length > 0;

const dirtyLiteral = dirty === null ? 'null' : dirty ? 'true' : 'false';

const contents = `// Build-time Git provenance for diagnostics.
//
// This file is the SAFE, checked-in baseline: its values represent "Git metadata
// was unavailable at build time". \`scripts/generate-build-provenance.mjs\` may
// overwrite it during a build to stamp the real commit/branch/dirty state. When it
// is not regenerated (dev checkouts, CI without the script), the fallbacks below
// keep the diagnostics export valid. Consumers must still tolerate empty strings /
// null — see DeviceBuildMetadataProvider.

export interface BuildProvenance {
  /** Full commit SHA, or '' when unavailable at build time. */
  readonly gitCommitSha: string;
  /** Branch name, or '' when unavailable at build time. */
  readonly gitBranch: string;
  /** Whether the working tree was dirty when built; null when unknown. */
  readonly gitDirty: boolean | null;
}

export const BUILD_PROVENANCE: BuildProvenance = {
  gitCommitSha: ${JSON.stringify(commit)},
  gitBranch: ${JSON.stringify(branch)},
  gitDirty: ${dirtyLiteral},
};
`;

writeFileSync(TARGET, contents, 'utf8');
process.stdout.write(
  `build provenance: commit=${commit || '(none)'} branch=${branch || '(none)'} dirty=${dirtyLiteral}\n`,
);
