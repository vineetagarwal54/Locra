// Qwen artifact readiness reconciliation. Kept native-free for focused tests.

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
 * Route to setup whenever the single Qwen bundle is not ready.
 */
export function shouldRouteToQwenDownload(input: QwenDownloadRoutingInput): boolean {
  return !input.qwenReady;
}
