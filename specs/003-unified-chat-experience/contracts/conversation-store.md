# Contract: Conversation Store

This is a mobile app with no external API surface; "contracts" here document the internal TypeScript interface boundaries this feature introduces or changes, in the same style as the existing `src/types/interfaces.ts`. These are the contracts implementation tasks (Phase 2) and their tests must satisfy.

**Canonical shape note**: this contract operates on `Conversation`/`ConversationMessage` as defined in `data-model.md` (`messages: ConversationMessage[]`, each with a stable `id`). There is no `turns[]`/`ConversationTurn` shape anywhere in this feature — see data-model.md's "Canonical model note."

## `IConversationStore` (new)

Owns conversation-keyed runtime state (research.md R1, data-model.md `ConversationRuntimeState` / `Draft`). Wraps the existing `IInferenceQueue`/`IHistoryStore` — does not replace them.

```ts
interface IConversationStore {
  // Runtime ownership/attribution
  getConversationRuntimeState(conversationId: string): ConversationRuntimeState | null;
  subscribeToConversation(conversationId: string, listener: (state: ConversationRuntimeState | null) => void): () => void;

  // Submission — every call is explicitly scoped to a conversation. Internally, submit()
  // appends a user message and its paired 'generating' assistant message atomically
  // (data-model.md's Message Creation Invariant) and returns their stable identities.
  submit(conversationId: string | 'new', request: { question: string; imagePath: string | null }): Promise<{ conversationId: string; originatingUserMessageId: string; assistantMessageId: string }>;

  // Retry targets a specific assistant message by stable identity — never a positional index.
  retryFailedMessage(conversationId: string, assistantMessageId: string): Promise<void>;

  cancelActiveGeneration(conversationId: string): void; // no-op if this conversationId does not own the active inference

  // Cross-conversation query — used by any screen's composer to decide whether to lock
  isAnyGenerationInFlight(): boolean;
  getActiveGenerationOwner(): string | null; // conversationId, or null if idle

  // Drafts (FR-031/FR-032)
  getDraft(conversationId: string | 'new'): Draft;
  setDraftText(conversationId: string | 'new', text: string): void;
  setDraftImage(conversationId: string | 'new', imagePath: string | null): void;
  clearDraft(conversationId: string | 'new'): void; // called only after a successful send, or explicit user discard

  // New-conversation lifecycle
  startNewConversation(): void; // resets the 'new' draft slot; does NOT touch any other conversation's runtime state or draft
}
```

**Why `submit()` returns identities, not `void`**: the task brief requires every active inference to remain explicitly associated with a request identity, a conversation identity, an originating user message identity, and an assistant response message identity. Returning the two message identities from `submit()` lets a caller (if it ever needs to) correlate a specific submission with its resulting messages without re-deriving them; in practice, screens still read state via `subscribeToConversation`, not via this return value.

**Invariants this contract enforces** (test-verifiable):

1. At most one `ConversationRuntimeState` across all conversations may report `isOwnerOfActiveInference === true` at any instant (`isAnyGenerationInFlight()` / `getActiveGenerationOwner()` are consistent with this — single-flight, FR-012).
2. `submit()` for a `conversationId` that is not the current owner of an in-flight generation, while one is in flight elsewhere, MUST reject/no-op without starting a second generation (FR-012, FR-016) — it MUST NOT silently queue, and it MUST NOT append a message pair to that conversation.
3. Calling `submit()`/`retryFailedMessage()`/`cancelActiveGeneration()` for one `conversationId` MUST NOT mutate `getConversationRuntimeState()` or `getDraft()` for any other `conversationId` — including that other conversation's `streamingText` and the `ModelRequestMessage[]` context assembled for its in-flight/last request (FR-021's widened no-leakage list: visible messages, image context, hidden traces, internal prompts, streaming output, drafts, model request context — all of it is reachable only through the owning conversation's own map entry).
4. `startNewConversation()` MUST NOT affect any existing conversation's runtime state or draft (FR-001).
5. `getDraft(conversationId)` after switching away and back within the same session MUST return the exact same `Draft` value that was set before switching (FR-031), for every `conversationId` including `'new'`.
6. `clearDraft()` is the only way a draft is removed short of the app process ending; navigation alone MUST NOT clear a draft.
7. `retryFailedMessage(conversationId, assistantMessageId)` MUST target the exact assistant message identified by `assistantMessageId`, resetting it in place to `'generating'` and reusing its paired `originatingUserMessageId` unchanged — it MUST NOT append a new user or assistant message, and calling it with a stale/already-retried `assistantMessageId` after the message has changed identity is not possible, because retry never changes the assistant message's `id` (FR-029, retry identity).
8. **Navigation independence**: nothing in this store's state is keyed by, or derived from, "which conversation is currently focused on screen." Every read (`getConversationRuntimeState`, `getDraft`) and every write (`submit`, `retryFailedMessage`, `cancelActiveGeneration`, draft setters) is keyed explicitly by the `conversationId` parameter passed in — never an ambient "current" pointer. This is what makes background generation and cross-conversation isolation structurally guaranteed rather than convention-dependent.

