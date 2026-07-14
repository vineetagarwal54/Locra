---
description: "Task list for Hybrid Context, Per-Conversation Response Modes & Voice Input"
---

# Tasks: Hybrid Context, Per-Conversation Response Modes & Voice Input

**Input**: Design documents from `specs/006-hybrid-context-response-voice/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED but intentionally focused (reduced-test philosophy, research R14). TDD applies to core persistence, immutability/retry invariants, deterministic retrieval, embedding lifecycle, compaction, response-mode behavior/conversion, target resolution, voice lifecycle, resource coordination, and the two NON-NEGOTIABLE guards (offline architecture, deletion cascade). Pinned constants are asserted **inside existing suites** rather than in new ones: the cosine threshold `0.62` in the `HybridRetriever` suite, chunk sizes `800/120` in the `ChunkingService` suite, and the lowercase↔runtime mode conversion in the `ResponseMode` suite. No UI snapshot tests, no nondeterministic model-output assertions. Tests live under `tests/unit/` and `tests/integration/` (jest-expo preset).

**Organization**: Grouped by the 8 user stories from spec.md; phase order matches plan.md exactly.

**Gates**: Two dependency choices are spike-gated (research R5/R9, plan Phase 0). Tasks that install/use those runtimes are marked **⛔ GATED** and MUST NOT start until the corresponding manifest is approved (T005 embedding, T006 voice).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US8 (setup/foundational/polish carry no story label)

## Path Conventions

Single Expo/React Native app. Source under `src/`; focused unit tests under `tests/unit/`, cross-module flow tests under `tests/integration/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependency verification, module scaffolding, evaluation baseline, spike gates.

- [X] T001 Create feature module directories: `src/persistence/sqlite/`, `src/persistence/`, `src/retrieval/`, `src/voice/`, and confirm `src/inference/`, `src/store/`, `src/components/chat/`, `src/evaluation/` exist.
- [X] T002 Verify and install `expo-sqlite` for SDK 56: inspect its `android/` for any `ndkVersion`/NDK-27 requirement (must build on pinned NDK 26.3.11579264), confirm New Architecture compatibility, add to `package.json`, and run a dev-client build to prove it links. (research R1)
- [X] T003 [P] Run `npm run type-check`, `npm run lint`, and `npm test` on the unchanged branch and record the baseline result before implementation.
- [X] T004 [P] Record reusable pre-feature evaluation fixtures and a manual scoring rubric (short chat, long chat, image answers, retries, latency, memory) in `src/evaluation/baselines/`; do not assert exact model wording in Jest. (FR-047)
- [ ] T005 **⛔ GATE** Run a `llama.rn` embedding spike on a physical 6–8GB device and approve one exact embedding artifact manifest (model id, license, URL, filename, bytes, SHA-256, dimensions, runtime call shape, peak memory, latency) in `research.md`; embedding-runtime implementation (T056/T057) is blocked until approval. (FR-021)
- [ ] T006 **⛔ GATE** Run a physical-device offline voice spike and approve one runtime/model/audio-capture manifest (API, audio format, New Architecture, NDK-26 build, Android permission behavior, license, URL, filename, bytes, SHA-256, memory, cancellation) in `research.md`; voice-runtime implementation (T073/T074) is blocked until approval. (FR-043)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: SQLite database, full schema, transaction + reset helpers, shared types, device resource policy.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Implement the SQLite database boundary in `src/persistence/sqlite/Database.ts`: open the DB, enable `PRAGMA foreign_keys = ON` and WAL; the ONLY file permitted to import `expo-sqlite` (Principle VIII / X).
- [X] T008 [P] Write one focused failing schema-contract suite in `tests/unit/persistence/Schema.test.ts` covering required tables, indexes, CHECK constraints, foreign keys, and partial unique indexes (deletion/orphan behavior is tested once in Polish, not duplicated here).
- [X] T009 Implement the full schema + `PRAGMA user_version` initialization in `src/persistence/sqlite/Schema.ts` for ALL tables/indexes/constraints in data-model.md (make T008 pass).
- [X] T010 [P] Implement a development-only explicit destructive reset helper in `src/persistence/sqlite/DevSchemaReset.ts`; bootstrap may invoke it only under a development flag and MUST never silently reset a production build. (FR-006)
- [X] T011 [P] Implement a transaction helper (run/rollback-on-throw) in `src/persistence/sqlite/Transactions.ts`.
- [X] T012 [P] Add shared persistence types in `src/persistence/types.ts` (Page<T>, keyset cursors, row shapes); extend `src/types/models.ts` with new entity types (attempt, image asset/link, evidence, chunk, embedding, summary, durable fact) without breaking existing exports.
- [X] T013 [P] Write failing tests for the device resource policy in `tests/unit/inference/DeviceResourcePolicy.test.ts`: only one protected op (qwen-answer, qwen-compaction, embedding, record, transcribe) may hold the lease; acquire waits/blocks; release on success/cancel/failure. (FR-045)
- [X] T014 Implement `src/inference/DeviceResourcePolicy.ts` extending the existing single-flight `InferenceQueue`/`InferenceActivityLock` into one mutual-exclusion gate (make T013 pass). (Constitution II/IV, FR-045)

