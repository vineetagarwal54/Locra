# Phase 0 Research: Context Routing and Answer Quality

Each item below resolves one NEEDS-CLARIFICATION-shaped question from the plan's Technical Context, in the format Decision / Rationale / Alternatives Considered.

## 1. Token-budget measurement mechanism

**Decision**: Measure the router's context-selection budget with a calibrated character-to-token estimate — the same `Math.ceil(length / 3)`-style ratio already used by `ContextWindow.estimateMessageTokens` — rather than calling `llama.rn`'s native `tokenize()` for every candidate source during router selection. Use the real native `tokenize()` call (confirmed available at `node_modules/llama.rn/src/index.ts:874`, `context.tokenize(text): Promise<{ tokens: number[] }>`) offline, during Phase 4 implementation and in a one-time calibration test, to verify/tune the exact ratio against representative Locra transcripts for Qwen's actual tokenizer — not as a per-request runtime call.

**Rationale**: A native `tokenize()` call is async, requires an active/loadable native context, and — unlike a native `embedding()` call already resource-locked for a distinct purpose — would add a round-trip into native code for every candidate the router considers on every request. That conflicts with keeping routing/budgeting a fast, synchronous, dependency-free JS computation and risks contention with the single-flight `DeviceResourcePolicy` if the context isn't already resident. `ContextWindow` already made this exact tradeoff for the final hard trim and it has shipped successfully; reusing its ratio keeps the two budgeting layers (router selection, final trim) consistent by construction rather than by coincidence, which directly resolves the Section 1 "two measurements aren't calibrated against each other" gap.

**Alternatives considered**:
- *Call `tokenize()` live per candidate*: most accurate, but adds native round-trips to the hot routing path and couples routing latency to native context availability; rejected for the reasons above.
- *Keep raw character counts*: simplest, but is exactly the problem being fixed (spec Problem/Goals §1) — character budgets don't track the real 4096-token Qwen context window, especially as content mixes short/long words, code, and non-Latin text.
- *Adopt a third-party JS tokenizer library (e.g., a BPE tokenizer package)*: would need to exactly match Qwen's tokenizer to be worth the dependency; adds a new native/JS dependency for marginal accuracy gain over a calibrated ratio, and isn't justified without a demonstrated accuracy gap in calibration testing.

## 2. Conversational-reference classification heuristic

**Decision**: Extend the existing regex/lexical-overlap approach already used in `ContextOrchestrator` (`VISUAL_REFERENCE_PATTERN`, `TOKEN_STOP_WORDS`, `lexicalOverlap`) with a new `CONVERSATIONAL_REFERENCE_PATTERN`-style deterministic check: pronouns and demonstratives ("it", "that", "this", "they", "those", "these"), continuation phrases ("also", "again", "what about", "and if", "does that", "the other one", "same as"), and a length/structure heuristic (very short messages with no independent subject default to follow-up, per spec's conservative-default edge case). No ML classifier, no additional model inference.

**Rationale**: The codebase already has a working, tested precedent for exactly this kind of deterministic linguistic-signal classification (image-relevance detection). Reusing the same style keeps classification synchronous, offline, and trivially unit-testable with fixed input/output pairs — matching Constitution IX ("no new on-device classifier model") and the spec's explicit non-goal of adding a second inference pass.

**Alternatives considered**:
- *Small on-device intent-classification model*: rejected — adds a dependency, an approval gate, and non-determinism risk for a problem a regex/heuristic already solves adequately in the existing codebase pattern.
- *Full syntactic parse (dependency parsing) to detect anaphora*: rejected as significant overkill and a new dependency for a mobile app; the conservative "default to follow-up when ambiguous" rule (spec edge case) tolerates heuristic imprecision safely.

## 3. Lexical/semantic fusion algorithm

**Decision**: Reciprocal Rank Fusion (RRF): for a candidate appearing at rank `r` in a ranked list, its contribution is `1 / (k + r)` with `k = 60`; a candidate's fused score is the sum of its contributions across the lexical-overlap ranking and the cosine-similarity ranking (zero contribution from a list it doesn't appear in). Dedup by source message, keep the higher-scoring instance, then apply the existing deterministic tie-break (`createdAt` desc, then `stableId` asc) from `compareRetrievedItems`.

