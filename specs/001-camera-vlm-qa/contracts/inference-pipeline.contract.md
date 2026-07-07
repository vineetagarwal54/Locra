# Contract: Inference Pipeline Module

Enforces constitution Principles I (privacy), II (single-flight), IV
(memory safety), and X (no UI imports in this module — see research.md's
"Architecture boundary tension" note for how the one unavoidable
`useLLM` hook call is isolated). Screens depend on this module; this module
depends on nothing under `src/screens/`.

## Public interface

```ts
type InferenceStatus = 'idle' | 'preprocessing' | 'loading_model' | 'streaming' | 'completed' | 'cancelled' | 'errored';

interface InferenceRequest {
  imagePath: string;   // capture output, pre-resize
  question: string;    // FR-024: caller MUST reject empty question before calling submit()
}

interface InferenceState {
  status: InferenceStatus;
  response: string;         // cumulative streamed text so far
  metrics: PerformanceMetrics | null;  // populated only once status === 'completed'
  error: string | null;     // populated only once status === 'errored'
}

interface InferenceEngine {
  submit(request: InferenceRequest): Promise<void>;
  cancel(): void;
  subscribe(listener: (state: InferenceState) => void): () => void; // returns unsubscribe
  getState(): InferenceState;
}
```

## Preconditions

- `submit()` MUST throw (reject) synchronously without acquiring the queue
  lock if another request is already in-flight (`status` is
  `'preprocessing' | 'loading_model' | 'streaming'`) — this is the
  single-flight guarantee (Principle II, FR-006). Callers (screens) are
  expected to disable their own submit control based on `InferenceState`,
  but the module MUST NOT trust the caller to have done so.
- `submit()` MUST perform the ≤512×512 preprocessing ceiling (Principle IV)
  before any model/tensor code runs, and MUST NOT proceed to
  `'loading_model'` unless the `OnDeviceModel` contract (see
  `model-lifecycle.contract.md`) reports the model downloaded and
  integrity-verified.

## Postconditions

- The queue lock acquired at the start of `submit()` is released in every
  exit path: normal completion, `cancel()`, and error — no code path may
  leave `status` stuck in an in-flight value.
- On `cancel()`, `state.response` is discarded (not partially persisted) and
  `status` becomes `'cancelled'` — matches FR-007 and the `QASession` state
  machine in data-model.md (a cancelled session is never written with a
  partial `answer`).
- On `'completed'`, all five `PerformanceMetrics` fields (data-model.md) are
  populated — never a subset (FR-008).
- No network call is made at any point inside this module (Principle I,
  FR-004, FR-022) — enforced structurally by this module never importing
  any networking primitive, not by a runtime check.

## Error handling

- An out-of-memory failure during `'loading_model'` or `'streaming'` MUST
  resolve to `status: 'errored'` with a human-readable `error` message, not
  an unhandled rejection or crash (FR-023, constitution Principle III).
- `subscribe()` listeners MUST be notified of the terminal state
  (`'completed' | 'cancelled' | 'errored'`) even if the screen that called
  `submit()` has since unmounted and re-mounted — state lives in the module,
  not in screen-local state.

## Phase 3 addendum (FR-039–FR-042, FR-049, FR-052, FR-054)

- **Engine adapter abort semantics**: the `InferenceEngineAdapter.generate`
  contract now requires that when the queue aborts the request signal,
  `generate` RESOLVES with the partial response streamed so far — it must not
  reject. The queue drives the same abort path for two distinct outcomes:
  a user cancel (where `cancel()` was called and the resolved partial is
  discarded, preserving FR-007) and the FR-052 output-length cap (where the
  partial completes normally). The queue distinguishes them internally; the
  adapter must not.
- **Streaming callback**: `onToken(cumulativeResponse, generatedTokenCount?)`
  — the optional second argument feeds the app-level output cap. Once
  `generatedTokenCount` reaches the configured budget
  (`OUTPUT_TOKEN_BUDGET`, `src/inference/GenerationTuning.ts`), the queue
  aborts generation and completes with the partial answer plus a visible
  notice in `limitWarning`; this replaces the nonexistent native
  max-tokens setting (`research.md` Phase 3 API Verification).
- **Deterministic history wait, no fixed timeout**: the composition root's
  bridge no longer uses any fixed-duration timer to wait for the engine's
  managed history. It waits on actual observed state (history growth, engine
  error, or signal abort — each of which settles the wait), and skips the
  pre-send history wait entirely when no turn has been served by this engine
  instance in this process (the hydrated-thread case, where the pinned-context
  prompt is self-contained).
- **Preprocessing pipeline**: `submit()`'s preprocessing step is now
  enhance → ceiling: `prepareImageForInference` runs FR-049's
  orient/crop/downscale enhancement first, then the unchanged ≤512×512 hard
  ceiling. Enhancement failure falls back to the original capture — the
  ceiling and its clear errors remain the invariant (Principles III/IV).
- **Post-processing**: on `'completed'`, the response is trimmed and its tail
  assessed (`postProcessAnswer`, FR-054); a truncated or looping tail is
  collapsed/flagged via `limitWarning`, and the persisted answer is always
  the post-processed text.
- **Pinned extraction**: a first (image) turn's completed state carries
  `pinnedExtraction` (FR-041); follow-up turns' effective prompts MUST include
  it (FR-042/FR-044) — verified by `tests/unit/inference/MultiTurnFollowUp.test.ts`
  and `tests/integration/vision-once-chat-flow.test.ts`.
