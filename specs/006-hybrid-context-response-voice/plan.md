# Implementation Plan: Hybrid Context, Per-Conversation Response Modes & Voice Input

**Branch**: `006-hybrid-context-response-voice`  
**Date**: 2026-07-13  
**Spec**: [spec.md](./spec.md)

## Summary

Replace Locra's MMKV-backed conversation history with a SQL canonical store and preserve the existing Qwen/llama.rn inference contract while adding immutable completed messages, separate retry attempts, bounded keyset pagination, vector-augmented same-chat retrieval, deterministic Qwen-generated summaries/facts, reusable image evidence, explicit one-chat targeting, per-conversation Low/Medium/High modes and offline voice transcription.

This is a development-stage cutover: existing MMKV chat history may be discarded, so the plan intentionally excludes production-grade MMKV migration, fallback and rollback work.

## Technical Context

- **Language**: TypeScript ~6.0 strict mode, React 19.2, React Native 0.85.3.
- **Platform**: Android, Expo SDK 56, New Architecture, NDK 26.3.11579264.
- **Existing runtime**: Qwen3-VL through `llama.rn` 0.12.5.
- **Existing state**: Zustand UI stores, MMKV settings, XState/inference queue lifecycle.
- **New persistence**: `expo-sqlite`, accessed only through `src/persistence/sqlite/`.
- **New derived models**: one small embedding GGUF through a verified local runtime and one verified offline Whisper runtime/model.
- **Testing**: tests-first for schema/repositories, message immutability, retries, retrieval, summary/fact lifecycle and resource policy.
- **Target scale**: 200+ conversations; hundreds of messages per conversation.
- **Page policy**: maximum 50 records per repository page; keyset cursors use timestamp + stable ID.
- **UI cache policy**: at most 3 message pages per open conversation and 2 conversation-list pages; eviction preserves visible anchors and re-fetches evicted pages on demand.
- **Performance**: first conversation page <1.5s, first message page <1s, subsequent page <500ms, active-chat retrieval <1.5s, selected-chat retrieval <2s.
- **Offline**: no network use after required model artifacts are installed.
- **Memory**: Qwen, embedding runtime and Whisper are never concurrently active/resident for protected work.

## Approved Architecture Decisions

1. **SQL is canonical immediately**; existing MMKV history is not migrated in this development phase.
2. **Messages are immutable after submission/finalization**; retries create new assistant attempts.
3. **Conversation mode is persisted directly on each conversation**, initialized from a global default.
4. **Cross-chat retrieval requires one explicitly selected/resolved conversation**; no automatic all-chat search.
5. **Images use a physical asset plus message-link model**, not one image row with a mutable reference count.
6. **Embeddings use enforceable source foreign keys**, deterministic scope-first scoring and lexical fallback.
7. **Summaries and durable facts are created together by isolated internal Qwen compaction jobs** with fixed triggers.
8. **New turns do not stale immutable-range summaries** unless the visible source range changes.
9. **One device resource policy serializes Qwen answering/compaction, embedding, recording and transcription.**
10. **Embedding and voice dependency choices remain gated until API/license/New-Arch/NDK/device spikes pass.**

## Constitution Check

| Principle | Status | Plan |
|---|---|---|
| Privacy-first | Pass | SQL, embeddings, summaries, voice and Qwen are local. |
| Single-flight inference | Pass | One `DeviceResourcePolicy` owns every protected operation. |
| Graceful degradation | Pass | Lexical fallback, missing-image handling, voice failure recovery and dev DB reset are explicit. |
| Memory safety | Pass with validation | Bounded SQL pages/cache; protected models unload between operations. |
| Minimal TypeScript | Pass | Repository interfaces extend current boundaries; no UI business logic. |
| TDD core systems | Pass | Core persistence/retrieval/lifecycle work starts with failing tests. |
| New Architecture | Verify gate | New native dependencies must pass current build verification before install. |
| Single local store (Principle VIII) | Pass | Constitution v3.0.0 declares Phase 2 and makes SQLite the canonical conversation store; MMKV is settings-only. SQL is accessed through one boundary module. No longer a deviation. |
| Verify before assuming | Mandatory | Embedding, Whisper and SQLite claims are spike-gated. |
| Hard architecture boundaries | Pass | `persistence/`, `retrieval/`, `voice/` and `inference/` remain separated. |
| Design source | Pass | Mode, chat picker and voice UI use existing design tokens/components. |

## Project Structure

