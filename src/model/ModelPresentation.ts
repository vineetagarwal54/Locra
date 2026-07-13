import { QWEN_V1_DESCRIPTOR, type ModelCandidate } from './ActiveModel';
import {
  QWEN3_VL_2B_INSTRUCT_BUNDLE,
  type ModelArtifactBundleManifest,
} from './ModelArtifactManifest';

const BYTES_PER_GB = 1024 * 1024 * 1024;
const STORAGE_HEADROOM = 1.12;

export interface ModelPresentation {
  readonly displayName: string;
  readonly downloadSizeLabel: string;
  readonly storageRequiredBytes: number;
  readonly storageRequiredLabel: string;
  formatDownloadedOfTotal(progress: number): string;
}

export function createModelPresentation(model: ModelCandidate): ModelPresentation {
  const totalBytes = model.integrityFallback.expectedSize;
  const storageRequiredBytes = Math.round(totalBytes * STORAGE_HEADROOM);
  return {
    displayName: model.displayName,
    downloadSizeLabel: formatGigabytes(totalBytes),
    storageRequiredBytes,
    storageRequiredLabel: formatGigabytes(storageRequiredBytes),
    formatDownloadedOfTotal: (progress: number): string => {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
      return `${formatGigabytes(totalBytes * clamped)} / ${formatGigabytes(totalBytes)}`;
    },
  };
}

/**
 * Product-facing presentation for the active Qwen V1 bundle. The aggregate
 * download size is the sum of the exact manifest artifacts (language GGUF +
 * projector), so readiness/size are tied to the manifest, never to "any GGUF".
 */
export function createQwenModelPresentation(
  manifest: ModelArtifactBundleManifest = QWEN3_VL_2B_INSTRUCT_BUNDLE
): ModelPresentation {
  const totalBytes = manifest.artifacts.reduce(
    (sum, artifact) => sum + artifact.expectedSizeBytes,
    0
  );
  const storageRequiredBytes = Math.round(totalBytes * STORAGE_HEADROOM);
  return {
    displayName: QWEN_V1_DESCRIPTOR.displayName,
    downloadSizeLabel: formatGigabytes(totalBytes),
    storageRequiredBytes,
    storageRequiredLabel: formatGigabytes(storageRequiredBytes),
    formatDownloadedOfTotal: (progress: number): string => {
      const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
      return `${formatGigabytes(totalBytes * clamped)} / ${formatGigabytes(totalBytes)}`;
    },
  };
}

export function formatGigabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}
