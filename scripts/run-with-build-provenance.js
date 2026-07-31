const { execFileSync, spawnSync } = require('node:child_process');

function readGit(args, fallback) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function commandForPlatform(command) {
  return process.platform === 'win32' && command === 'npx' ? 'npx.cmd' : command;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    process.stderr.write('Usage: node scripts/run-with-build-provenance.js <command> [...args]\n');
    process.exitCode = 1;
    return;
  }

  const commitSha = readGit(['rev-parse', 'HEAD'], 'unknown');
  const branch = readGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
  const status = readGit(['status', '--porcelain', '--untracked-files=normal'], '');
  const workingTreeState = status === '' ? 'clean' : 'dirty';
  const shortSha = commitSha === 'unknown' ? 'unknown' : commitSha.slice(0, 12);
  const environment = {
    ...process.env,
    EXPO_PUBLIC_LOCRA_GIT_COMMIT_SHA: commitSha,
    EXPO_PUBLIC_LOCRA_GIT_BRANCH: branch,
    EXPO_PUBLIC_LOCRA_WORKTREE_STATE: workingTreeState,
    EXPO_PUBLIC_LOCRA_BUILD_IDENTIFIER: `${shortSha}-${workingTreeState}`,
  };
  const result = spawnSync(commandForPlatform(command), args, {
    env: environment,
    stdio: 'inherit',
  });
  if (result.error !== undefined) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

main();