```text
src/
├── persistence/
│   ├── sqlite/
│   │   ├── Database.ts
│   │   ├── Schema.ts
│   │   ├── DevSchemaReset.ts
│   │   └── Transactions.ts
│   ├── ConversationRepository.ts
│   ├── MessageRepository.ts
│   ├── ImageRepository.ts
│   ├── EvidenceRepository.ts
│   ├── ChunkRepository.ts
│   ├── EmbeddingRepository.ts
│   ├── SummaryRepository.ts
│   └── FactRepository.ts
├── retrieval/
│   ├── ChunkingService.ts
│   ├── EmbeddingService.ts
│   ├── HybridRetriever.ts
│   ├── LexicalFallbackRetriever.ts
│   └── ConversationTargetResolver.ts
├── inference/
│   ├── ContextOrchestrator.ts
│   ├── ContextBuilder.ts
│   ├── CompactionService.ts
│   ├── CompactionPrompt.ts
│   ├── CompactionParser.ts
│   ├── DeviceResourcePolicy.ts
│   └── ResponseMode.ts
├── voice/
│   ├── VoiceModelLifecycle.ts
│   ├── VoiceRecordingService.ts
│   └── VoiceTranscriptionService.ts
├── store/
│   ├── conversationStore.ts
│   ├── historyStore.ts
│   ├── settingsStore.ts
│   └── voiceStore.ts
├── components/
│   ├── chat/ResponseModeSelector.tsx
│   ├── chat/VoiceControl.tsx
│   └── chat/ConversationTargetPicker.tsx
└── evaluation/
```

## Pinned Reconciliation Constants

These values are fixed here and in `data-model.md` / `research.md`, pinned by tests, and changeable only through recorded evaluation:

- **Cosine similarity threshold**: `0.62`, a versioned retrieval constant (item traces to FR-017). Lives with the retrieval config alongside the mode profiles.
- **Chunking**: maximum `800` characters per chunk, `120`-character overlap, versioned via `chunk_version`; short messages remain a single searchable unit.
- **Context budget "units"**: character-based estimates measured by the existing `CharacterContextBudgetPolicy` (text length), NOT tokenizer tokens.
- **Response-mode storage**: stored lowercase (`low`/`medium`/`high`) in SQL; mapped to the runtime `Low`/`Medium`/`High` union through one tested conversion function.

## Implementation Phases

Phase order matches `tasks.md` exactly: setup → foundation → SQL history → immutable retries → per-conversation modes → image evidence → hybrid context → summaries/facts → past-chat targeting → voice → validation.

### Phase 0 — Setup & dependency/gate verification

- Record baseline short-chat, long-chat, image, retry, latency and memory fixtures/rubric.
- Verify the exact `expo-sqlite` version and its New Architecture / NDK-26 build.
- **Embedding gate**: run a `llama.rn` embedding spike and approve one exact model manifest (id, license, URL, filename, bytes, SHA-256, dimensions, runtime call shape, measured memory, latency).
- **Voice gate**: run an offline voice spike and approve one exact runtime/model/audio-capture manifest (API, audio format, New Architecture, NDK-26, storage, memory, cancellation).
- No embedding-runtime or voice-runtime task may start until its gate passes.

### Phase 1 — Foundation: schema, DB boundary, resource policy

- Implement the single SQLite boundary module (`foreign_keys = ON`, WAL); no other module opens the DB (Principle VIII).
- Create the full schema + `PRAGMA user_version` init for every table/index/constraint in `data-model.md`; allow an explicit **development-only** reset on incompatible versions (no MMKV history migration/fallback).
- Add the transaction helper, shared persistence types, and the `DeviceResourcePolicy` single-flight gate covering every protected operation.

### Phase 2 — SQL conversation history (US1)

- Implement `ConversationRepository` (keyset `(updated_at, id)`) and `MessageRepository` paging (keyset `(created_at, id)` within a conversation); pages ≤ 50 records.
- Replace `HistoryStore.list()` full loads with repository pages; add a bounded page cache (≤2 list pages, ≤3 message pages per active conversation) with anchor-preserving eviction.
- Seed and validate 200 conversations and several 500-message conversations; deletion cascades cleanly.

### Phase 3 — Immutable messages & retry attempts (US2)

- Immutable user messages and terminal assistant attempts; retry inserts a new assistant attempt linked to the same user message with one active-attempt selector.
- Canonical projection includes only active completed assistant attempts; failed/interrupted/superseded remain queryable for diagnostics only.

### Phase 4 — Per-conversation response modes (US6)

