// The provider reads build-time Git provenance from the generated buildProvenance
// module. We mock that module with a mutable object so each test can exercise a
// different build state (present / missing / dirty) without a real build step.
const mockBuildProvenance: {
  gitCommitSha: string;
  gitBranch: string;
  gitDirty: boolean | null;
} = { gitCommitSha: '', gitBranch: '', gitDirty: null };

jest.mock('../../../src/diagnostics/buildProvenance', () => ({
  get BUILD_PROVENANCE() {
    return mockBuildProvenance;
  },
}));

import { getCurrentDeviceBuildMetadata } from '../../../src/diagnostics/DeviceBuildMetadataProvider';

describe('getCurrentDeviceBuildMetadata build provenance', () => {
  beforeEach(() => {
    mockBuildProvenance.gitCommitSha = '';
    mockBuildProvenance.gitBranch = '';
    mockBuildProvenance.gitDirty = null;
  });

  it('exports the git commit, branch, dirty flag, and app build id', () => {
    mockBuildProvenance.gitCommitSha = 'a1b2c3d4e5f6';
    mockBuildProvenance.gitBranch = 'recovery/context-memory-v3';
    mockBuildProvenance.gitDirty = false;

    const metadata = getCurrentDeviceBuildMetadata();

    expect(metadata.gitCommitSha).toBe('a1b2c3d4e5f6');
    expect(metadata.gitBranch).toBe('recovery/context-memory-v3');
    expect(metadata.gitDirty).toBe(false);
    // App build id and device name are always present, even without git metadata.
    expect(typeof metadata.appBuildId).toBe('string');
    expect(typeof metadata.deviceNameModel).toBe('string');
  });

  it('falls back to explicit "unknown" values when git metadata is unavailable', () => {
    mockBuildProvenance.gitCommitSha = '';
    mockBuildProvenance.gitBranch = '   ';
    mockBuildProvenance.gitDirty = null;

    const metadata = getCurrentDeviceBuildMetadata();

    expect(metadata.gitCommitSha).toBe('unknown');
    expect(metadata.gitBranch).toBe('unknown');
    // A genuinely unknown dirty state is preserved as null (never coerced to false).
    expect(metadata.gitDirty).toBeNull();
  });

  it('represents a dirty working tree at build time as gitDirty true', () => {
    mockBuildProvenance.gitCommitSha = 'deadbeef';
    mockBuildProvenance.gitBranch = 'main';
    mockBuildProvenance.gitDirty = true;

    expect(getCurrentDeviceBuildMetadata().gitDirty).toBe(true);
  });
});
