# Contract: Retrieval (embeddings, vectors, hybrid assembly)

**Module**: `src/retrieval/` + extended `src/inference/ContextOrchestrator.ts` | Consumers: `store/conversationStore.ts`

## Pinned constants (versioned; change only via recorded evaluation)

- **Cosine similarity threshold**: `0.62` (candidates below it excluded).
- **Chunking**: max `800` characters/chunk, `120`-character overlap, `chunk_version`; short messages (≤800) = one unit.
- **Context budget units**: characters, measured by `CharacterContextBudgetPolicy`.

## EmbeddingService  ⛔ gated by approved embedding manifest

```ts
embed(texts: string[]): Promise<Float32Array[]>; // on-device via llama.rn; resource-locked (DeviceResourcePolicy)
readonly modelId: string;
readonly modelArtifactHash: string;
readonly embeddingVersion: string;
readonly dimensions: number;
```

- **MUST** run fully offline and acquire the `DeviceResourcePolicy` lease (never concurrent with Qwen answer/compaction, recording, or transcription) — FR-018/045.
- **MUST** be covered by a failing-test-first lifecycle suite before implementation (Constitution VI): artifact model/version/hash persistence, dimensions, source revision, lock acquire/release, failure handling, and the ≤25-item backfill batch limit.

## EmbeddingBackfill  ⛔ gated

```ts
enqueue(sourceRefs): void;      // new/changed derived units after terminal persistence
runIdleBatch(): Promise<void>;  // ≤ 25 units per batch, resource-locked, yields to user-visible work (FR-019)
```

## VectorIndex / HybridRetriever

```ts
search(input: {
  queryVector: Float32Array;
  conversationIds: string[];   // scope filter applied BEFORE scoring (FR-016); resolved upstream (default = active only)
  threshold: number;           // pinned 0.62 (FR-017)
  limit: number;               // mode-specific (same-chat vs selected-chat) result cap
}): Promise<RetrievedItem[]>;
```

```ts
interface RetrievedItem {
  sourceConversationId: string; sourceMessageId: string; imageAssetId: string | null;
  timestamp: number; contentType: 'chunk' | 'evidence' | 'fact'; score: number; text: string;
}
```

- **MUST** cosine-score only in-scope, compatible (`ready`, matching `embedding_version` + `model_artifact_hash`) vectors.
- **MUST** dedupe by source message and order deterministically: score DESC → timestamp DESC → id ASC (FR-017, SC-007).
- Empty result set adds **no filler**.
- Retrieved items retain full source references and **MUST NOT** be presented as originating in the active conversation.

## LexicalFallbackRetriever

```ts
search(input): Promise<RetrievedItem[]>; // deterministic token-overlap; used when compatible vectors are missing/stale/failed (FR-020)
```

- Guarantees retrieval never *fails* due to absent/rebuilding embeddings; the hybrid path degrades to lexical + exact context.

## ChunkingService

```ts
chunk(message: { id; text; conversationId; imageAssetId? }): Chunk[]; // 800/120 windows above threshold; else one unit (FR-023 refs)
```

## ConversationTargetResolver (single-chat targeting; FR-037/038/039/041)

```ts
resolve(reference: { rawText?: string; selectedId?: string }): Promise<
  | { kind: 'active' }                                     // default; no cross-chat
  | { kind: 'scoped'; conversationId: string }            // exactly one resolved past chat
  | { kind: 'ambiguous'; candidates: ConversationCandidate[] } // ≤10; require user selection
  | { kind: 'not-found' }                                 // referenced chat deleted/missing
>;
```

- Default scope is `active`; broadens only to **exactly one** explicitly named/selected past conversation. Candidate lookup is bounded to **≤10** via `normalized_title` tokens + dates; **no content/vector search before resolution**.
- Unbounded "search all chats" is **out of scope** — the resolver never returns a multi/all-chat scope.

## ContextOrchestrator (refactored in the hybrid-context phase)

`orchestrate(projection, { responseMode, target })` assembles context in the fixed priority order (FR-015):

1. current request → 2. recent exact turns (mode floor, never dropped) → 3. explicitly referenced image evidence → 4. same-chat vector-retrieved items → 5. explicitly selected past-chat retrieved items → 6. durable facts → 7. eligible older-range summary.

- Consumes the SQL **canonical projection** (active completed attempts only).
- Vector retrieval **supplements** and never replaces the recent-turn floor (FR-017); budget overflow drops lowest-priority-first while keeping current request + referenced image + recent-turn floor.
- **Mode config wiring** (recent-turn floor, budgets, retrieval limits, generation limits) and **active-vs-referenced image-evidence resolution** are wired into the orchestrator **here** (after the refactor), not in the earlier mode/image phases.
- Output remains the existing `CanonicalConversationContext`; the `ContextBuilder` message-building contract is unchanged.
