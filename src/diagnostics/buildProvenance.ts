// Build-time Git provenance for diagnostics.
//
// This file is the SAFE, checked-in baseline: its values represent "Git metadata
// was unavailable at build time". `scripts/generate-build-provenance.mjs` may
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
  gitCommitSha: '',
  gitBranch: '',
  gitDirty: null,
};