- Store non-null `response_mode` on every conversation, initialized from the global-default MMKV setting at creation.
- Define bounded, monotonic profiles in `ResponseMode.ts` (pinned by tests) and the lowercase↔runtime conversion function.
- Resolve the effective mode from the active conversation before each submit/retry. **Orchestrator/retriever wiring of the mode config is deferred to Phase 6** (after the orchestrator refactor exists); this phase delivers config, persistence, conversion and the UI selector only.

| Setting | Low | Medium | High |
|---|---:|---:|---:|
| Recent exact turns | 6 | 10 | 16 |
| Same-chat retrieved sources | 2 | 4 | 6 |
| Selected-chat retrieved sources | 1 | 3 | 5 |
| Context budget units (characters) | 4,000 | 7,000 | 11,000 |
| Answer target tokens | 192 | 384 | 768 |
| Hard generation limit | 320 | 640 | 1,024 |

### Phase 5 — Image assets & durable evidence (US5)

- Separate physical `image_asset` from `message_image`; persist versioned structured evidence with source references; reuse evidence for follow-ups without reprocessing.
- Missing-file behavior and unreferenced-file cleanup. Expose evidence as deterministic retrieval source units carrying conversation/message/image IDs. **`ContextOrchestrator` resolution of active-vs-referenced image evidence is deferred to Phase 6** (after the orchestrator refactor); this phase delivers repositories, persistence and evidence source units only.

### Phase 6 — Deterministic hybrid context (US3)

- Refactor `ContextOrchestrator` to assemble the fixed priority order over the SQL canonical projection.
- Implement `ChunkingService` (max 800 chars / 120 overlap, versioned), `ChunkRepository`, `EmbeddingRepository`, `HybridRetriever` (scope-first → cosine → threshold **0.62** → source dedup → mode limit → stable tie-break) and `LexicalFallbackRetriever`.
- **Wire the Phase-4 mode config and Phase-5 image-evidence resolution into the refactored orchestrator here.**
- **⛔ Gated (embedding manifest)**: `EmbeddingService` + bounded `EmbeddingBackfill` (≤25-item batches, records model/version/hash + source revision, resource-locked); ships behind lexical fallback until the gate passes.

### Phase 7 — Automatic compaction: summaries & durable facts (US4)

- Fixed triggers (24 eligible older messages or 6,000 estimated older character-units); one contiguous older range excluding the recent-turn window.
- Isolated internal Qwen request with native context reset; structured summary + source-linked facts; validate every referenced message ID before persistence.
- Deduplicate facts by normalized key; contradictions supersede. Stale only when covered visible sources/versions change. Never insert compaction prompts/results into visible history. Answering never blocks on pending compaction.

### Phase 8 — Explicit one-chat targeting (US7)

- Chat picker from the composer; deterministic named-chat intent detection.
- Bounded candidate lookup (≤10) over normalized title tokens + dates; no content/vector search before target resolution.
- Resolve to exactly one stable conversation ID or require the picker; request-scoped, source-attributed; never merge selected-chat content into active-chat facts/summary/image state. No unrestricted all-chat search.

### Phase 9 — Offline voice (US8)

- Explicit enablement + model-storage disclosure; download/verify the approved voice model.
- One protected lifecycle (recording → transcription → editable draft) under `DeviceResourcePolicy`; mutual exclusion with Qwen/embedding/compaction; unload heavy context before transcription if the spike requires it.
- Never auto-submit; submit transcript through the existing typed-message path.

### Phase 10 — Integration & device validation

- Run type-check, lint and the focused test suites; run the automated offline architecture guard and the consolidated deletion/cascade test.
- Validate exact context selection, immutable retry behavior, SQL page/cache bounds, retrieval latency, model memory, no cross-chat leakage, no protected-operation overlap, image/file cascade cleanup, and development reset.
- Final airplane-mode offline validation; compare answer quality to the recorded baseline.

## Complexity Tracking

| Complexity | Why accepted | Guardrail |
|---|---|---|
| SQLite plus MMKV settings | SQL is required for paging/relations; MMKV remains small settings only. | One SQL import boundary and one canonical history store. |
| Separate embedding and Whisper models | Semantic retrieval and offline STT require specialized models. | Exact manifests, lazy setup, serialization and unload rules. |
| Immutable attempts | Prevents silent history corruption and makes retries auditable. | One active attempt per user message; context projection hides non-active attempts. |
| Persisted summaries/facts | Long chats need bounded context without random/manual summaries. | Fixed triggers, isolated Qwen call, source links and versioning. |
| Bounded page eviction | Prevents Zustand memory growth. | Fixed page caps and anchor-preserving re-fetch. |