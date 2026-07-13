# Contract: Per-Conversation Response Modes (Low / Medium / High)

**Module**: extended `src/inference/ResponseMode.ts` + `src/store/settingsStore.ts` + `conversation.response_mode` (SQL)

Modes are **per-conversation** (not a global override model): every conversation stores exactly one mode, initialized from the global default at creation. There is no global+override resolution and no mid-conversation global switch that rewrites existing chats.

## Storage & conversion (FR-033)

```ts
type ResponseMode = 'Low' | 'Medium' | 'High';       // runtime union (existing)
type StoredResponseMode = 'low' | 'medium' | 'high';  // SQL column value

// ONE tested conversion function is the single source of the mapping:
toStoredMode(mode: ResponseMode): StoredResponseMode;
fromStoredMode(value: string): ResponseMode;          // defaults to 'Medium' on unknown
```

- SQL stores lowercase; all UI/logic uses the runtime union; no ad-hoc casing conversions elsewhere.

## Config shape (pinned, monotonic Low < Medium < High)

```ts
interface ResponseModeConfig {
  recentExactTurns: number;       // context floor, never dropped
  contextBudgetUnits: number;     // CHARACTER units (CharacterContextBudgetPolicy), NOT tokens
  sameChatRetrievalLimit: number;
  selectedChatRetrievalLimit: number;
  answerTargetTokens: number;
  generationLimit: number;
}
getResponseModeConfig(mode: ResponseMode): ResponseModeConfig;
```

| Setting | Low | Medium | High |
|---|---:|---:|---:|
| recentExactTurns | 6 | 10 | 16 |
| sameChatRetrievalLimit | 2 | 4 | 6 |
| selectedChatRetrievalLimit | 1 | 3 | 5 |
| contextBudgetUnits (chars) | 4,000 | 7,000 | 11,000 |
| answerTargetTokens | 192 | 384 | 768 |
| generationLimit | 320 | 640 | 1,024 |

Values are pinned by the `ResponseMode` test suite and change only through recorded evaluation while remaining monotonic.

## Selection & effect

```ts
useSettingsStore().defaultResponseMode; // global default (MMKV), initial Medium — used ONLY at conversation creation
ConversationRepository.setResponseMode(conversationId, toStoredMode(mode));
effectiveMode(conversation) = fromStoredMode(conversation.response_mode); // resolved before each submit/retry
```

## Invariants

- New conversation copies the global default; Medium is the initial global default (FR-034).
- Changing a conversation's mode affects only that conversation and only future requests (FR-035, SC-011).
- Changing mode MUST NOT rewrite messages, regenerate embeddings, invalidate summaries, or lose drafts/images.
- Same Qwen model across all modes; only bounded config differs (FR-036).
- **Orchestrator/retriever wiring** of this config happens in the hybrid-context phase (after the orchestrator refactor); this module owns config, conversion, persistence, and the UI selector.
