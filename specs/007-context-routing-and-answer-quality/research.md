# Phase 0 Research: Context Routing and Answer Quality

Each item below resolves one NEEDS-CLARIFICATION-shaped question from the plan's Technical Context, in the format Decision / Rationale / Alternatives Considered.

## 1. Token-budget measurement mechanism

**Investigation**: `llama.rn` 0.12.5 (the currently linked version) exposes a real native tokenizer call on its context object: `context.tokenize(text, { media_paths? }): Promise<NativeTokenizeResult>` (`node_modules/llama.rn/src/index.ts:874`), plus `detokenize()`. This is the same context object already used for `embedding()` and `stopCompletion()`. No new dependency is required to use it — it is already linked and already exercised elsewhere in the codebase's design (embedding).

**Decision (two-tier, per spec FR-026b — prefer runtime-backed counting when safely available, else a calibrated estimator)**:
1. **Iterative candidate selection/ranking** (the router evaluating many recent turns, facts, summary entries, and retrieved candidates while assembling context): use a conservative, deterministic, Qwen-calibrated character-to-token estimator with safety headroom — starting from the same `Math.ceil(length / 3)`-style ratio already used by `ContextWindow.estimateMessageTokens`, then recalibrated (see below). This is **not** "safely available" runtime counting: calling native `tokenize()` once per candidate, for every candidate, on every request, would add an async native round-trip to a loop that today is fast, synchronous, in-process JS, and would risk contention with the single-flight `DeviceResourcePolicy` if the native context isn't already resident for this request.
2. **Final assembled-prompt verification**: once the router has selected its final source set for a request that is about to run inference anyway (i.e., the native context is being acquired for that same request's completion, not a separate resource lease taken solely for counting), call the real `tokenize()` on the fully assembled prompt as a safety-headroom check before generation starts. This is "safely available" runtime counting — one call, reusing a context acquisition the request needed regardless — and gives an exact reconciliation with `ContextWindow`'s hard trim (FR-027) instead of two independently-calibrated estimates that could drift apart.
3. **Offline calibration**: use the real `tokenize()` call, run once during Phase 4 implementation (and revisited only through recorded evaluation) against a representative set of Locra transcripts, to tune the exact character-to-token ratio and per-mode token budgets used by tier 1's estimator — not as a per-request runtime call.

**Rationale**: This directly satisfies FR-026b's ordering — real counting where it can be obtained essentially for free (tier 2), a calibrated deterministic estimate where a live native call would harm latency or single-flight safety (tier 1) — while resolving the Section 1 "two measurements aren't calibrated against each other" gap: tier 2's exact check is the reconciliation point between the router's own budget and `ContextWindow`'s hard trim, rather than hoping two separately-calibrated estimates happen to agree.

**Alternatives considered**:
- *Call `tokenize()` live per candidate during selection*: most accurate, but adds native round-trips to the hot routing path and couples routing latency to native context availability; rejected for tier 1, adopted only for the single final-prompt check (tier 2).
- *Keep raw character counts everywhere*: simplest, but is exactly the problem being fixed (spec Problem/Goals §1) — character budgets don't track the real 4096-token Qwen context window, especially as content mixes short/long words, code, and non-Latin text.
- *Adopt a third-party JS tokenizer library (e.g., a BPE tokenizer package)*: would need to exactly match Qwen's tokenizer to be worth the dependency; adds a new native/JS dependency for marginal accuracy gain over the two-tier approach above, and the spec explicitly prohibits adding a dependency solely for token counting (FR-026b).
- *Never use real `tokenize()` at all*: rejected — it's already linked and safely usable for the one-call-per-request final check, so declining to use it there would leave FR-026b's "prefer runtime-backed counting when safely available" unmet without a real reason.

## 2. Conversational-reference classification heuristic

**Decision**: Extend the existing regex/lexical-overlap approach already used in `ContextOrchestrator` (`VISUAL_REFERENCE_PATTERN`, `TOKEN_STOP_WORDS`, `lexicalOverlap`) with a new `CONVERSATIONAL_REFERENCE_PATTERN`-style deterministic check: pronouns and demonstratives ("it", "that", "this", "they", "those", "these"), continuation phrases ("also", "again", "what about", "and if", "does that", "the other one", "same as"), and a length/structure heuristic (very short messages with no independent subject default to follow-up, per spec's conservative-default edge case). No ML classifier, no additional model inference.

**Rationale**: The codebase already has a working, tested precedent for exactly this kind of deterministic linguistic-signal classification (image-relevance detection). Reusing the same style keeps classification synchronous, offline, and trivially unit-testable with fixed input/output pairs — matching Constitution IX ("no new on-device classifier model") and the spec's explicit non-goal of adding a second inference pass.

**Alternatives considered**:
- *Small on-device intent-classification model*: rejected — adds a dependency, an approval gate, and non-determinism risk for a problem a regex/heuristic already solves adequately in the existing codebase pattern.
- *Full syntactic parse (dependency parsing) to detect anaphora*: rejected as significant overkill and a new dependency for a mobile app; the conservative "default to follow-up when ambiguous" rule (spec edge case) tolerates heuristic imprecision safely.

## 3. Lexical/semantic fusion algorithm

**Decision**: Reciprocal Rank Fusion (RRF): for a candidate appearing at rank `r` in a ranked list, its contribution is `1 / (k + r)` with `k = 60`; a candidate's fused score is the sum of its contributions across the lexical-overlap ranking and the cosine-similarity ranking (zero contribution from a list it doesn't appear in). Dedup by source message, keep the higher-scoring instance, then apply the existing deterministic tie-break (`createdAt` desc, then `stableId` asc) from `compareRetrievedItems`. **Exact-match guarantee (spec FR-019a)**: before applying the per-request retrieval limit, any candidate containing a verbatim (case-insensitive) match for a number, price-like token (e.g. `$12.99`), date-like token, or the query's likely proper-noun/identifier token is retained in the final list regardless of its RRF rank — RRF alone cannot guarantee this, since a candidate with a perfect lexical hit but no semantic signal can still be outranked by several moderate semantic matches.

**Rationale**: RRF needs no score normalization between lexical-overlap counts (small integers) and cosine similarity (0–1 floats) — a common failure mode when naively summing heterogeneous scores. It's a standard, well-understood hybrid-search technique, entirely deterministic, and requires no new dependency (a handful of arithmetic lines). The exact-match guarantee is a small, deterministic, additional rule layered on top of RRF, not a replacement for it — it exists specifically because spec item 9 (names/numbers/prices/dates/identifiers) is a correctness requirement RRF's rank-based scoring does not, by itself, satisfy in every case.

**Alternatives considered**:
- *Weighted linear combination of normalized scores*: requires picking and justifying normalization + weighting constants with no natural scale; more tunable surface area than RRF for no demonstrated benefit at this corpus size.
- *Semantic-first with lexical as tie-break only*: this is close to today's `HybridRetriever` behavior (semantic replaces lexical when embeddings are present) — exactly what spec FR-014 requires changing.
- *Rely on RRF alone without an explicit exact-match guarantee*: rejected after considering the failure mode above — a precise factual match (a price, a date, an ID) is exactly the kind of result a user most needs preserved, and RRF's rank-sum design does not structurally protect it.

## 4. Cross-chat exclusion storage (Phase 7)

**Decision**: Add `excluded_from_cross_chat INTEGER NOT NULL DEFAULT 0` to the `conversation` table via a new entry in `src/persistence/sqlite/Migrations.ts`, bumping `SCHEMA_VERSION` from `3` to `4`. Store the global cross-chat opt-in as a new boolean key in the existing MMKV `settingsStore`, following the same pattern as `defaultResponseMode`.

**Rationale**: `Migrations.ts` already implements an ordered, transactional migration runner (`LATEST_SCHEMA_VERSION`, `PRAGMA user_version` stamped last inside the migration transaction) — confirmed by reading `src/persistence/sqlite/Schema.ts` and `Migrations.ts` directly. A new column is exactly the kind of forward migration this mechanism exists for; it does not require (and per Constitution VIII's production-safety expectations, should not use) a destructive schema reset. The MMKV settings pattern for a small global flag is already established and approved (Constitution VIII: "MMKV remains permitted ONLY for small settings and lifecycle flags").

**Alternatives considered**:
- *A separate `cross_chat_exclusion` join/lookup table*: unnecessary normalization for a single boolean per conversation; a column is simpler and sufficient (Constitution V, minimal TypeScript/schema).
- *Store exclusion in MMKV keyed by conversation ID*: rejected — conversation-scoped facts belong in SQL with the rest of the conversation row (Constitution VIII), and an unbounded MMKV key set per conversation reintroduces the unindexed-growth problem SQL was adopted to solve.

## 5. Task-sensitive output-length targeting (Phase 5)

**Decision**: Add a small classification-aware resolver, `resolveGenerationTarget(mode, classification)`, layered on top of the existing `getResponseModeConfig`/`getResponseTokenBudget`/`getResponseGenerationLimit` functions: for a request classified as an independent text question or a short text follow-up, apply a reduced soft-target multiplier selected through recorded manual evaluation rather than the mode's full soft target; other classifications use the existing mode config unchanged.

**Rationale**: Response modes (Low/Medium/High) already express *user-chosen* verbosity; classification expresses *task-shape*. A mode-only target means a Low-mode user still gets padded toward ~192 tokens for a two-word factual answer. Layering classification on top keeps the existing, tested mode system intact (spec Non-Goal: not changing response-mode generation limits) while adding the finer-grained signal the spec requires (FR-032/FR-034).

**Alternatives considered**:
- *Add a fourth response mode ("very low")*: rejected — conflates a user setting with a per-request signal; the user didn't choose a different mode, the question shape did.
- *Let the system prompt alone handle conciseness*: already tried (existing `getResponseModeInstruction` conciseness wording) and insufficient per the spec's stated problem — prompting alone doesn't reliably cap length or prevent padding.

## 6. Earlier in-stream loop stopping (Phase 5)

**Decision**: During streaming, run a lightweight incremental variant of the existing tail-loop check (`collapseLoopingTail`'s detection logic in `AnswerPostProcessor`) against the growing buffer at the same throttle interval already used for streaming checkpoints (Spec 006 FR-A02). When a loop is confirmed, call the existing `stopCompletion()` native method (already wired in `QwenLlamaRuntime.ts` for user-initiated cancellation) to end generation, then run the existing full post-processing pass on the truncated buffer.

**Rationale**: This reuses two already-shipped mechanisms — the streaming-checkpoint throttle and the native stop path — rather than introducing a new cancellation mechanism or native call. It directly reduces wasted generation (and battery) on a loop that would otherwise run to the hard `n_predict` limit before post-processing ever sees it (spec FR-033).

**Alternatives considered**:
- *Only ever clean up after full generation completes (today's behavior)*: correct but wasteful — the model keeps generating tokens for a loop that's already been detected.
- *Lower `n_predict` globally to reduce loop cost*: rejected — this is a blunt instrument that would also truncate legitimately long High-mode answers; it doesn't address the actual defect (a loop, not a long answer).

**Runtime-verification requirement (spec FR-036a)**: `stopCompletion()`'s availability and behavior were confirmed by reading the currently linked `llama.rn` 0.12.5 source directly (`node_modules/llama.rn/src/index.ts:869`), not assumed from memory or from a different version's documentation. Before Phase 5 implementation, re-confirm this call shape against whatever `llama.rn` version is actually linked at that time, and manually validate on a physical device that a mid-stream `stopCompletion()` call behaves as expected (stops generation, preserves already-streamed text) before pinning any specific detection threshold or stop-trigger constant. If a future `llama.rn` upgrade exposes a more direct repetition-penalty or stop-sequence API, that should be evaluated against this same manual-validation bar before being adopted in place of the buffer-scan approach above — no exact sampling/stopping value in this feature is chosen without that check.

**Phase 5 re-verification (2026-07-26)**: The linked source still exposes
`stopCompletion(): Promise<void>` at `src/index.ts:869`. Physical-device
verification of loop-triggered stopping and partial-text preservation was
explicitly deferred by the user, so T034 remains incomplete while T035–T041
implementation proceeds.

## 7. Deterministic grounding/hallucination heuristic (Phase 8, non-blocking)

**Decision**: Deferred design note only, per spec Section 14 (Phase 8 is optional and built after Phases 1–7 are stable). Working direction: extract "claim tokens" from the answer — numbers, quoted or extracted-text spans, capitalized color/object nouns — and check each against the token/text set of the evidence and retrieved content that was actually included in context for that turn; flag the turn if a claim token has no match. This is intentionally the same lightweight, deterministic, no-second-inference-pass shape as the existing lexical-overlap relevance checks already in `ContextOrchestrator`.

**Rationale**: Recorded now so Phase 8 isn't a blank slate later, but explicitly not designed to production detail — spec FR-036 and Section 14 both require this to be non-blocking for Phases 1–7, and over-designing it now would risk coupling earlier phases to a heuristic that hasn't been validated against real false-positive/negative rates yet.

**Alternatives considered**: Not evaluated in depth at this time — deferred to Phase 8's own research pass, consistent with the phased scope.

## 8. Ambiguous image-reference default (Phase 2)

**Decision**: When a reference could plausibly mean more than one prior image and the request carries no disambiguating detail (an ordinal like "the first one", a description like "the receipt", or similar), resolve the request as a same-image follow-up against the conversation's current active image, rather than guessing among the older images or refusing to answer. Record the ambiguity and this resolution in diagnostics (spec FR-012a, FR-037).

**Rationale**: The spec requires that missing or ambiguous images never cause another image to be silently substituted. Guessing among two or more equally-plausible older images would be exactly that kind of silent substitution — the router would be picking one specific older image without justification. Defaulting to the current active image is not a guess among *ambiguous* candidates: the active image is a well-defined, already-existing default used throughout Section 5 for same-image follow-ups, so this reuses an existing, unambiguous fallback rather than inventing a new one.

**Alternatives considered**:
- *Ask the user to disambiguate*: would require new UI/conversational-flow beyond this spec's scope (Non-Goals: no broad UI redesign); deferred as a possible future enhancement, not required for this feature.
- *Refuse to resolve and answer with a generic "not sure which image" response*: closer to correct than guessing, but is a product/UX decision about response content, not a routing decision — Locra's task in this feature is to select context, not author response copy. Defaulting to the active image and letting the model's own answer reflect what it was actually shown is simpler and keeps this feature's scope to context selection.
- *Always resolve to the most recently attached image, even calling it an "older-image reference"*: rejected — that would misclassify the request and could cause a false claim of having resolved a specific referenced image; classifying it as a same-image follow-up against the active image is the more honest classification for what's actually happening.

## 9. Implementation-time llama.rn API re-verification (T002)

**Verified on 2026-07-26** against the installed `llama.rn` 0.12.5 source at
`node_modules/llama.rn/src/index.ts`:

- `tokenize(text: string, { media_paths?: string[] } = {}): Promise<NativeTokenizeResult>`
- `detokenize(tokens: number[]): Promise<string>`
- `stopCompletion(): Promise<void>`

All three methods are instance methods on the linked llama context. `tokenize`
forwards the context id, text, and optional media paths to `llamaTokenize`;
`detokenize` forwards the context id and token array to `llamaDetokenize`; and
`stopCompletion` forwards the context id to `llamaStopCompletion`. No new
dependency or network call is needed.