**Checkpoint**: Database + schema + resource policy ready — user stories can begin.

---

## Phase 3: User Story 1 - Scalable SQL conversation history (Priority: P1) 🎯 MVP

**Goal**: 200+ conversations and long chats load through bounded, indexed keyset pagination with a bounded UI page cache; deleting a conversation cascades cleanly.

**Independent Test**: Seed ≥200 conversations (several with 500 messages); page the list and a long chat; confirm ≤50-record pages, bounded memory/cache, stable scroll on eviction, and that deleting a conversation removes its rows (SC-001/002/003/014).

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T015 [P] [US1] Failing `tests/unit/persistence/ConversationRepository.test.ts`: keyset list by `(updated_at DESC, id DESC)`, page size ≤50, `nextCursor` correctness, create (mode copied from global default), and `deleteConversation` cascade leaves zero child rows.
- [X] T016 [P] [US1] Failing `tests/unit/persistence/MessageRepository.test.ts`: `(conversation_id, created_at DESC, id DESC)` keyset, ≤50 per page, newest-first, no full-history load.
- [X] T017 [P] [US1] Failing `tests/unit/store/conversationStore.pagination.test.ts`: at most 2 list pages + 3 message pages per active conversation; eviction preserves anchors and re-fetches by cursor. (FR-005, research R12)

### Implementation for User Story 1

- [X] T018 [P] [US1] Implement `src/persistence/ConversationRepository.ts`: `listConversations` (keyset), `getConversation`, `createConversation` (copies global default mode, stored lowercase), `updateConversation`, `deleteConversation` (single transaction, cascade + image-file unlink hook). (FR-001/003/004, SC-014)
- [X] T019 [P] [US1] Implement `src/persistence/MessageRepository.ts` read/paginate surface: `listMessages` (keyset window), `countMessages`, `appendUserMessage`, `updateAssistantStreamingText`, `finalizeAttempt`. (FR-002/003)
- [X] T020 [US1] Refactor `src/store/conversationStore.ts` and `src/store/historyStore.ts` to read via repositories with a bounded page cache + anchor-preserving eviction, replacing `HistoryStore.list()` full loads. (FR-005; make T017 pass)
- [X] T021 [US1] Update `src/screens/HistoryScreen.tsx`, `src/navigation/ConversationDrawer.tsx`, `src/components/ConversationListItem.tsx` to consume paginated conversation pages (infinite scroll, ≤50 per page).
- [X] T022 [US1] Update `src/screens/ChatScreen.tsx` to load the newest message page first and fetch older pages on demand (bounded cache).
- [X] T023 [P] [US1] Add a seed/dev fixture `src/evaluation/fixtures/seedConversations.ts` generating ≥200 conversations incl. several with ~500 messages.
- [X] T024 [US1] Implement conversation deletion in the UI flow (drawer/history) calling `deleteConversation`; verify cascade + image-file cleanup end to end.

**Checkpoint**: History scales and pages independently; MVP demonstrable.

---

## Phase 4: User Story 2 - Immutable completed messages and safe retries (Priority: P1)

**Goal**: Submitted user text and terminal assistant attempts are immutable; retries create new linked attempts; only the active completed attempt enters normal context.

