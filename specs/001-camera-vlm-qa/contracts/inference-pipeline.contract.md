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