## `IInferenceQueue` (extended)

Existing interface (`src/types/interfaces.ts`), extended only in `InferenceRequest`'s shape — no method signatures removed.

```ts
interface InferenceRequest {
  requestId: string;              // NEW — minted fresh per submit()/retry() call; correlates InferenceTrace
                                    //   entries across multiple attempts at the same assistant message;
                                    //   never persisted to HistoryStore.
  conversationId: string;         // NEW — required; replaces the imagePath-equality follow-up heuristic
  originatingUserMessageId: string; // NEW — stable id of the user message this request answers
  assistantMessageId: string;     // NEW — stable id of the assistant message this request is generating
                                    //   into (created in 'generating' status at submit time, per
                                    //   data-model.md's Message Creation Invariant); unchanged across a retry
  question: string;
  imagePath: string | null;       // CHANGED — was `string` (required); now optional per-message (FR-003/FR-004)
}
```

There is deliberately no `turnIndex` field anywhere in this contract. A positional index is ambiguous the moment retry, concurrent conversations, or any future reordering is in play; the three stable identities above (`conversationId`, `originatingUserMessageId`, `assistantMessageId`) are unambiguous by construction and are what every ownership/ownership-adjacent invariant in `contracts/inference-ownership.md` and `contracts/turn-lifecycle-machine.md` keys on.

**Invariants**:

1. `InferenceQueue` itself remains conversation-agnostic and stateless across calls (unchanged from today — "Locra owns conversation state; ExecuTorch is used only as a stateless inference runtime"); `conversationId`/`originatingUserMessageId`/`assistantMessageId` are opaque attribution data the queue passes through to its `onToken`/completion callbacks unchanged, not data it interprets.
2. `submit()` continues to reject immediately (no queueing) if `isInFlight()` is already true, regardless of `conversationId` (FR-012) — this behavior is unchanged from today, just now the caller (`conversationStore`) is what's conversation-aware, not the queue.
3. Image preprocessing/perception (research.md R2) runs whenever `imagePath !== null` on the submitted request, independent of any position in the conversation — never gated on an index.

## `IHistoryStore` (extended)

Existing interface, same method signatures (`save`, `get`, `list`, `delete`, `clear`, `setFlag`, `getMetricsSummary`) — only the `Conversation` shape it operates on changes (data-model.md's `messages: ConversationMessage[]`).

**`list(limit?, offset?)` — explicitly defined here, not assumed elsewhere**: this signature already exists in `IHistoryStore`/`HistoryStore.ts` today and is fully implemented — it loads every stored conversation, sorts by `updatedAt` descending (once this feature's sort-key change lands, was `createdAt`), and returns the slice `[offset ?? 0, (offset ?? 0) + limit)` when `limit` is provided, or every remaining item from `offset` onward when it is not. This is the *only* paginated/bounded access path `ConversationDrawer` (small `limit`, no `offset`) and `HistoryScreen` (full set, optionally paged) may rely on — no other pagination API is introduced or assumed anywhere in this feature's planning artifacts (data-model.md "History grouping and pagination").

**Invariants** (existing, re-asserted, must still hold):
- Structural: never imports AsyncStorage/SQLite; never imports from `../screens|inference|model` (existing `tests/contract/history-store.test.ts` boundary, must keep passing).
- `save()` is idempotent-by-id: saving with an existing `id` updates that conversation in place; it never creates a duplicate entry.
- `list()`'s recency sort (`updatedAt` descending) and slicing must together be sufficient to populate all four History groups (`Today`/`Yesterday`/`Previous 7 Days`/`Older`, data-model.md) — no conversation may become unreachable through `list()` at any `limit`/`offset` combination that eventually covers the full stored set.
