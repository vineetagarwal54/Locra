# Data Model: Camera Vision Q&A (Phase 1)

All persistence is MMKV (constitution Principle VIII — single local store,
no AsyncStorage, no SQLite in Phase 1). Each entity below maps to one MMKV
key namespace; nested objects are stored as JSON strings under that key,
consistent with "minimal readable TypeScript" (Principle V) over introducing
an ORM/query layer for a dataset this small.

## QASession

The record of one ask-and-answer interaction (spec: Key Entities → "Q&A
Session"; drives User Stories 1, 3, 4).

| Field | Type | Notes |
|---|---|---|
| `id` | `string` (UUID) | Primary key; generated at capture time |
| `createdAt` | `number` (epoch ms) | Set when the request is submitted |
| `imagePath` | `string` | Local file path to the captured (already-preprocessed) image |
| `question` | `string` | Non-empty; FR-024 rejects empty submission before a `QASession` is ever created |
| `answer` | `string` | Empty string while streaming; final text once `status` is `completed` |
| `status` | `'streaming' \| 'completed' \| 'cancelled' \| 'errored'` | `'streaming'` sessions are never persisted (FR-007 — no residual partial output); only terminal states are written to MMKV |
| `errorMessage` | `string \| null` | Populated only when `status === 'errored'` |
| `metrics` | `PerformanceMetrics \| null` | `null` for `cancelled`/`errored` sessions that never reached a completed generation |
| `flagged` | `boolean` | Set by User Story 4's report action; defaults to `false` |
| `flagNote` | `string \| null` | Optional free-text note captured with the flag |

**Validation rules**:
- `question` MUST be non-empty and `imagePath` MUST reference an existing
  file before a session is submitted (FR-024).
- A session only transitions to `status: 'completed'` once, and only from
  `'streaming'` — no re-opening a completed session for further generation
  (multi-turn chat is out of scope for Phase 1, matching the spec's
  single-image, single-question scope boundary).
- Deletion (FR-017/FR-018) removes the MMKV entry entirely; there is no
  soft-delete/tombstone, since FR-018 requires deleted entries be
  unrecoverable through the app.

**State transitions**:

```text
(new request) → streaming → completed
                          → cancelled   (FR-007: user-initiated, no partial answer kept)
                          → errored     (FR-023: e.g. OOM mid-stream)
```

## PerformanceMetrics

Embedded 1:1 in a completed `QASession` (spec: Key Entities → "Performance
Metrics"; drives FR-008/FR-009 and User Story 5's benchmark screen).

| Field | Type | Notes |
|---|---|---|
| `modelLoadTimeMs` | `number` | Wall time from load start to `useLLM`'s `isReady` becoming `true`. `0` on a session where the model was already warm/loaded from a prior session in the same app run. |
| `preprocessingTimeMs` | `number` | Time spent resizing/compressing the captured image to the ≤512×512 ceiling (Principle IV) before it is handed to the model |
| `firstTokenLatencyMs` | `number` | Time from the `sendMessage` call to the first `token` state change |
| `tokensPerSecond` | `number` | `getGeneratedTokenCount()` at completion divided by generation duration |
| `totalWallTimeMs` | `number` | Time from the `sendMessage` call to `isGenerating` returning to `false` |

**Validation rules**: all five fields are required and non-negative on a
`completed` session (FR-008 requires all five to be recorded for *every*
completed inference, no partial metrics).

## OnDeviceModel

Tracks the installed model asset's lifecycle state (spec: Key Entities →
"On-Device Model"; drives User Story 2 and FR-012/FR-013/FR-014). This is
process-derived state reconciled against the filesystem at each app start,
not purely a persisted record — but the last-known state is cached in MMKV
so the setup screen can render instantly before the filesystem check
resolves.

| Field | Type | Notes |
|---|---|---|
| `modelName` | `string` | e.g. `'lfm2.5-vl-1.6b-quantized'` — matches the constant's own `modelName` field (see research.md) |
| `downloadStatus` | `'not_started' \| 'downloading' \| 'paused' \| 'downloaded' \| 'failed'` | Reflects `ExpoResourceFetcher` state; `'paused'` supports FR-014's resumable download |
| `downloadProgress` | `number` (0–1) | Mirrors `useLLM`'s `downloadProgress` while `downloadStatus === 'downloading'` |
| `integrityVerified` | `boolean` | Set only after the app's own SHA-256 check (see research.md — the library does not verify this) passes post-download |
| `lastVerifiedAt` | `number \| null` (epoch ms) | Used to decide whether to re-verify at next cold start vs. trust the cached result |

**Validation rules**:
- The model is only eligible for `useLLM`/inference once `downloadStatus
  === 'downloaded'` AND `integrityVerified === true`. Either condition
  failing routes to the download screen (FR-012).
- A `downloadStatus: 'failed'` or an `integrityVerified: false` result MUST
  clear any partial file via `ExpoResourceFetcher.deleteResources(...)`
  before allowing a retry, so a retry is always a clean download rather
  than resuming from known-bad bytes.

## DeviceCompatibilityResult

The outcome of the pre-load compatibility gate (spec: Key Entities →
"Device Compatibility Result"; drives User Story 2 and FR-010/FR-011). Not
persisted across app restarts — recomputed every launch, since available
memory can change between sessions on the same device.

| Field | Type | Notes |
|---|---|---|
| `isSupported` | `boolean` | Overall gate result |
| `totalMemoryBytes` | `number` | From the device-info check (see research.md — no ExecuTorch-provided API for this) |
| `osVersion` | `string` | Platform version string |
| `reason` | `string \| null` | Human-readable explanation shown on the setup screen when `isSupported` is `false` (e.g. "This device has 4GB RAM; Locra requires at least 6GB" or "Android 13 or newer is required") |

**Validation rules**: `reason` MUST be non-null whenever `isSupported` is
`false` (FR-011 requires the setup screen to explain *why* inference is
unavailable, not just that it is).

## Relationships

```text
DeviceCompatibilityResult  (gate, evaluated once per launch, not stored)
        │
        ▼ (only if isSupported)
OnDeviceModel               (gate, one row, reconciled each launch)
        │
        ▼ (only if downloaded + integrityVerified)
QASession* ──── 1:1 ──── PerformanceMetrics   (embedded, only on completed sessions)
```

`QASession` and `OnDeviceModel` are independent MMKV namespaces; a
`QASession` does not hold a foreign key to `OnDeviceModel` because Phase 1
supports exactly one on-device model at a time (see spec Assumptions) — if
Phase 2 introduces model switching, this would need revisiting.
