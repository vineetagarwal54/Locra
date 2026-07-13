# Contract: Compaction — Summaries & Durable Facts

**Module**: `src/inference/CompactionService.ts` (+ `CompactionPrompt.ts`, `CompactionParser.ts`) | Consumers: `store/conversationStore.ts` (after a turn finalizes), `ContextOrchestrator`

Summaries and durable facts are produced **together** by one isolated internal Qwen compaction request. They are internal context inputs only — never shown as product UI, never manually created/edited (Constitution XI).

## CompactionService

```ts
maybeRun(conversationId: string): Promise<void>;
// Deterministic, test-pinned triggers ONLY (FR-026): ≥24 eligible older messages outside the max recent-turn
// window, OR ≥6,000 estimated older-content CHARACTER units (CharacterContextBudgetPolicy). Never random/manual.
// Acquires DeviceResourcePolicy (qwen-compaction); resets native Qwen context; runs ONE isolated request;
// validates every referenced message ID before persistence; never enters visible history (FR-029).
// Never concurrent with visible generation, embedding, recording, or transcription (FR-032, SC-009).

markStaleForChange(conversationId, change): Promise<void>;
```

Range & validity (FR-027/028):
- A summary covers one **contiguous, immutable older-message range** ending before the max recent-turn window; it stores `first/last_source_message_id`, `source_view_hash`, `summarizer_version`, `status`, `version`.
- Appending new turns **outside** the covered range does **not** stale it.
- It stales only when: a covered source is removed, an active-attempt selection **inside the range** changes, the `source_view_hash` changes, or the summarizer version changes.
- Only the newest compatible `ready` range summary participates in context.
- Answering never blocks on pending compaction — it proceeds with exact turns, retrieval, and the last still-valid summary (FR-032, SC-009 AS9).

## Durable facts (FactRepository + durable_fact_source)

- Every fact carries a `normalized_key`, `value_text`, `fact_type`, `extraction_version`, `status`, and ≥1 `durable_fact_source` link (multi-source allowed).
- Duplicate same-key values merge source links; a newer contradictory value creates a new fact with `supersedes_fact_id` set — the older fact is **retained** (superseded, excluded from active context), never deleted (FR-030/031).
- Extracted only during deterministic compaction, never per-turn.

## CompactionParser

```ts
parse(raw): { summary: SummaryDraft; facts: FactDraft[] };
// structured output → one summary + source-linked facts; every referenced message ID validated before persistence.
```

## Determinism

- Trigger thresholds are documented constants (24 / 6,000 char-units) pinned by the compaction lifecycle suite; identical state + thresholds ⇒ identical trigger + covered range (SC-009).
