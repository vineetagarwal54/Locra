# Contract: Context Orchestration

`ContextOrchestrator` is an additive, pure inference-preparation layer. It does not own conversations, persistence, workflow state, model execution, or UI state.

```text
ConversationStore
  → canonical-conversation-snapshot-v1
  → ContextOrchestrator
  → canonical-conversation-v2
  → ContextBuilder
  → InferenceQueue / XState lifecycle
  → stateless ExecuTorch generate(messages)
```

## Inputs and outputs

- Input: a deep-cloned snapshot containing one `conversationId`, prior raw `ConversationMessage` records, the current user message, and that conversation's optional derived memory.
- Output: an isolated selected context plus regenerated `conversation-context-memory-v1`.
- Raw `Conversation.messages` is never modified, summarized in place, deleted, or replaced.
- The orchestrator performs no MMKV access, network access, model call, embedding lookup, or UI update.

## Selection policy

The default `character-budget-v1` policy measures dynamic context in characters under the existing 14,400-unit ceiling. Budget ownership is behind `ContextBudgetPolicy`; a future token/model-aware implementation can replace `measure()` and caps without changing the orchestrator consumer contract.

Selection order is fixed:

1. Current request is always retained.
2. Newest completed turns are retained verbatim, in chronological role order, up to the recent-turn cap and remaining budget.
3. Prior media evidence is ranked by lexical overlap with the current request, then recency, then stable id.
4. Older fact/decision candidates use the same deterministic ranking.
5. Older extractive summary entries use the same deterministic ranking.

No ordinal, acknowledgement, pronoun, or other phrase-specific routing exists. Relevance is normalized token overlap; recency and stable identity are deterministic tie-breakers.

## Summary lifecycle

- Only completed turns not selected as recent exact turns are represented in `rolling-summary-v1`.
- Entries are compact extractive user/assistant snippets keyed by both source message ids.
- The covered boundary advances as turns age out of the exact window.
- The summary is regenerated from raw messages on orchestration. Persisting it is a cache optimization, not a source-of-truth transition.
- Unknown or malformed memory versions are ignored by `HistoryStore` and regenerated on the next submit.

## Media evidence lifecycle

- A successful image perception stage remains transient inside XState while its visible answer is generated.
- On successful turn completion, `ConversationStore` normalizes reusable fields into `context-media-evidence-v1`, keyed by the originating user-message id.
- Current modalities are `image`, `screenshot`, and `document`; only image production is implemented. Future screenshot/document extraction can call the generic media-evidence merge contract without changing conversation ownership or prompt assembly.
- Evidence is admitted only when its source message exists in the same canonical snapshot. It is never searched, previewed, or displayed as chat content.

## Retry and isolation invariants

- `InferenceQueue` deep-clones every selected context before asynchronous work.
- Refusal recovery changes only the system instruction; selected recent turns and derived context remain present on the one bounded retry.
- Retry of a failed assistant message rebuilds from the same conversation and originating user-message identity.
- XState receives no conversation history or persisted memory and remains single-flight workflow orchestration only.
- ExecuTorch continues to receive a complete stateless `ModelRequestMessage[]` on every generation.
