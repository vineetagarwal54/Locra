# Contract: Title, Preview & Local Search Derivation

Documents the pure-function contract for FR-023/FR-024 (research.md R8, data-model.md "Derived, not persisted").

```ts
function deriveConversationTitle(conversation: Conversation): string;
function deriveConversationPreview(conversation: Conversation): string;
function searchConversations(conversations: Conversation[], query: string): Conversation[];
```

**Canonical shape note**: all three functions operate on `Conversation.messages: ConversationMessage[]` (data-model.md) — an ordered, role-tagged list — not the earlier `turns[]`/`ConversationTurn` pair shape. Per data-model.md's Message Creation Invariant, `messages[0]` is always the conversation's first **user** message (conversations always start with a user message).

## Invariants (test-verifiable, structural — not just behavioral)

1. **Visible-field enforcement**: all three functions derive their output exclusively from `Conversation.messages[].text` and attachment presence as specified below. The optional internal `contextMemory` sidecar is deliberately ignored; titles, previews, and History search never expose or match summary entries, extracted media text, uncertainty, hidden evidence, or inference traces.
2. `deriveConversationTitle`:
   - Returns `messages[0].text` (trimmed) if it is non-empty.
   - Returns a fixed fallback string (e.g., `"Image conversation"`) if `messages[0].text` is empty and `messages[0].attachments` is non-empty (image-only first message).
   - Never returns an empty string.
3. `deriveConversationPreview`:
   - Returns the most recent message's user-visible text: if the last entry in `messages` is an assistant message with `status === 'completed'`, its `text`; otherwise, the `text` of the most recent **user** message in `messages` (covers an in-progress/failed/interrupted assistant message, where the assistant's own `text` is not yet meaningful preview content).
   - Never returns text from a message's `errorMessage` alone (an error is not "user-visible conversation content" in the preview sense — the failure indicator is a separate UI affordance, not folded into the preview string).
4. `searchConversations`:
   - Case-insensitive substring match against `deriveConversationTitle(conversation)` and every message's `text`.
   - Empty `query` returns the input list unchanged (no filtering).
   - Never matches on `errorMessage`, `metrics`, `attachments.path`, or any field outside the enumerated user-visible set.

## Non-goals (explicit, per spec Assumptions)

- No fuzzy matching, ranking, or external indexing service — a linear substring scan over the already-loaded/paginated conversation list is sufficient at the ~200-conversation validation scale (research.md R6/R8).
- No persisted search index — `searchConversations` runs against whatever `IHistoryStore.list()` currently returns (data-model.md "History grouping and pagination" — the same `list(limit?, offset?)` signature `HistoryScreen` uses to populate all four recency groups, including `Older`).
