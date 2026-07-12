import type { ModelCandidate } from './ActiveModel';

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

export function formatGigabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}