**Independent Test**: Submit a prompt, fail an attempt, retry (new attempt appears, old preserved), complete a later attempt; confirm no completed text is overwritten and context excludes failed/interrupted/superseded attempts (SC-004/005).

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T025 [P] [US2] Write one failing `tests/unit/persistence/MessageRepository.attempts.test.ts` covering submitted-user immutability, generating-only assistant updates, terminal immutability, retry insertion with incremented attempt number, one-active-attempt enforcement, selection-only switching, and canonical projection of user messages plus active completed attempts. (FR-008..014)

### Implementation for User Story 2

- [X] T026 [US2] Extend `src/persistence/MessageRepository.ts` with attempt lifecycle: `createAssistantAttempt(replyToUserMessageId)`, `setActiveAttempt` (one-transaction 1→0/0→1), immutability guards for user + terminal assistant rows. (FR-008/009/010/011/012; make T025 pass)
- [X] T027 [US2] Implement `getCanonicalProjection(conversationId)` (active completed attempts only) + `listAllAttempts` for diagnostics in `src/persistence/MessageRepository.ts`. (FR-013/014; make T025 pass)
- [X] T028 [US2] Rework `submit` and `retryFailedMessage` in `src/store/conversationStore.ts` to persist immutable user rows + streaming assistant attempts and to make retry insert a new attempt (not overwrite). (FR-011)
- [X] T029 [US2] Update `src/components/chat/MessageBubble.tsx` and `src/components/chat/StreamingMessage.tsx` to render the active attempt and expose retry without mutating prior attempts. (FR-011/014)
- [X] T030 [P] [US2] Update `src/diagnostics/DiagnosticsTraceStore.ts` consumers so diagnostics can list non-active attempts without polluting normal context.

**Checkpoint**: Retries are auditable; completed content never rewritten.

---

## Phase 5: User Story 6 - Per-conversation Low/Medium/High modes (Priority: P2)

**Goal**: Each conversation stores its own mode (lowercase in SQL, init from global default Medium); mode config (character-based budgets) drives future requests only; changing it loses no state. Orchestrator/retriever wiring of the config is deferred to the hybrid-context phase.

**Independent Test**: New conversation starts at global default; change a conversation's mode and confirm only that chat and only future requests are affected, monotonic differences appear, and no messages/embeddings/summaries/drafts are lost (SC-011).

### Tests for User Story 6 ⚠️ (write first, must fail)

- [X] T031 [P] [US6] Write one failing `tests/unit/inference/ResponseMode.test.ts` covering the pinned monotonic profiles, character-based `contextBudgetUnits`, the tested lowercase↔runtime conversion (`toStoredMode`/`fromStoredMode`, unknown→Medium), new-conversation initialization from the global default, per-conversation updates, future-request-only effect, and preservation of messages/drafts/images/summaries/embeddings. (FR-033/034/035/036, SC-011)

### Implementation for User Story 6

- [X] T032 [US6] Extend `src/inference/ResponseMode.ts` with `getResponseModeConfig(mode)` (full bounded profile; char-based budget units) and the single tested `toStoredMode`/`fromStoredMode` conversion function (make T031 pass). (FR-036)
- [X] T033 [US6] Add `setResponseMode` + lowercase `conversation.response_mode` reads/writes in `ConversationRepository.ts`; keep the global default in `settingsStore.ts` used only when a new conversation is created. (FR-033/034)
- [X] T034 [US6] Resolve the effective mode from the active conversation (via `fromStoredMode`) before each submit/retry in `src/store/conversationStore.ts` and pass generation limits through. **Orchestrator/retriever wiring of the mode config is deferred to T054 (hybrid-context phase).** (FR-035; make T031 pass)
- [X] T035 [US6] Implement `src/components/chat/ResponseModeSelector.tsx` (visible + changeable in chat UI) using existing design tokens/components per `design/design.md`; wire into `src/screens/ChatScreen.tsx` / `ChatComposer.tsx`. (US6 AS6, Principle XI)

**Checkpoint**: Per-conversation depth control works without state loss.

---

## Phase 6: User Story 5 - Image evidence reuse and lifecycle (Priority: P2)

