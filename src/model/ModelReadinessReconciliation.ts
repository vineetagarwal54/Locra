// Qwen-aware readiness reconciliation (Spec 005, T015/T020).
//
// Keeps two migration-critical invariants pure and native-free so they can be
// unit-tested without the store/composition root:
//   1. Qwen readiness requires the exact active model id AND the exact artifact
//      manifest — an old LFM download/selection flag is NEVER Qwen readiness.
//   2. Users are only routed into the Qwen download flow when Qwen is the
//      internally selected/active runtime; existing LFM users under the
//      ExecuTorch host are never pushed toward a Qwen download.

import {
  isBundleReady,
  type ArtifactReadiness,
  type ModelArtifactBundleManifest,
} from './ModelArtifactManifest';

export interface QwenReadinessInput {
  /** The exact active model id resolved for this process (null when none set). */
  readonly activeModelId: string | null;
  readonly manifest: ModelArtifactBundleManifest;
  readonly artifactStates: ReadonlyArray<ArtifactReadiness>;
  /**
   * Legacy LFM download/readiness flag from a prior install. Accepted only to
   * make explicit that it is IGNORED — an old LFM flag can never establish Qwen
   * readiness.
   */
}

/**
 * Qwen readiness requires BOTH the active model id to equal the Qwen bundle id
 * AND every manifest artifact to be independently downloaded + verified.
 */
export function isQwenBundleReady(input: QwenReadinessInput): boolean {
  if (input.activeModelId !== input.manifest.activeModelId) {
    return false;
  }
  return isBundleReady(input.manifest, input.artifactStates);
}

export interface QwenDownloadRoutingInput {
  readonly qwenReady: boolean;
}

/**
 * Route to the Qwen download/setup flow only when Qwen is the selected/active
 * runtime and its bundle is not yet ready. Under the ExecuTorch host, existing
 * LFM users are never routed to a Qwen download.
 */
export function shouldRouteToQwenDownload(input: QwenDownloadRoutingInput): boolean {
  return !input.qwenReady;
}