**Rationale**: RRF needs no score normalization between lexical-overlap counts (small integers) and cosine similarity (0–1 floats) — a common failure mode when naively summing heterogeneous scores. It's a standard, well-understood hybrid-search technique, entirely deterministic, and requires no new dependency (a handful of arithmetic lines). It directly satisfies spec FR-014's requirement that fusion never let semantic scoring silently discard an exact lexical match: an item ranked #1 lexically always receives a meaningful RRF contribution even if it has no or a weak semantic match.

**Alternatives considered**:
- *Weighted linear combination of normalized scores*: requires picking and justifying normalization + weighting constants with no natural scale; more tunable surface area than RRF for no demonstrated benefit at this corpus size.
- *Semantic-first with lexical as tie-break only*: this is close to today's `HybridRetriever` behavior (semantic replaces lexical when embeddings are present) — exactly what spec FR-014 requires changing.

## 4. Cross-chat exclusion storage (Phase 7)

**Decision**: Add `excluded_from_cross_chat INTEGER NOT NULL DEFAULT 0` to the `conversation` table via a new entry in `src/persistence/sqlite/Migrations.ts`, bumping `SCHEMA_VERSION` from `3` to `4`. Store the global cross-chat opt-in as a new boolean key in the existing MMKV `settingsStore`, following the same pattern as `defaultResponseMode`.

**Rationale**: `Migrations.ts` already implements an ordered, transactional migration runner (`LATEST_SCHEMA_VERSION`, `PRAGMA user_version` stamped last inside the migration transaction) — confirmed by reading `src/persistence/sqlite/Schema.ts` and `Migrations.ts` directly. A new column is exactly the kind of forward migration this mechanism exists for; it does not require (and per Constitution VIII's production-safety expectations, should not use) a destructive schema reset. The MMKV settings pattern for a small global flag is already established and approved (Constitution VIII: "MMKV remains permitted ONLY for small settings and lifecycle flags").

**Alternatives considered**:
- *A separate `cross_chat_exclusion` join/lookup table*: unnecessary normalization for a single boolean per conversation; a column is simpler and sufficient (Constitution V, minimal TypeScript/schema).
- *Store exclusion in MMKV keyed by conversation ID*: rejected — conversation-scoped facts belong in SQL with the rest of the conversation row (Constitution VIII), and an unbounded MMKV key set per conversation reintroduces the unindexed-growth problem SQL was adopted to solve.

## 5. Task-sensitive output-length targeting (Phase 5)

**Decision**: Add a small classification-aware resolver, `resolveGenerationTarget(mode, classification)`, layered on top of the existing `getResponseModeConfig`/`getResponseTokenBudget`/`getResponseGenerationLimit` functions: for a request classified as an independent text question or a short text follow-up, apply a reduced soft-target multiplier (exact ratio pinned by test, e.g. targeting the low end of the mode's range) rather than the mode's full soft target; other classifications use the existing mode config unchanged.

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

## 7. Deterministic grounding/hallucination heuristic (Phase 8, non-blocking)

**Decision**: Deferred design note only, per spec Section 14 (Phase 8 is optional and built after Phases 1–7 are stable). Working direction: extract "claim tokens" from the answer — numbers, quoted or extracted-text spans, capitalized color/object nouns — and check each against the token/text set of the evidence and retrieved content that was actually included in context for that turn; flag the turn if a claim token has no match. This is intentionally the same lightweight, deterministic, no-second-inference-pass shape as the existing lexical-overlap relevance checks already in `ContextOrchestrator`.

**Rationale**: Recorded now so Phase 8 isn't a blank slate later, but explicitly not designed to production detail — spec FR-036 and Section 14 both require this to be non-blocking for Phases 1–7, and over-designing it now would risk coupling earlier phases to a heuristic that hasn't been validated against real false-positive/negative rates yet.

**Alternatives considered**: Not evaluated in depth at this time — deferred to Phase 8's own research pass, consistent with the phased scope.
