# Contract: Optional Scoped Cross-Chat Retrieval (Phase 7 — built only after Phases 1–6 are stable)

**Module**: extended `src/persistence/sqlite/Migrations.ts`, `src/persistence/ConversationRepository.ts`, `src/store/settingsStore.ts`, `src/retrieval/HybridRetriever.ts` | New UI: `src/components/settings/CrossChatSettingRow.tsx`

This entire contract is out of scope for Phases 1–6 delivery (routing, image continuity, token budgeting, generation improvements, and same-chat semantic retrieval); nothing in Phases 1–6 may import or depend on the shapes below.

## Schema migration

```sql
-- Migrations.ts entry, SCHEMA_VERSION 3 -> 4
ALTER TABLE conversation ADD COLUMN excluded_from_cross_chat INTEGER NOT NULL DEFAULT 0;
```

- **MUST** use the existing ordered, transactional `Migrations.ts` runner (`PRAGMA user_version` stamped last inside the migration transaction) — not a destructive reset (research.md §4).
- Existing rows **MUST** migrate to `excluded_from_cross_chat = 0` (not excluded), preserving current same-chat-only behavior until a user opts a conversation out.

## ConversationRepository (extended)

```ts
setCrossChatExcluded(conversationId: string, excluded: boolean): Promise<void>;
// getConversation(...) / listConversations(...) responses gain `excludedFromCrossChat: boolean`
```

## settingsStore (extended)

```ts
interface SettingsState {
  // existing fields unchanged
  crossChatMemoryEnabled: boolean; // MMKV-backed, default false (spec FR-020)
}
setCrossChatMemoryEnabled(enabled: boolean): void;
```

## HybridRetriever scope resolution (extended)

- When `crossChatMemoryEnabled` is true, the effective `conversationIds` passed into `HybridRetriever.search` **MUST** expand from `[currentConversationId]` to `[currentConversationId, ...otherLocalConversationIds.filter(id => !excludedFromCrossChat(id))]`, provided the current conversation itself is not excluded (spec FR-021/FR-022).
- When `crossChatMemoryEnabled` is false, or the current conversation is excluded, scope **MUST** remain exactly `[currentConversationId]` — identical to pre-Phase-7 behavior (spec FR-023).
- Scope filtering **MUST** happen before similarity/lexical scoring (spec FR-018) — unchanged principle, now applied across the expanded scope.
- Cross-chat items **MUST** use the same relevance threshold, fusion, deduplication, and untrusted-source attribution as same-chat retrieval (spec FR-022).

## Toggle effect

- Toggling `crossChatMemoryEnabled` or a conversation's `excludedFromCrossChat` flag **MUST** take effect starting with the very next request in every affected conversation, with no app restart and no loss of conversation state (spec FR-024).
- Disabling the global setting or excluding a conversation **MUST NOT** delete previously computed cross-chat-eligible embeddings/derived data — only stop querying/serving them (spec FR-023).

## UI

- One global settings-row toggle (existing settings-screen pattern/components) and one per-conversation exclusion control (e.g., a conversation-menu action), both built from existing `design/` tokens — no new picker UX (spec Non-Goal, Section 7 intro).

## Invariants

- A conversation with `excludedFromCrossChat = true` never contributes to another conversation's retrieval and never receives cross-chat content itself, in both directions, regardless of the global setting (spec FR-021, edge case).
- Zero cross-chat items ever appear in diagnostics for any turn while the global setting is off (spec FR-025) — directly testable via the existing diagnostics export.
