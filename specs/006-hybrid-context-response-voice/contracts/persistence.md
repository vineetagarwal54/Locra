# Contract: Persistence (SQL canonical store)

**Module**: `src/persistence/` | Consumers: `store/conversationStore.ts`, `retrieval/`, `inference/CompactionService.ts`, screens (via stores only)

SQLite is the **canonical** store for conversations and all derived context data (Constitution VIII, Phase 2). The ONLY module permitted to import `expo-sqlite` is `src/persistence/sqlite/Database.ts`. There is **no MMKV chat-history migration and no fallback**: this is a development-stage cutover (existing MMKV chat history may be discarded); MMKV is retained only for small settings (e.g. global default response mode, voice model state). Incompatible dev-schema changes are handled by an explicit development-only destructive reset, never a silent production reset.

Repositories expose bounded, indexed, Promise-based queries — **no method returns an unbounded full history**.

## Types (logical)

```ts
interface Page<T> { items: T[]; nextCursor: string | null; } // keyset; items.length ≤ 50 (FR-004)
interface Keyset { ts: number; id: string; } // stable (timestamp, id) cursor
```

## ConversationRepository

```ts
listConversations(cursor: { before?: Keyset; limit: number }): Promise<Page<ConversationSummary>>; // (updated_at DESC, id DESC)
getConversation(id: string): Promise<ConversationHeader | null>;
createConversation(input): Promise<ConversationHeader>;   // response_mode := global default (lowercase) at creation
updateConversation(id, patch): Promise<void>;
setResponseMode(id: string, mode: 'low'|'medium'|'high'): Promise<void>; // per-conversation, lowercase (FR-033)
deleteConversation(id: string): Promise<void>; // one transaction; cascade + unlink image files at zero references
```

- **MUST** page via `(updated_at, id)` keyset (not `OFFSET` scans) and cap `limit ≤ 50`.
- `deleteConversation` **MUST** leave zero orphaned rows (messages, attempts, chunks, embeddings, evidence, summaries, facts, image links) and zero unreferenced image files (SC-014).
- `response_mode` is stored lowercase; conversion to the runtime `Low`/`Medium`/`High` union is done by the single tested conversion function (see response-modes contract), not ad hoc.

## MessageRepository (immutable messages + retry attempts)

One table holds submitted user messages and assistant attempts.

```ts
listMessages(cursor: { conversationId: string; before?: Keyset; limit: number }): Promise<Page<ConversationMessage>>; // (conversation_id, created_at DESC, id DESC)
countMessages(conversationId: string): Promise<number>;
appendUserMessage(msg): Promise<void>;               // immutable on insert (FR-008)
createAssistantAttempt(replyToUserMessageId): Promise<AttemptRef>; // attempt_number auto-increments (FR-011)
updateAssistantStreamingText(attemptId, text): Promise<void>;      // allowed only while status = 'generating' (FR-009)
finalizeAttempt(attemptId, status: 'completed'|'failed'|'interrupted', error?): Promise<void>; // terminal → immutable (FR-010)
setActiveAttempt(replyToUserMessageId, attemptId): Promise<void>;  // one transaction 1→0 / 0→1; selection metadata only (FR-012)
getCanonicalProjection(conversationId): Promise<ProjectedMessage[]>; // user messages + active completed attempts only (FR-013)
listAllAttempts(conversationId): Promise<AttemptRow[]>;             // diagnostics; includes failed/interrupted/superseded (FR-014)
```

Invariants:
- User text and terminal assistant text/status are immutable (guarded by transaction + CHECK).
- At most one active assistant attempt per user message (partial unique index).
- Normal model context uses `getCanonicalProjection` only; non-active/terminal-failed attempts are diagnostics-only.

## Derived-data repositories

- `ImageRepository` — `image_asset` + `message_image`: create/link assets, `unlinkForMessage`, reference-existence-based physical file deletion (delete only when no `message_image` references remain), missing-file state. (FR-022/025)
- `EvidenceRepository` — `saveEvidence(HiddenVisualEvidence → row)`, `getEvidenceForMessage`, `getActiveImageEvidence(conversationId)`, `resolveReferencedImageEvidence`; compatible ready evidence is reused, not regenerated. (FR-023/024)
- `ChunkRepository` — `upsertChunksForMessage` (back-references conversation/source_message/image_asset; max 800 chars / 120 overlap; `chunk_version`), unique `(source_message_id, chunk_version, ordinal)`.
- `EmbeddingRepository` — `getCompatibleByScope(conversationIds[], embeddingVersion, artifactHash)` returns only in-scope `ready` vectors (scope before scoring); `upsert`, `markStaleByRevision`, `pendingBatch(limit)`. Every row records model id, artifact hash, embedding version, dimensions, source revision, state. (FR-018/019)
- `SummaryRepository` / `FactRepository` (+ `durable_fact_source`) — see summaries contract.

## Invariants

- Every write is transactional; interrupted writes roll back.
- No repository (or any module it imports) opens a network socket — enforced by the offline architecture guard (Constitution I; research R13).
- Schema is versioned via `PRAGMA user_version`; dev-only reset on incompatible versions; **no MMKV→SQL migration or rollback in this feature** (FR-006).
