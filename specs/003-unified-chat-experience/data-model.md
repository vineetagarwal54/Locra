# Phase 1 Data Model: Unified Chat Experience

This generalizes the existing `QASession`/`IHistoryStore` model (`src/types/models.ts`, `src/types/interfaces.ts`, `src/history/HistoryStore.ts`) in place — same MMKV key convention, same CRUD contract shape — rather than introducing a parallel data store (research.md R1/R6).

**Canonical model note**: this is the single source of truth for the conversation data shape. An earlier draft of this document modeled a conversation as `turns: ConversationTurn[]` — an array of `{question, imagePath, answer, status, errorMessage}` pairs. That shape is superseded in full by the `Conversation.messages: ConversationMessage[]` model below, which every contract in `contracts/*.md` has been updated to match. Nothing in this feature's planning artifacts should reference `ConversationTurn`, `turns[]`, `turns[0]`, or a `{question, imagePath, answer}` pair going forward.

## Terminology: turn vs. message

- **Turn** — a *behavioral/specification-level* concept (used throughout spec.md's Functional Requirements and Edge Cases, e.g. FR-002, FR-033): a user interaction and the assistant response it produces. A turn is not itself a persisted entity.
- **ConversationMessage** — the *persisted, domain-level* entity introduced below. A single behavioral turn is realized as exactly two `ConversationMessage` records appended together: one `role: 'user'` message followed by one `role: 'assistant'` message. "Retrying a turn" (FR-029) means regenerating that same trailing `role: 'assistant'` record in place — never appending a new message pair.
- Every `ConversationMessage` belongs to exactly one `Conversation`, and `Conversation.messages` is deterministically ordered (append order is conversation order; there is no reordering, no gaps).
- Anywhere this document or a contract needs to name "which turn," it names the two message identities involved (the user message's `id` and the assistant message's `id`) rather than a positional index — see `ConversationRuntimeState` and `contracts/conversation-store.md` below.

## Conversation

Generalizes today's `QASession`. Persisted via the existing `history:ids` / `history:session:<id>`-style MMKV keys (key-name migration, if any, is a Phase 2 task decision — the keyspace owner remains `HistoryStore.ts` exclusively, per its existing structural test boundary).

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | Unchanged generation scheme (`generateSessionId()`), sole continuity/ownership key — replaces the current `imagePath`-equality heuristic entirely (research.md R1). |
| `createdAt` | `number` | Unchanged. |
| `updatedAt` | `number` | Timestamp of the most recent message's creation/completion (or failure/interruption); drives drawer/History recency grouping and sort — `createdAt`-only sort is insufficient once a conversation can receive follow-ups long after creation. |
| `messages` | `ConversationMessage[]` | **Canonical.** Ordered list of user and assistant messages (see `ConversationMessage` below and the Message Creation Invariant). Replaces the earlier `turns: {question, answer}[]` shape entirely — every message is self-describing and independently addressable by `id`. |
| `status` | `'idle' \| 'streaming' \| 'completed' \| 'cancelled' \| 'errored'` | Conversation-level rollup of its latest assistant message's state, unchanged enum shape (`QASessionStatus`), used the same way `HistoryScreen`/drawer rows already read session status today. Distinct from `ConversationMessage.status`'s four-value vocabulary (see below) — this is a coarser, conversation-wide summary. |
| `errorMessage` | `string \| null` | Unchanged — set when the *latest assistant message's* status is `'failed'`. |
| `metrics` | `PerformanceMetrics \| null` | Unchanged — latest-message metrics, same semantics as today. |
| `flagged` / `flagNote` | `boolean` / `string \| null` | Unchanged. |
| `pinnedExtraction` | *(removed from the top-level shape)* | Was already always persisted as `null` today (deliberately). Never persisted at all — see `ConversationMessage`'s "not part of the persisted message" note below, which formalizes what was already true in practice. |

**Derived, not persisted** (research.md R8): `title`, `preview` — computed on read by `deriveConversationTitle(conversation)` / `deriveConversationPreview(conversation)`, both pure functions over only the fields above (structurally cannot see internal-only state, since none is ever persisted onto `Conversation`).

**Message Creation Invariant**: `Conversation.messages` strictly alternates `role: 'user'` then `role: 'assistant'`, starting with a user message. Both messages of a turn are appended **atomically at submit time** — the user message with its final content, and its paired assistant message immediately in `status: 'generating'` with empty `text` — so a concrete, stable `assistantMessageId` exists the instant submission begins, before the first token arrives. This is what makes message-identity-based ownership/streaming/retry attribution (see `ConversationRuntimeState` below) well-defined without needing a positional index. Retry (FR-029) does **not** append a new pair; it resets that same trailing assistant message back to `status: 'generating'` in place, clearing `text`/`errorMessage`.

**Validation rules** (from FR-001–FR-034):
- A `Conversation` is only ever written to `HistoryStore` after its first user message has actually been submitted (FR-008) — never on draft/compose state alone.
- `messages` is append-only in normal operation; the one exception is retry, which resets the *same trailing assistant message* in place rather than appending a new one (per the Message Creation Invariant).
- Each `ConversationMessage.attachments` is independent — no conversation-level "the image" field exists anywhere (FR-010: a later image-bearing message must not alter an earlier one).
- `messages` MUST support any ordering of text-only and image-bearing user messages with no positional restriction (FR-033) — validated against, at minimum, the four orderings the spec enumerates: text→text, image→text, text→image→text, and imageA→text→imageB→text.

## ConversationMessage

The persisted, domain-level message entity (see Terminology above). Generalizes what was previously modeled as a `{question, answer}` pair into two independently-addressable, role-tagged records.

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | **Stable identity**, generated at message-append time (same generation scheme as `generateSessionId()`). This is the identity `contracts/conversation-store.md`, `contracts/inference-ownership.md`, and `contracts/turn-lifecycle-machine.md` key ownership, streaming attribution, and retry on — never a positional array index. |
| `role` | `'user' \| 'assistant'` | **New**, explicit. |
| `text` | `string` | User-visible text for this message; may be empty only if this is a user message with a non-empty `attachments` (image-only message per FR-004), or an assistant message whose `status` is still `'generating'`. |
| `attachments` | `Attachment[]` | **New.** Present only on user messages that attached an image (any message, not just the first — FR-003/FR-033). Feature 003 enforces **at most one** `kind: 'image'` entry per user message at the UI/store validation layer (FR-004) — the array shape itself does not hardcode that ceiling, so a later feature can widen it (multiple images, a future `'audio'` kind) without redefining `ConversationMessage`. Assistant messages never carry attachments in this feature. |
| `status` | `'generating' \| 'completed' \| 'failed' \| 'interrupted'` | The four states FR-030 requires. Meaningful only for assistant messages — user messages are always effectively `'completed'` once appended (their `status` value is not read by any consumer). `'generating'` = currently streaming (transient — see `ConversationRuntimeState` below); `'completed'`/`'failed'`/`'interrupted'` are the three states a message can be persisted in at rest. |
| `errorMessage` | `string \| null` | Set when `status === 'failed'`; cleared on successful retry. |
| `createdAt` | `number` | Timestamp this message was appended (for the assistant message of a turn, this is submit time, not completion time — completion is reflected by `status` changing, not by a second timestamp). |

### Attachment

| Field | Type | Notes |
|---|---|---|
| `kind` | `'image'` | Only kind implemented in Feature 003. Deliberately a union of one, not a hardcoded literal type, so a future kind (e.g. `'audio'`) can be added without reshaping `ConversationMessage`. |
| `path` | `string` | Local file path (existing `expo-file-system` convention, unchanged from today's `imagePath` handling). |

**Forward-compatibility note** (spec Key Entities, "Message"): this shape is deliberately still "one message, an `attachments` array capped at one entry by validation" rather than a fully generic multi-part content model, because Feature 003's functional limit is exactly one image per user message (FR-004) — there is no present requirement to build for more. Keep this practical: do not build a generic content-part/attachment framework beyond the `Attachment` shape above; only `image` is implemented. The array (rather than a single nullable field) is what keeps this shape from needing to be re-architected later to add a second attachment kind or multiple images — nothing here builds that now.

**Not part of the persisted message** (kept transient, in `conversationStore`'s in-memory runtime map only, per the existing `InferenceTrace`/hidden-evidence separation precedent — research.md R1, R2):
- `hiddenEvidence` (structured extraction result) — used to build the answer-stage prompt for this message while it's being generated, then discarded; never written to `HistoryStore`.
- `InferenceTrace` — dev-only diagnostic, unchanged from today, never touches `HistoryStore`.

## Draft

New, purely in-memory (not persisted to MMKV — spec: "not required to survive a full app/process restart").

| Field | Type | Notes |
|---|---|---|
| `conversationId` | `string \| null` | `null` for an as-yet-uncreated New Chat draft (before the conversation's first message is actually sent). |
| `text` | `string` | Unsent typed text. |
| `imagePath` | `string \| null` | Unsent attached image (at most one, per FR-004). |

A `Draft` has no message identity of its own — it exists *before* any `ConversationMessage` is created. Once sent, its `text`/`imagePath` become the initial content of a new user/assistant message pair (per the Message Creation Invariant), and the draft is cleared.

**Lifecycle** (FR-031/FR-032): keyed the same way conversation runtime ownership is keyed (research.md R1) — a `Map<conversationId | 'new', Draft>` held by `conversationStore`, so switching away from and back to a conversation (including the not-yet-created New Chat slot) restores the exact draft. A draft is discarded only when its message is actually sent (at which point it becomes a `ConversationMessage` pair) or when the user explicitly clears/removes it; it is never discarded merely by navigating.

## ConversationRuntimeState (in-memory ownership/attribution — research.md R1)

Not persisted. Replaces `inferenceStore.ts`'s single `activeSessionId`/`lastSavedSession`/`activeTurn` module-scope pointers with a per-conversation map entry, so a background generation stays attributed to the conversation — and the specific message pair — that started it, regardless of what the user is currently viewing.

| Field | Type | Notes |
|---|---|---|
| `conversationId` | `string` | Map key. |
| `originatingUserMessageId` | `string \| null` | The `id` of the user message currently being answered or regenerated, or `null` if idle. Stable across a retry (a retry re-targets the same user message, never a new one). |
| `assistantMessageId` | `string \| null` | The `id` of the specific assistant message record currently being generated/streamed into, or `null` if idle. This is the identity streaming attribution, cancellation, and retry all key on — **never** a positional index into `messages[]`. |
| `streamingText` | `string` | Live streamed text for the pending assistant message (mirrors `InferenceQueue`'s current streamed response), read by whichever screen currently has this conversation open; not read by any other conversation's screen. |
| `isOwnerOfActiveInference` | `boolean` | `true` only for the single conversation (if any) that currently holds the app-wide `InferenceQueue`/`InferenceActivityLock` slot — used to decide whether *this* conversation's composer is locked (generating) versus *another* conversation's composer, which is locked for a different reason (someone else is generating) per FR-016. |

**Navigation invariant** (explicit, per task brief): streaming output is written into `ConversationRuntimeState` keyed by `conversationId` + `assistantMessageId` — never derived from "whichever conversation is currently on screen." Switching screens changes what the user *sees*; it never changes which conversation/message a running generation's tokens are attributed to.

**State transitions** (per assistant message, FR-030): `(message created)` → `generating` → (`completed` | `failed`); `failed` → *(user retries)* → `generating` → (`completed` | `failed`); `generating` → *(user explicitly cancels, only reachable from within the owning conversation)* → `interrupted`. There is no transition directly from `completed` back to `generating` except via retry after an intervening `failed`.

**Relationship to the turn-lifecycle machine (research.md R10)**: `ConversationRuntimeState.streamingText` and the coarse `assistantMessageId`/idle-vs-active signal are a **Zustand-facing projection** of the finer-grained `TurnLifecycleSnapshot` below — `conversationStore` subscribes to the one `InferenceQueue`-owned machine actor and writes a simplified view into whichever conversation's map entry currently owns the active inference (per R1). Screens never read the machine directly; they only ever read `ConversationRuntimeState`/`ConversationMessage.status` (both Zustand-backed), consistent with the "Zustand remains the only UI-facing reactive layer" rule in R10.

## TurnLifecycleSnapshot (process model — research.md R10, not persisted, not conversation-scoped)

This is **not a data entity** in the usual sense: it is the shape of the single, app-wide `turnLifecycleMachine` actor's snapshot, included here only to make explicit what it does and does not hold. There is exactly one of these live at a time (or none, when idle) — never one per conversation, matching app-wide single-flight.

| Field | Type | Notes |
|---|---|---|
| `state` | `'idle' \| 'preparing' \| 'perception' \| 'contextAssembly' \| 'generating' \| 'streaming' \| 'completed' \| 'failed' \| 'interrupted'` | The machine's current state name (research.md R10's state table). `IInferenceQueue.subscribe()` continues to expose this collapsed into the existing `InferenceState.status` shape at the `InferenceQueue` boundary — the finer states (`perception`, `contextAssembly`) are additive granularity for future UI use (`motion.md` §11.3's real phases), not a breaking change to `InferenceQueue`'s existing consumers. |
| `context.request` | `{ requestId: string; conversationId: string; originatingUserMessageId: string; assistantMessageId: string; question: string; imagePath: string \| null }` | The single request currently being processed. `requestId` is minted fresh per `submit()`/`RETRY` call (useful for correlating `InferenceTrace` entries across multiple attempts at the same assistant message; never persisted). `conversationId`, `originatingUserMessageId`, and `assistantMessageId` are the three stable identities every active inference remains associated with — retained unchanged across a `RETRY` so the same assistant message is regenerated, never a new one (FR-029). This replaces the earlier `turnIndex`-based request shape entirely — no field in this contract is a positional index into `messages[]`. |
| `context.streamedResponse` | `string` | Accumulates during `streaming`; mirrors what `ConversationRuntimeState.streamingText` is projected from. |
| `context.hiddenEvidence` / `context.pinnedExtraction` | transient, unchanged shapes from `OutputPipelineTypes.ts` | Exist only while the current message is being processed; discarded on the next `SUBMIT`; **never persisted** — `HistoryStore` continues to always write `null` for these fields on the saved `Conversation`, exactly as today. |
| `context.errorMessage` | `string \| null` | Set on `failed`, surfaced to `ConversationMessage.errorMessage` on persistence. |

**Explicitly not present**: any conversation's `messages[]` array, any `Conversation` record, any MMKV read/write, any `Draft`, any list of conversations. The machine has no knowledge that more than one conversation exists — that is `conversationStore`'s job (R1), entirely outside the machine. This is what "XState is not conversation storage, context memory, or persistence" means structurally: the machine's `context` type simply has no field capable of holding any of those things.

## Conversation List / Search index

No new persisted structure — reuses `IHistoryStore.list(limit?, offset?)` (existing signature, unchanged) sorted by `updatedAt` descending (was `createdAt`) for both the drawer's recent subset and Full History's complete, grouped-by-recency listing (see "History grouping and pagination" below). Search (FR-024) is `searchConversations(conversations, query)`, a pure in-memory filter over the already-loaded/paginated list — no separate index is built or persisted (research.md R8).

## History grouping and pagination (research.md R6/R8, contracts/history-search.md)

Full History (design.md §7.14) groups conversations into four buckets — `Today`, `Yesterday`, `Previous 7 Days`, `Older` — computed at read time from each `Conversation.updatedAt` against the device's current date, using existing device locale/time behavior. **`Older` is not optional**: every conversation outside the first three windows MUST still be listed and resumable (spec FR-019, design.md §7.14 — "All stored conversations must remain reachable from History. Conversations older than seven days must not disappear."). Grouping is a pure display-time computation over whatever `IHistoryStore.list()` returns; it does not change persistence or the pagination contract below.

`IHistoryStore.list(limit?, offset?)` is the one and only paginated access path this feature relies on — it already exists in `IHistoryStore`/`HistoryStore.ts` today (`src/types/interfaces.ts`, `src/history/HistoryStore.ts`) and is fully implemented: it loads every stored id, maps to a `Conversation`, sorts by `updatedAt` descending (once this feature's sort-key change lands), and slices `[offset, offset + limit)` (or `[offset, end)` when `limit` is omitted). No new pagination API is introduced or assumed by this feature — `ConversationDrawer` calls `list(smallLimit)` for its recent subset, and `HistoryScreen` calls `list()` (or `list(pageSize, offset)` if it chooses to page rather than load the full set at once) to populate all four recency buckets, including `Older`. This is stated explicitly here so no downstream planning artifact or task may assume pagination behavior beyond this documented signature.

## Relationships

```text
Conversation 1 ── * ConversationMessage   (messages[], ordered, strictly alternating
                                             user → assistant, append-only except
                                             retry-in-place on the trailing assistant message)
Conversation 1 ── 0..1 Draft              (keyed by conversationId in conversationStore, transient)
Conversation 1 ── 0..1 ConversationRuntimeState  (keyed by conversationId, transient, at most one
                                                    across ALL conversations may have
                                                    isOwnerOfActiveInference === true at a time —
                                                    this is the single-flight invariant, enforced by
                                                    InferenceActivityLock/InferenceQueue, not by this map)
ConversationMessage 0..1 ── Attachment[]    (independent per message, not conversation-level;
                                               capped at one image-kind entry per user message
                                               by validation, not by the type shape)

TurnLifecycleSnapshot 0..1 ── ConversationRuntimeState  (at most one machine snapshot exists at a
                                                            time app-wide; conversationStore projects
                                                            it, keyed by conversationId +
                                                            assistantMessageId, into whichever single
                                                            conversation's map entry currently owns
                                                            it — research.md R10)
```
