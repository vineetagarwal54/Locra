import {
  QWEN3_VL_2B_INSTRUCT_BUNDLE,
  type ArtifactReadiness,
} from '../../../src/model/ModelArtifactManifest';
import {
  isQwenBundleReady,
  shouldRouteToQwenDownload,
} from '../../../src/model/ModelReadinessReconciliation';

// Existing-user reconciliation: an old LFM download/selection flag must never be
// mistaken for Qwen readiness. Qwen readiness requires the exact active model id
// PLUS the exact artifact manifest, verified independently.

const bothVerified: ReadonlyArray<ArtifactReadiness> = [
  { artifactId: 'qwen_language_model', downloaded: true, integrityVerified: true },
  { artifactId: 'qwen_multimodal_projector', downloaded: true, integrityVerified: true },
];

const onlyLanguageVerified: ReadonlyArray<ArtifactReadiness> = [
  { artifactId: 'qwen_language_model', downloaded: true, integrityVerified: true },
  { artifactId: 'qwen_multimodal_projector', downloaded: false, integrityVerified: false },
];

describe('Qwen readiness reconciliation', () => {
  it('is not ready when an old LFM download flag is set but the active model is still LFM', () => {
    expect(
      isQwenBundleReady({
        activeModelId: 'obsolete-model',
        manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
        artifactStates: [],
      })
    ).toBe(false);
  });

  it('ignores the legacy LFM flag entirely — it never establishes Qwen readiness', () => {
    expect(
      isQwenBundleReady({
        activeModelId: QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId,
        manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
        artifactStates: [],
      })
    ).toBe(false);
  });

  it('requires the active model id to equal the Qwen bundle id', () => {
    expect(
      isQwenBundleReady({
        activeModelId: null,
        manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
        artifactStates: bothVerified,
      })
    ).toBe(false);
  });

  it('requires every manifest artifact to be verified, not just one', () => {
    expect(
      isQwenBundleReady({
        activeModelId: QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId,
        manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
        artifactStates: onlyLanguageVerified,
      })
    ).toBe(false);
  });

  it('is ready only with the Qwen active id and both artifacts verified', () => {
    expect(
      isQwenBundleReady({
        activeModelId: QWEN3_VL_2B_INSTRUCT_BUNDLE.activeModelId,
        manifest: QWEN3_VL_2B_INSTRUCT_BUNDLE,
        artifactStates: bothVerified,
      })
    ).toBe(true);
  });

  describe('download routing gate', () => {
    it('never routes to a Qwen download under the ExecuTorch host', () => {
      expect(shouldRouteToQwenDownload({ qwenReady: false })).toBe(true);
      expect(shouldRouteToQwenDownload({ qwenReady: true })).toBe(false);
    });

    it('routes to a Qwen download only when Qwen is selected and not yet ready', () => {
      expect(shouldRouteToQwenDownload({ qwenReady: false })).toBe(true);
      expect(shouldRouteToQwenDownload({ qwenReady: true })).toBe(false);
    });
  });
});
