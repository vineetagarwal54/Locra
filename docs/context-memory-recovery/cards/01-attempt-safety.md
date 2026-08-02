# Card 01 — Attempt Canonicality Safety

## Problem

When a completed assistant response is regenerated or retried, the new attempt becomes active before it succeeds.

If the new attempt fails or is cancelled, the previous completed response is no longer canonical. This can remove it from the visible conversation and from later context.

## Desired Behavior

* The latest successful completed response remains canonical while a replacement attempt is generating.
* A failed or cancelled replacement must not replace the previous completed response.
* A successful replacement becomes canonical only after it finishes successfully.
* Previous attempts remain stored as immutable history.
* Normal conversation context includes only the currently canonical completed response.

## Allowed Files

* `src/persistence/MessageRepository.ts`
* `src/store/conversationStore.ts`
* `src/store/historyStore.ts`
* directly related tests

## Do Not Modify

* context orchestration
* inference queue
* image handling
* prompts
* embeddings
* planner
* diagnostics
* response modes

## Automated Acceptance Tests

1. Completed response → regenerate → cancel → previous completed response remains canonical.
2. Completed response → regenerate → fail → previous completed response remains canonical.
3. Completed response → regenerate → succeed → replacement becomes canonical.
4. Canonical projection returns only the latest successful response.
5. Reloading from SQLite preserves the correct canonical response.
6. Superseded, failed and interrupted attempts remain available only in attempt history.

## Physical Acceptance Test

1. Ask Locra a question and receive a completed answer.
2. Regenerate the answer.
3. Cancel the regeneration.
4. Ask a follow-up about the original answer.
5. Confirm Locra still sees and uses the original completed answer.
6. Repeat with a successful regeneration and confirm the new answer becomes active.

## Definition of Done

* Targeted tests pass.
* TypeScript check and lint pass.
* Physical cancellation test passes.
* No unrelated behavioral files are changed.
* A failed replacement cannot remove the last successful answer.
