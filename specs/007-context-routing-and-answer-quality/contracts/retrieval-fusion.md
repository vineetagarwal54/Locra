# Contract: Lexical/Semantic Fusion and Hybrid Retrieval

**Module**: extended `src/retrieval/HybridRetriever.ts` | Consumers: `inference/ContextOrchestrator.ts`

## Pinned constants (versioned; change only via recorded evaluation)

- Cosine similarity threshold: `COSINE_SIMILARITY_THRESHOLD = 0.62` (unchanged from Spec 006).
- Fusion method: Reciprocal Rank Fusion, `k = 60` (research.md §3).

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

- **MUST** support three outcomes per call: fused hybrid (both lexical and semantic candidates present), lexical-only fallback (embeddings missing/stale/incompatible/no query vector), or empty (no candidate clears the threshold / no lexical candidates either) (spec FR-013).
- **MUST NOT** let a present semantic ranking silently discard a candidate that ranks highly in the lexical ranking; fusion combines both rankings via RRF rather than replacing one with the other (spec FR-014). This changes today's behavior, where a non-empty semantic candidate set currently bypasses lexical scoring entirely.
- **MUST** dedupe fused results by `sourceMessageId`, keeping the higher fused-score instance, then apply the existing deterministic tie-break (`createdAt` desc, `stableId` asc) from `compareRetrievedItems`.

## Query-time embedding (new wiring)

- `ContextOrchestrator` **MUST** produce a `queryVector` for the current request text via `EmbeddingService.embed([text])` when the embedding runtime is active (manifest approved and loaded), and pass it into `HybridRetriever.search` (spec FR-015). Today, `ContextOrchestrationOptions.queryVector` is defined but never populated by any production caller — this contract closes that gap.
- Query embedding generation **MUST** acquire the same `DeviceResourcePolicy` `'embedding'` lease already used by `EmbeddingService.embed`, respecting the existing single-flight exclusivity with answer generation, compaction, recording, and transcription.

## Embedding-manifest gate (unchanged)

- Semantic retrieval (query embedding + `HybridRetriever`'s use of semantic candidates) **MUST** remain inert — falling back to lexical-only — until the pre-existing embedding-artifact approval (manifest hash, license, device-compatibility verification) is granted, exactly as `EmbeddingService`/`EmbeddingBackfill` behave today (spec FR-016). This feature does not grant that approval.
- `EmbeddingBackfill` **MUST** continue to run under the exclusive resource policy and MUST NOT block answering; requests use lexical-only fallback while backfill is incomplete (spec FR-017).

## Invariants

- Retrieved items from any scope remain source-attributed and formatted as untrusted content (`[Untrusted source: conversation X, message Y]`), unchanged from Spec 006 (spec FR-019).
- Scope filtering (which conversation IDs are eligible) is always applied before scoring, for both same-chat (today) and cross-chat (Phase 7) scope (spec FR-018) — unchanged principle from Spec 006 FR-016, now explicitly required to extend cleanly to cross-chat scope without altering same-chat-only results.