**Goal**: Physical image assets separated from message links; structured evidence persisted once and reused without reprocessing; missing files and unreferenced cleanup handled. Orchestrator resolution wiring is deferred to the hybrid-context phase.

**Independent Test**: Attach an image, ask + two follow-ups (evidence reused, no reprocess); attach a second image (becomes active; earlier still resolvable); delete a message (link + evidence gone, file removed only when unreferenced); simulate missing file (evidence answers non-pixel; pixel request reports unavailable) (SC-008).

### Tests for User Story 5 ⚠️ (write first, must fail)

- [X] T036 [P] [US5] Write one failing `tests/unit/persistence/ImagePersistence.test.ts` covering asset reuse, message links, physical deletion only when unreferenced, missing-file state, evidence source/version references, and compatible-evidence reuse without regeneration. (FR-022/023/024/025)

### Implementation for User Story 5

- [X] T037 [P] [US5] Implement `src/persistence/ImageRepository.ts` (`image_asset` + `message_image`): create/link, `unlinkForMessage`, reference-existence-based file deletion, missing-file state. (FR-022/025; make T036 pass)
- [X] T038 [P] [US5] Implement `src/persistence/EvidenceRepository.ts`: `saveEvidence(HiddenVisualEvidence → row)`, `getEvidenceForMessage`, `getActiveImageEvidence(conversationId)`, `resolveReferencedImageEvidence`. (FR-023/024; make T036 pass)
- [X] T039 [US5] Persist `HiddenVisualEvidence` from the existing vision pipeline into SQL on turn completion in `src/store/conversationStore.ts` (replace ephemeral `contextMemory.mediaEvidence`). (FR-023)
- [X] T040 [US5] Implement active-vs-referenced image-evidence resolution **helpers in `EvidenceRepository`** (`getActiveImageEvidence` / `resolveReferencedImageEvidence`); reuse without reprocessing. **Wiring these helpers into `ContextOrchestrator` is deferred to T054 (hybrid-context phase).** (FR-024, US5 AS3/AS4)
- [X] T041 [US5] Implement missing-file behavior in the `src/inference/` image path: non-pixel follow-ups may use evidence; pixel-dependent requests report the original image unavailable and never substitute another image. (FR + Edge Cases)
- [X] T042 [US5] Expose persisted visual evidence as deterministic retrieval source units carrying conversation/message/image-asset IDs (chunked/embedded in T048/T049). (FR-023)

**Checkpoint**: Image follow-ups reuse evidence with correct lifecycle.

---

## Phase 7: User Story 3 - Deterministic hybrid context for long chats (Priority: P1)

**Goal**: Context assembled in the fixed priority order over the SQL canonical projection, with scope-first vector retrieval (threshold 0.62, mode-limited, deduped, deterministic) and lexical fallback; this phase also **wires in the Phase-4 mode config and Phase-5 image-evidence resolution** after the orchestrator refactor.

**Independent Test**: In a long chat establish an early fact, add many unrelated turns, ask a dependent follow-up (recovered); ask an unrelated query (no filler); run identical inputs twice (identical selection). With embeddings absent, retrieval falls back to lexical (SC-006/007).

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T043 [P] [US3] Failing determinism suite in `tests/unit/inference/ContextOrchestrator.test.ts`: fixed priority order (current request → recent exact turns → referenced image evidence → same-chat retrieved → selected past-chat retrieved → durable facts → older summary); recent-turn floor never replaced; identical inputs → identical order (score DESC, time DESC, id ASC); character-based budget drop lowest-priority-first. (FR-015/017, SC-007)
- [X] T044 [P] [US3] Failing `tests/unit/retrieval/HybridRetriever.test.ts`: scope filter applied before scoring; **pinned 0.62 cosine threshold** excludes low matches; source-message dedup; mode-specific limit; empty result adds no filler. (FR-016/017; item: threshold assertion folded here)
- [X] T045 [P] [US3] Failing `tests/unit/retrieval/LexicalFallbackRetriever.test.ts`: deterministic lexical results when compatible vectors are missing/stale/failed. (FR-020)
- [X] T046 [P] [US3] Failing `tests/unit/retrieval/ChunkingService.test.ts`: **pinned max 800 chars / 120 overlap**, short message → one unit, stores unchanged original, ordinal + char offsets + `chunk_version` recorded. (FR-023; item: chunk constants folded here)
- [X] T047 [P] [US3] Failing `tests/unit/retrieval/EmbeddingService.test.ts` (embedding **lifecycle contract**, precedes T056/T057): asserts persisted model id / artifact hash / embedding version / dimensions / source revision, `DeviceResourcePolicy` lease acquire+release, failure handling (marks state failed, keeps lexical fallback), and the ≤25-item backfill batch limit. (Constitution VI; FR-018/019)

