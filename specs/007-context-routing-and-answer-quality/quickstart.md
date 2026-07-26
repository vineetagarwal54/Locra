# Quickstart: Validating Context Routing and Answer Quality

This guide runs the manual validation criteria from `spec.md` Section 11 against a local development build, using the existing beta diagnostics export as the source of truth for what the router actually did. It does not duplicate contract details — see `contracts/` and `data-model.md` for the shapes referenced below.

## Prerequisites

- A local Android development build with the model already downloaded and verified (`npx expo run:android`, per `AGENTS.md` Build Strategy).
- `Settings → Beta Tools → Diagnostics Export` available (existing Spec 006 feature) to inspect per-turn `ContextSelectionDiagnostics`.
- At least one conversation with: some unrelated prior turns, a durable fact or two, a rolling summary (long enough conversation), and one attached image — plus a second conversation for cross-chat scenarios (Phase 7 only).
- Phases implemented up through the one you're validating (see `plan.md` Implementation Phases) — earlier phases must be exercised first since later phases build on them.

## Phase 1 — Diagnostics-only routing visibility (observation only)

1. Ask an independent factual question in a chat with unrelated history/facts/summary/image.
2. Export diagnostics for that turn.
3. **Expected**: the turn's `ContextSelectionDiagnostics` records `classification.isIndependentTextQuestion = true` and shows what sources *would* be selected — but the actual answer still uses today's Spec 006 fixed-assembly behavior (no behavior change yet).

## Phase 2 — Image identity, reference resolution, and original-pixel follow-ups

1. Attach a new image, ask a question about it (new image question) → confirm evidence appears and diagnostics show `imageDecision`.
2. Ask a non-pixel-dependent follow-up about the same image → confirm no re-inference occurs (`imageDecision: 'use-evidence'`).
3. Ask a pixel-dependent follow-up (e.g., "how many are there", "what does it say", "what's the price") → confirm a new inference runs through the Qwen vision path (visible as a fresh evidence timestamp / new inference trace tied to a new inference call) and `imageDecision: 'use-original'`.
4. Attach a second image, then reference the first one explicitly and unambiguously (e.g., "the first image") → confirm the correct (first) image's evidence/original is used, never the second.
5. Attach a third image, then ask about "the image" with no disambiguating detail → confirm diagnostics show `imageReferenceAmbiguous: true` and the router resolves against the current (third) active image rather than guessing among the first two.
6. Delete/remove the referenced image's file (or use a fixture with a missing asset) and repeat a pixel-dependent question about it → confirm the response reports the original as unavailable; repeat with a non-pixel-dependent question → confirm stored evidence still answers if sufficient.

## Phase 3 — Minimal-context request routing

1. Repeat the Phase 1 independent-question scenario → confirm the answer itself now reflects zero prior turns/summary/facts/image evidence (diagnostics `selected` counts are zero, not just `considered`).
2. Ask a follow-up with a genuine reference to prior context → confirm only the needed recent turns are included, per diagnostics.
3. In a long conversation, ask about an earlier topic → confirm relevant facts/summary/retrieved items appear; ask an unrelated independent question in the same long conversation → confirm none of that older material leaks in.

## Phase 4 — Model-aware token budgeting

1. Export diagnostics for a few turns across Low/Medium/High modes and confirm `budget.maximumUnits`/`budget.usedUnits` are now token-denominated (cross-check roughly against message length ÷ calibration ratio, not raw character count) and reflect the selected-context-pool bucket only, not the full context window.
2. Construct a conversation deliberately near the token limit (many long turns) and confirm the router's selection never triggers `ContextWindow`'s `inputShortenedWarning` for content the router itself should have already excluded — i.e., the two budgets agree via the tier-2 final `tokenize()` check (spec FR-027, MV-016).
3. Confirm the current request and an explicitly referenced image's evidence are never evicted even under a deliberately tight budget (e.g., temporarily force Low mode with a very long pasted message).
4. Ask an independent question in a chat with a very long history → confirm no recent-turn floor is ever consumed or "protected but empty" in diagnostics; the eviction accounting simply shows current-request-only.

## Phase 5 — Generation length, repetition, and stopping improvements

1. Ask a short, independent factual question in each mode → confirm the answer length trends short regardless of mode, not padded to the mode's soft target (MV-011).
2. Ask a genuinely detailed question (e.g., a long-context retrieval request, or a High-mode request explicitly asking for detail) → confirm the answer is not artificially shortened by the classification-aware target.
3. Use an existing known loop-prone prompt/fixture (per `src/evaluation` baselines) → confirm generation stops noticeably earlier than the hard limit and the answer is still cleaned up (no visible repeated tail).
4. Confirm a genuinely long, complete High-mode answer is unaffected (not truncated early by the loop detector on legitimate non-repeating long content).
5. Cancel an in-flight generation and separately trigger a loop-stop → confirm both preserve the partial text already streamed, matching existing Spec 006 interruption-recovery behavior.

## Phase 6 — Same-chat semantic embedding activation and hybrid fusion (gated)

> Only testable once the pre-existing embedding-artifact approval has landed and the runtime is wired with an approved manifest; until then this phase should show `retrievalMode: 'lexical-fallback'` for every turn, which is itself the expected/passing state — not a failure.

1. With the embedding runtime active, ask a question that has both an exact lexical match (a specific number, price, date, or name) and a semantically related (but not lexically overlapping) passage earlier in the conversation → confirm diagnostics show `retrievalMode: 'fused'` and that the exact match is not dropped from the results (the exact-match guarantee, spec FR-019a).
2. Temporarily simulate a stale/incompatible embedding version, or force an embedding-call failure → confirm retrieval falls back to `retrievalMode: 'lexical-fallback'` without failing the request in either case.

## Phase 7 — Optional scoped cross-chat retrieval (gated on Phases 1–6 stability)

1. Confirm the global cross-chat setting defaults to off; ask a question in Chat A with clearly relevant content only in Chat B → confirm no cross-chat content appears, per diagnostics (`crossChatActive: false`, zero other-conversation items).
2. Enable the setting; repeat the question → confirm relevant, attributed, untrusted content from Chat B appears.
3. Mark Chat B excluded from cross-chat; repeat the question → confirm Chat B's content no longer appears even though the global setting is still on.
4. Disable the global setting → confirm the very next message in any chat stops including cross-chat content, no restart required.

## Phase 8 — Optional grounding diagnostics (gated on Phases 1–7 stability)

1. Ask a pixel-dependent question about an image with clear evidence, and confirm `groundingVerdict: 'supported'` when the answer matches the evidence.
2. Construct or find a case where the model's answer states a claim not present in the included evidence/retrieved text (e.g., a fabricated count) → confirm `groundingVerdict: 'unsupported'` appears in diagnostics, with no visible change to the answer itself.

## Phase 9 — Final manual device validation

Run this phase after Phases 1–8 (whichever are implemented) land, and also run its regression sub-steps after each individual phase as a smoke check — any regression blocks moving to the next phase.

1. Work through the full manual validation matrix (spec Section 11, MV-001 through MV-018) on a physical device.
2. **Final airplane-mode operation (MV-017)**: put the device in airplane mode and exercise classification, image re-inference, token budgeting, retrieval fusion (if active), cross-chat scope resolution (if active), and generation controls — confirm zero network calls anywhere in this feature's code paths.
3. **Broad regression (MV-018)**: run the existing Spec 006 physical-device checklist — History pagination/search, model download/verify, generation cancellation, checkpoint/recovery, durable images — and confirm all of it still passes unchanged.
