import { readFileSync } from 'fs';
import { join } from 'path';

import {
  QWEN3_VL_2B_INSTRUCT_BUNDLE,
  type ArtifactReadiness,
} from '../../src/model/ModelArtifactManifest';
import {
  isQwenBundleReady,
  shouldRouteToQwenDownload,
} from '../../src/model/ModelReadinessReconciliation';

// Existing-user migration: LFM/ExecuTorch users continue normally while ExecuTorch
// is selected, are routed through Qwen download only when Qwen is selected/active
// and its artifacts are missing, and their conversations/drafts/history/etc. are
// never touched by model readiness reconciliation.

const bothVerified: ReadonlyArray<ArtifactReadiness> = [
  { artifactId: 'qwen_language_model', downloaded: true, integrityVerified: true },
  { artifactId: 'qwen_multimodal_projector', downloaded: true, integrityVerified: true },
];
const none: ReadonlyArray<ArtifactReadiness> = [];

function qwenReady(states: ReadonlyArray<ArtifactReadiness>): boolean {
  return isQwenBundleReady({
    activeModelId: QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId,
    manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
    artifactStates: states,
  });
}

describe('existing-user migration LFM → Qwen', () => {
  it('never routes an existing LFM user to a Qwen download while ExecuTorch is selected', () => {
    // Even with an old LFM download completed, the ExecuTorch host never routes to Qwen.
    expect(shouldRouteToQwenDownload({ qwenReady: false })).toBe(true);
    expect(shouldRouteToQwenDownload({ qwenReady: qwenReady(none) })).toBe(true);
  });

  it('does not treat an old LFM download/selection flag as Qwen readiness', () => {
    // Active model still LFM → Qwen is not ready regardless of any legacy flag.
    expect(
      isQwenBundleReady({
        activeModelId: 'obsolete-model',
        manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
        artifactStates: bothVerified,
      })
    ).toBe(false);
  });

  it('routes to the Qwen download only when Qwen is selected and its artifacts are missing', () => {
    expect(shouldRouteToQwenDownload({ qwenReady: qwenReady(none) })).toBe(true);
  });

  it('reaches chat (no download routing) once Qwen is selected and both artifacts are verified', () => {
    expect(qwenReady(bothVerified)).toBe(true);
    expect(shouldRouteToQwenDownload({ qwenReady: qwenReady(bothVerified) })).toBe(false);
  });

  it('keeps readiness reconciliation free of conversation/history/draft/diagnostics stores (no data loss path)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/model/ModelReadinessReconciliation.ts'),
      'utf8'
    );
    for (const forbidden of ['conversationStore', 'historyStore', 'draft', 'diagnostics', 'settings']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