### Implementation for User Story 3

- [X] T048 [P] [US3] Implement `src/persistence/ChunkRepository.ts`: upsert chunks for a message (back-references conversation/source_message/image_asset), unique `(source_message_id, chunk_version, ordinal)`.
- [X] T049 [P] [US3] Implement `src/persistence/EmbeddingRepository.ts`: `getCompatibleByScope(conversationIds, embeddingVersion, artifactHash)` (in-scope `ready` only), `upsert`, `markStaleByRevision`, `pendingBatch(limit)`. (FR-018/019)
- [X] T050 [P] [US3] Implement `src/retrieval/ChunkingService.ts` (800/120 deterministic windows; make T046 pass).
- [X] T051 [US3] Implement `src/retrieval/LexicalFallbackRetriever.ts` reusing the existing token-overlap logic from `ContextOrchestrator` (make T045 pass). (FR-020)
- [X] T052 [US3] Implement `src/retrieval/HybridRetriever.ts`: scope-first candidate load → cosine over float32 BLOBs → pinned 0.62 threshold constant → dedup by source message → mode limit → stable tie-break; delegate to lexical fallback when no compatible vectors. (FR-015/016/017; make T044 pass)
- [X] T053 [US3] Refactor `src/inference/ContextOrchestrator.ts` to assemble the fixed priority order over the SQL canonical projection using `HybridRetriever`, durable facts, and the newest valid range summary; enforce character-based budget drop lowest-priority-first while keeping current request + referenced image + recent-turn floor. (FR-015; make T043 pass)
- [X] T054 [US3] **Wire the Phase-4 mode config and Phase-5 image-evidence resolution into the refactored `ContextOrchestrator`**: apply per-mode recent-turn floor / budget / retrieval limits, and resolve active-vs-referenced image evidence via `EvidenceRepository`. (moves the deferred wiring from T034/T040 here)
- [X] T055 [US3] Wire `src/inference/ContextBuilder.ts` to receive the assembled context unchanged (preserve `CanonicalConversationContext`) and pass the effective response-mode config.
- [ ] T056 [US3] **⛔ GATED (T005)** Implement `src/retrieval/EmbeddingService.ts` using the approved manifest via `llama.rn`, resource-locked; expose `modelId`, `modelArtifactHash`, `embeddingVersion`, `dimensions` (make T047 pass). (FR-018)
- [ ] T057 [US3] **⛔ GATED (T005)** Implement `src/retrieval/EmbeddingBackfill.ts`: enqueue new/changed derived units after terminal persistence; backfill ≤25 units when idle and resource-locked; record model/version/hash + source revision; yield to user-visible work (make T047 pass). (FR-019)

**Checkpoint**: Long-chat continuity works deterministically (lexical now, vectors when gated runtime lands).

---

## Phase 8: User Story 4 - Automatic summaries and durable facts (Priority: P2)

**Goal**: Fixed-trigger compaction produces one range summary + source-linked durable facts via an isolated internal Qwen request; summaries stale only on covered-range change; answering never blocks on pending compaction.

**Independent Test**: Drive a conversation past a pinned trigger; confirm exactly one compaction runs, produces a range summary + facts, does not enter visible history, does not stale when unrelated later turns are appended; contradictory facts supersede (SC-009).

### Tests for User Story 4 ⚠️ (write first, must fail)

