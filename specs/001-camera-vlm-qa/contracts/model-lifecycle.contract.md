# Contract: Model Lifecycle Module

Enforces constitution Principle IV ("device compatibility checked before
model load, not after") and Principle X ("model lifecycle is self-contained
— no imports from inference or screens"). Both the inference module and
screens depend on this module's public interface; it depends on neither.

## Public interface

```ts
interface DeviceCompatibilityResult {
  isSupported: boolean;
  totalMemoryBytes: number;
  osVersion: string;
  reason: string | null;   // required whenever isSupported is false — FR-011
}

type ModelDownloadStatus = 'not_started' | 'downloading' | 'paused' | 'downloaded' | 'failed';

interface ModelState {
  downloadStatus: ModelDownloadStatus;
  downloadProgress: number;      // 0–1
  integrityVerified: boolean;
  error: string | null;
}

interface ModelLifecycle {
  checkDeviceCompatibility(): DeviceCompatibilityResult;
  getState(): ModelState;
  subscribe(listener: (state: ModelState) => void): () => void;
  startDownload(): Promise<void>;
  pauseDownload(): Promise<void>;
  resumeDownload(): Promise<void>;
  cancelDownload(): Promise<void>;
  isReadyForInference(): boolean;  // true only if downloaded AND integrityVerified
}
```

## Preconditions

- `startDownload()` MUST NOT be called by any caller before
  `checkDeviceCompatibility().isSupported` is `true` — this module does not
  re-check compatibility itself on every call; the setup screen (User Story
  2) is the single call site responsible for sequencing compatibility →
  download.
- `pauseDownload()` / `resumeDownload()` MUST no-op (not throw) if there is
  no active download to pause/resume for a given source, matching the
  underlying resource fetcher's own `ResourceFetcherAlreadyPaused` /
  `ResourceFetcherAlreadyOngoing` guards described in research.md — this
  contract absorbs those into safe no-ops so screens don't need to track
  fetcher-internal state to avoid throwing.

## Postconditions

- After `startDownload()` resolves, `getState().downloadStatus` is either
  `'downloaded'` (and a SHA-256 integrity check has already run —
  `integrityVerified` reflects its real result, not an optimistic default)
  or `'failed'` — never left at `'downloading'`.
- `isReadyForInference()` returning `true` is the *only* signal the
  inference module (see `inference-pipeline.contract.md`) is permitted to
  treat as "safe to load the model." A `downloadStatus: 'downloaded'` with
  `integrityVerified: false` MUST still report `isReadyForInference() ===
  false` (FR-012/FR-013 — corrupt model routes to download screen, not into
  an inference attempt).
- A `'failed'` integrity check MUST delete the corrupt local file before the
  module reports `'failed'`, so a subsequent `startDownload()` is always a
  clean re-download rather than resuming corrupt bytes (data-model.md,
  `OnDeviceModel` validation rules).

## Error handling

- `checkDeviceCompatibility()` is synchronous and MUST NOT throw — an
  inability to read device info (e.g. a native module failure) is itself an
  `isSupported: false` result with a `reason` explaining that compatibility
  could not be determined, consistent with "graceful degradation over
  crashes" (constitution Principle III) applying even to the compatibility
  check itself.
