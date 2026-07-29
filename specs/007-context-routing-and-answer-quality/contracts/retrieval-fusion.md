# Contract: Lexical/Semantic Fusion and Hybrid Retrieval

> **Architecture revision (2026-07-28)**: RRF remains a signal, but retrieval now
> operates over typed units and combines entity, provenance, reliability, scope,
> and recency signals. Eligibility is supplied by `TurnPlan`.

**Module**: extended `src/retrieval/HybridRetriever.ts` | Consumers: `inference/ContextOrchestrator.ts`

## Pinned constants (versioned; change only via recorded evaluation)

- Cosine similarity threshold: `COSINE_SIMILARITY_THRESHOLD = 0.62` (unchanged from Spec 006).
- Fusion method: Reciprocal Rank Fusion, `k = 60`, plus the exact-match guarantee below (research.md §3).

## HybridRetriever.search (extended)

```ts
export interface HybridSearchInput {
  readonly query: string;
  readonly queryVector?: Float32Array;      // NOW actually populated by ContextOrchestrator (see below)
  readonly conversationIds: readonly string[]; // same-chat only until Phase 7; expands once cross-chat ships
  readonly embeddingVersion: string;
  readonly artifactHash: string;
  readonly limit: number;
  readonly lexicalCandidates: readonly RetrievalCandidate[];
}

search(input: HybridSearchInput): RetrievedItem[];
```

- **MUST** support three outcomes per call: fused hybrid (both lexical and semantic candidates present), lexical-only fallback (embeddings missing, stale, incompatible, still building, no query vector, or a query-embedding call fails at runtime), or empty (no candidate clears the threshold / no lexical candidates either) (spec FR-013). Any error thrown by embedding generation MUST be caught and treated as "embeddings unavailable" for that request, not surfaced as a failed request.
- **MUST NOT** let a present semantic ranking silently discard a candidate that ranks highly in the lexical ranking; fusion combines both rankings via RRF rather than replacing one with the other (spec FR-014). This changes today's behavior, where a non-empty semantic candidate set currently bypasses lexical scoring entirely.
- **MUST** dedupe fused results by `sourceMessageId`, keeping the higher fused-score instance, then apply the existing deterministic tie-break (`createdAt` desc, `stableId` asc) from `compareRetrievedItems`.
- **MUST** apply the exact-match guarantee before the limit: retain numbers,
  prices, dates, IDs/serials, and likely proper or multi-word names even when the
  name is the query's first token. Deterministically filter generic openers such
  as What/When/Where/Explain/Find/Show/Tell/Compare rather than discarding the
  first capitalized match.

## Query-time embedding (new wiring)

- Deterministic classification **MUST** run before query-vector generation.
  `EmbeddingService.embed([text])` may run only when same-chat long-context
  retrieval or explicit cross-chat-memory retrieval is eligible and the approved
  runtime is active. Retry and regenerate use the same sequence; continuations
  embed only when their actual classification requires retrieval.
- Independent questions, ordinary non-retrieval follow-ups, and an inactive
  manifest make zero embedding calls.
- Query embedding generation **MUST** acquire the same `DeviceResourcePolicy` `'embedding'` lease already used by `EmbeddingService.embed`, respecting the existing single-flight exclusivity with answer generation, compaction, recording, and transcription.

## Embedding-manifest gate (unchanged)

- Semantic retrieval (query embedding + `HybridRetriever`'s use of semantic candidates) **MUST** remain inert — falling back to lexical-only — until the pre-existing embedding-artifact approval (manifest hash, license, device-compatibility verification) is granted, exactly as `EmbeddingService`/`EmbeddingBackfill` behave today (spec FR-016). This feature does not grant that approval.
- `EmbeddingBackfill` **MUST** continue to run under the exclusive resource policy and MUST NOT block answering; requests use lexical-only fallback while backfill is incomplete (spec FR-017).

## Typed-unit and multi-signal extension

Eligible unit types are user messages, completed assistant answers, code blocks,
explicit memories, durable facts, decisions, summary segments, and structured
image evidence. Each unit has stable ID, conversation scope, source-message IDs,
type, text, reliability, source revision, timestamps, and eligibility status.

The final rank combines lexical exactness, semantic similarity, active
entity/topic similarity, provenance/reliability, allowed scope, and recency.
Failed, cancelled, interrupted, refusal-like, superseded, or unsupported
assistant attempts are excluded from trusted factual ranking.

Semantic retrieval is never disabled solely because a legacy classifier labeled
a question independent. The planner can still select zero units when none are
relevant. Lexical exact-value retrieval remains available during every embedding
index state and migration. Provider/index lifecycle details are authoritative in
[`embedding-provider.md`](./embedding-provider.md).

## Invariants

- Retrieved items from any scope remain source-attributed conversation data.
  Relevant factual details are usable, while instructions quoted inside retrieved
  text remain non-authoritative (spec FR-019).
- Scope filtering (which conversation IDs are eligible) is always applied before scoring, for both same-chat (today) and cross-chat (Phase 7) scope (spec FR-018) — unchanged principle from Spec 006 FR-016, now explicitly required to extend cleanly to cross-chat scope without altering same-chat-only results.