- [X] T058 [P] [US4] Write one failing `tests/unit/inference/CompactionService.test.ts` lifecycle suite covering the pinned trigger policy (≥24 eligible older messages OR ≥6,000 estimated older **character** units), no random/manual trigger, immutable covered ranges, appended-turn validity, and staleness only from covered-source/active-attempt/deletion/version changes. (FR-026/028, SC-009)
- [X] T059 [P] [US4] Failing `tests/unit/persistence/FactRepository.test.ts`: normalized-key dedup, multi-source links, contradictory newer fact supersedes (older retained). (FR-030/031)
- [X] T060 [P] [US4] Failing `tests/unit/inference/CompactionParser.test.ts`: structured output → one summary + source-linked facts; every referenced message ID validated before persistence.

### Implementation for User Story 4

- [X] T061 [P] [US4] Implement `src/persistence/SummaryRepository.ts`: versioned range summary (`first/last_source_message_id`, `source_view_hash`, `summarizer_version`, `status`), `markStale`, `getNewestReady`. (FR-027)
- [X] T062 [P] [US4] Implement `src/persistence/FactRepository.ts` + `durable_fact_source` writes: upsert by normalized key, supersession link, `getReadyFacts`, `markStale` (make T059 pass). (FR-030/031)
- [X] T063 [P] [US4] Implement `src/inference/CompactionPrompt.ts` and `src/inference/CompactionParser.ts` (make T060 pass). (FR-029)
- [X] T064 [US4] Implement `src/inference/CompactionService.ts`: evaluate fixed triggers, select one contiguous older range excluding the recent-turn window, acquire `DeviceResourcePolicy` (qwen-compaction), reset native Qwen context, run the isolated request, validate IDs, persist summary + facts; never inject prompt/output into visible history. (FR-026/029/032; make T058 pass)
- [X] T065 [US4] Integrate compaction into `src/store/conversationStore.ts` after terminal message persistence (never concurrent with visible generation/embedding/recording/transcription); answering proceeds with exact/retrieved context + last valid summary when compaction is pending. (FR-032, SC-009)
- [X] T066 [US4] Confirm summaries + durable facts fill the `ContextOrchestrator` assembly slots already ordered in T053, internal-only (no UI surface).

**Checkpoint**: Long chats compact automatically and deterministically.

---

## Phase 9: User Story 7 - Explicit retrieval from one past conversation (Priority: P3)

**Goal**: Cross-chat retrieval is off by default; a user selects/names exactly one past chat, resolved via bounded (≤10) metadata candidates; retrieval is request-scoped and source-attributed with no merging into active-chat derived data.

**Independent Test**: Name a chat → only that resolved ID searched; ambiguous description → bounded picker, no retrieval until selection; deleted target → clear notice, request continues without cross-chat context; zero unrelated-chat leakage (SC-010).

### Tests for User Story 7 ⚠️ (write first, must fail)

- [X] T067 [P] [US7] Failing `tests/unit/retrieval/ConversationTargetResolver.test.ts`: default active-only; named/selected → single stable ID; candidate search bounded to ≤10 via normalized title tokens + dates; ambiguity → require selection; no content retrieval before resolution; deleted target → not-found. (FR-037/038/039/041)

### Implementation for User Story 7

- [X] T068 [US7] Implement `src/retrieval/ConversationTargetResolver.ts`: deterministic named-chat intent detection + `normalized_title` candidate query (≤10), resolve-to-one or ambiguous/not-found (make T067 pass). (FR-037/038/039)
- [X] T069 [US7] Extend `HybridRetriever`/`ContextOrchestrator` to accept a request-scoped single `conversation_target`, apply the selected-chat retrieval limit, preserve source attribution, and NEVER merge selected-chat content into active-chat summary/facts/active-image state. (FR-040/041, US7 AS8)
- [X] T070 [US7] Implement `src/components/chat/ConversationTargetPicker.tsx` (bounded candidate list) reachable from `ChatComposer.tsx`, existing design components; handle ambiguous + deleted-target notices. (US7 AS5, Edge Cases)
- [X] T071 [US7] Wire target selection through `src/store/conversationStore.ts` submit path as transient request scope (not persisted). (FR-040)

**Checkpoint**: One-chat targeting works with zero leakage.

---

## Phase 10: User Story 8 - Fully offline voice input (Priority: P3)

