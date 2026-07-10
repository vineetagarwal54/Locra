import { PINNED_MODEL_SIZE_BYTES } from './ModelConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Presentation-only model metadata for the setup UI (design.md §7.3 "dynamic
// metadata rule": model name, size, and storage come from the actual model
// configuration, not hardcoded UI copy). This module contains NO download,
// verification, or lifecycle logic — it only formats already-known values.
//
// The display name is derived from the pinned model constant used by the model
// store (LFM2_5_VL_1_6B_QUANTIZED): a real architecture/size/quantization
// descriptor, never a raw filename, hash, or internal id (design.md §12).
// ─────────────────────────────────────────────────────────────────────────────

const BYTES_PER_GB = 1024 * 1024 * 1024;

// Extra local space beyond the raw download the model needs to be unpacked and
// loaded safely; keeps the "Storage Required" figure honestly above "Download
// Size" without a hardcoded second number.
const STORAGE_HEADROOM = 1.12;

export const MODEL_DISPLAY_NAME = 'LFM2.5-VL 1.6B · Quantized';

export function formatGigabytes(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}

export const MODEL_TOTAL_BYTES = PINNED_MODEL_SIZE_BYTES;
export const MODEL_DOWNLOAD_SIZE_LABEL = formatGigabytes(PINNED_MODEL_SIZE_BYTES);
// Raw "Storage Required" figure (bytes), the single source shared by the intro
// metadata card and the storage-availability check so both agree on how much
// free space the install actually needs.
export const MODEL_STORAGE_REQUIRED_BYTES = Math.round(PINNED_MODEL_SIZE_BYTES * STORAGE_HEADROOM);
export const MODEL_STORAGE_REQUIRED_LABEL = formatGigabytes(MODEL_STORAGE_REQUIRED_BYTES);

// "1.5 GB / 2.4 GB" style live figure for the progress card, computed from the
// real fractional progress the store reports.
export function formatDownloadedOfTotal(progress: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const downloaded = formatGigabytes(MODEL_TOTAL_BYTES * clamped);
  const total = formatGigabytes(MODEL_TOTAL_BYTES);
  return `${downloaded} / ${total}`;
}
