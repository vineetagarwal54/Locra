# Contract: Generation Quality (Task-Sensitive Limits, Earlier Loop Stopping, Post-Processing)

**Module**: extended `src/inference/GenerationTuning.ts`, `src/inference/AnswerPostProcessor.ts`, `src/inference/llamaRn/QwenRuntimeConfig.ts`/`QwenLlamaRuntime.ts` (streaming hook only) | Consumers: `InferenceService`

## Classification-aware output-length resolution (new)

```ts
export function resolveGenerationTarget(
  mode: ResponseMode,
  classification: RequestClassification,
): { targetTokens: number; generationLimit: number };
```

- **MUST** return the existing `getResponseTokenBudget(mode)`/`getResponseGenerationLimit(mode)` values unchanged for any classification other than a short independent-question/follow-up case (spec Non-Goal: not changing response-mode generation limits wholesale).
- **MUST** return a reduced `targetTokens` (exact ratio selected through recorded manual evaluation) when `classification.isIndependentTextQuestion || classification.isTextFollowUp` is true and no other classification (image/long-context) is also active, so a short, self-contained question is not encouraged to reach the mode's full soft target (spec FR-032/FR-034).
- **MUST NOT** reduce `targetTokens` or `generationLimit` for a request that genuinely needs a longer answer (e.g., `isLongContextRetrievalRequest`, or any request where the mode itself calls for detail) — length follows task need in both directions (spec FR-032).
- **MUST NOT** reduce `generationLimit` (the hard `n_predict` cap) below what's needed to finish a normal short answer cleanly — only the soft target shifts; the hard cap keeps its existing safety margin.

## Earlier in-stream loop stopping (new)

- **MUST** run an incremental loop-detection check against the accumulating streamed buffer at the same throttle cadence already used for streaming checkpoints (Spec 006 FR-A02), reusing the detection logic already proven in `AnswerPostProcessor.collapseLoopingTail` (spec FR-033).
- **MUST** use `QwenLlamaRuntime` as the single authoritative owner of a
  loop-triggered native `stopCompletion()` call. Queue streaming consumes the
  runtime's completed `looping` result and does not issue a second abort. User
  cancellation is idempotent and remains distinguishable from loop stopping.
- Deterministic mocked implementation coverage is complete, but native acceptance
  remains open under T034 until physical hardware proves stop, partial-text
  persistence, lease release, next-inference readiness, and no cancellation race.
- **MUST** preserve the partial text already streamed when a loop-triggered stop occurs, exactly as Spec 006's existing checkpointing/interruption-recovery behavior (FR-A02) already guarantees for user-initiated cancellation and failure — this is the same code path, not a new one.
- **MUST** run the existing full post-processing pass (`postProcessAnswer`) on the resulting (now shorter) buffer exactly as it would on a normally completed answer, so the persisted/displayed text is still cleaned and verdict-tagged.

## Post-processing (relaxed requirement)

```ts
export function postProcessAnswer(raw: string): ProcessedAnswer; // existing signature unchanged
```

- **MUST** continue to detect and clean truncation (`'truncated'`) and repetition (`'looping'`) at least as reliably as today's implementation (spec FR-031, baseline preserved).
- MAY be improved (earlier detection, adjusted thresholds, new patterns) as part of this feature — it is explicitly **not** required to remain byte-for-byte identical to the Spec 006 implementation (spec FR-031, relaxed from Spec 006's original wording).
- **MUST** run identically regardless of which context sources informed the answer, including cross-chat-informed answers once Phase 7 ships (spec FR-035) — no answer path bypasses this step.

## Invariants

- No change in this contract adds a second model-generation pass (spec Non-Goal); classification-aware targeting and earlier stopping both act on the single existing generation call.
- Existing `TRUNCATED_ANSWER_NOTICE`/`LOOPING_ANSWER_NOTICE` user-facing strings and verdict semantics (`AnswerVerdict`) are unchanged unless a specific improvement requires updating them.

## Testing note

This contract's behavior (output-length targeting, loop-stop timing, post-processing improvements) is validated manually and via the existing evaluation harness (spec Section 11, MV-011), not by new automated unit tests — generation quality is explicitly outside the five focus areas in spec Section 12. Implementers MAY still add ordinary tests for genuinely deterministic pure helpers if convenient, but none are required by this feature's testing policy.