**Goal**: Explicit opt-in on-device transcription writes editable draft text (never auto-submit) through the same pipeline as typed input, with recording/transcription mutually exclusive with Qwen/embedding work.

**Independent Test**: Offline, enable voice (storage disclosure + download/verify), record → editable transcript (no auto-submit), edit + submit → same pipeline; recording during a protected op is blocked with a clear status; cancellation/failure leaves the draft intact (SC-012).

### Tests for User Story 8 ⚠️ (write first, must fail)

- [X] T072 [P] [US8] Write one failing `tests/unit/voice/VoiceFlow.test.ts` covering explicit enablement, storage disclosure, download/integrity failure recovery, editable transcript with no auto-submit, and mutual exclusion for record/transcribe versus every protected operation. (FR-042/044/045, SC-012)

### Implementation for User Story 8

- [ ] T073 [US8] **⛔ GATED (T006)** Install the approved voice runtime (NDK-26 + New-Arch verified) and implement `src/voice/VoiceModelLifecycle.ts` (enable, storage disclosure, download/verify via existing model-artifact patterns, mic permission). (FR-042/043; make T072 pass)
- [ ] T074 [US8] **⛔ GATED (T006)** Implement `src/voice/VoiceRecordingService.ts` and `src/voice/VoiceTranscriptionService.ts` (on-device transcribe, cancellation, context release) resource-locked via `DeviceResourcePolicy`. (FR-042/045; make T072 pass)
- [X] T075 [P] [US8] Implement `src/store/voiceStore.ts` (zustand) for enable/download/permission/recording/transcribing/error UI state.
- [X] T076 [US8] Implement `src/components/chat/VoiceControl.tsx` and wire into `src/components/chat/ChatComposer.tsx`: transcript → editable draft; explicit Send only; clean recovery on cancel/failure; existing design tokens. (FR-044, US8 AS4/AS8, Principle XI)
- [X] T077 [US8] Confirm submitted voice text flows through the identical typed-message submit path (`conversationStore.submit`) with no separate answer path. (FR-044/046, US8 AS5)

**Checkpoint**: Offline voice works with resource safety and no auto-submit.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Offline architecture guard, consolidated cascade check, full evaluation, device validation.

- [X] T078 [P] Add one lightweight automated **offline architecture guard** in `tests/unit/architecture/OfflineGuard.test.ts` that fails if any module under `src/persistence/`, `src/retrieval/`, `src/inference/` (embedding/compaction paths), or `src/voice/` imports or calls a networking module (`fetch`, `expo-network` request APIs, `XMLHttpRequest`, sockets, or the background downloader outside model-artifact paths). (Constitution I; SC-015; research R13)
- [X] T079 [P] Add one consolidated **deletion/cascade** test in `tests/integration/Deletion.test.ts` (after all tables exist): deleting a conversation leaves zero orphaned attempts, chunks, embeddings, evidence, summaries, facts, and image links, and zero unreferenced image files. (SC-014)
- [X] T080 Implement the evaluation harness + repeatable cases in `src/evaluation/cases/` covering short chat, long chat, image follow-ups, retries, selected past-chat retrieval, all modes, voice, memory, storage, latency, and comparison against the T004 baseline rubric. (FR-048/049)
- [ ] T081 Run physical-device validation from `quickstart.md`: page/cache bounds, retrieval latency, answer-quality rubric, image/file cleanup after deletion, model memory, no protected-operation overlap, development DB reset, and a **final airplane-mode** offline audit. (SC-001/002/003/004/006/010/012/013/014/015)
- [X] T082 Full `npm run type-check`, `npm run lint`, and `npm test` green; confirm no `any`/unexplained `@ts-ignore` added (Principle V).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup**: T002 (SQLite build) blocks Foundational. T005/T006 are independent spike gates that block ONLY the embedding runtime (T056/T057) and voice runtime (T073/T074); all other work proceeds without them.
- **Foundational** (schema/DB/resource policy): blocks every user story.
- **Order** (matches plan.md): SQL history (US1) → immutable retries (US2) → per-conversation modes (US6) → image evidence (US5) → hybrid context (US3) → summaries/facts (US4) → past-chat targeting (US7) → voice (US8) → polish.
- **Modes & images before hybrid, wiring in hybrid**: US6 delivers mode config/persistence/conversion/UI and US5 delivers image repositories/evidence; **their `ContextOrchestrator` wiring lands in US3 (T054)** after the orchestrator refactor exists.
- **Hybrid → compaction & targeting**: US4 fills the summary/fact slots ordered in T053; US7 extends the same finalized retriever/orchestrator (T069).
- **Voice**: depends only on the resource policy + approved voice gate; implemented after the core context path.
- **Polish**: offline guard (T078) and consolidated deletion (T079) run after all modules/tables exist; device validation + airplane-mode last.

### Key cross-story edges

- US2 canonical projection (T027) is the only message source for retrieval, summaries, facts, and Qwen context.
- Effective per-conversation mode config (T032/T034) is wired into retrieval/context in T054.
- Image evidence (T038/T040) is persisted before the orchestrator resolves it in T054.
- Compaction (US4) fills summary/fact slots defined by hybrid context (T053).
- Past-chat targeting (US7) only changes request scope; never persists foreign chat data into the active chat.
- Embedding (T056/T057) and voice (T073/T074) runtime tasks remain blocked until their manifests pass the physical-device gates.

### Within each story

- Write one focused failing suite per invariant boundary, implement the repository/service, then wire store/UI and validate.
- Pinned constants are asserted inside existing suites (threshold in T044, chunk sizes in T046, mode conversion in T031). Do not add snapshot tests, duplicate cascade tests, exact model-output assertions, or per-value micro-tests.

---

## Parallel Opportunities

- Baseline (T003/T004) and the two device spikes (T005/T006) run independently.
- Foundational: T008/T010/T011/T012/T013 are [P]; T009 depends on T008, T014 on T013.
- Per story: test tasks marked [P] run together first; repositories in separate files run in parallel once the schema is stable (e.g. T018/T019, T037/T038, T048/T049, T061/T062).
- Across stories: once Foundational is done, US1/US2/US6/US5/US8 can be staffed in parallel; US3 then US4/US7 follow the retrieval spine.
- Polish: T078 and T079 are [P] (different files).

### Parallel example (User Story 3)

```bash
# Tests first (all fail):
Task: "T043 determinism suite in tests/unit/inference/ContextOrchestrator.test.ts"
Task: "T044 HybridRetriever (threshold 0.62) in tests/unit/retrieval/HybridRetriever.test.ts"
Task: "T045 LexicalFallbackRetriever in tests/unit/retrieval/LexicalFallbackRetriever.test.ts"
Task: "T046 ChunkingService (800/120) in tests/unit/retrieval/ChunkingService.test.ts"
Task: "T047 EmbeddingService lifecycle in tests/unit/retrieval/EmbeddingService.test.ts"
# Then parallel repositories:
Task: "T048 ChunkRepository in src/persistence/ChunkRepository.ts"
Task: "T049 EmbeddingRepository in src/persistence/EmbeddingRepository.ts"
```

---

## Implementation Strategy

1. Finish Setup and Foundational infrastructure.
2. Implement scalable SQL history and bounded cache (US1) — MVP checkpoint.
3. Implement immutable messages and retry attempts (US2).
4. Implement per-conversation response modes: config, conversion, persistence, UI (US6).
5. Persist image assets and reusable visual evidence (US5).
6. Implement lexical-first hybrid context, wire mode + image-evidence into the refactored orchestrator, then attach approved vector embeddings (US3).
7. Implement deterministic Qwen compaction for summaries and durable facts (US4).
8. Add explicit one-chat targeting (US7).
9. Add gated offline voice (US8).
10. Run the offline guard, consolidated deletion check, evaluation, physical-device validation, type-check, lint, and focused tests.

First meaningful checkpoint: SQL history + immutable retries. First complete architecture checkpoint: hybrid context + compaction. Voice is the final optional native-risk phase.

---

## Notes

- Core tests remain mandatory (Constitution VI); the list avoids repetitive coverage and nondeterministic assertions (research R14).
- Existing MMKV chat history is NOT migrated (development-stage cutover, FR-006); MMKV holds only small settings.
- New UI uses existing design tokens/components and is validated manually on device (Principle XI).
- Commit by logical phase rather than one commit per tiny task.
