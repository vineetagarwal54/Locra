# Phase 0 Research: Hybrid Context, Per-Conversation Response Modes & Voice Input

**Feature**: `006-hybrid-context-response-voice`  
**Date**: 2026-07-13

Decisions marked **VERIFY BEFORE CODING** are gates, not assumptions.

## R1 — SQL runtime

**Decision**: Use `expo-sqlite` behind one `persistence/sqlite/` boundary.

**Rationale**: Locra needs indexed keyset pagination, transactions, cascading relational cleanup and bounded queries; MMKV cannot provide these without loading/sorting large values in memory.

**Implementation rules**

- Enable foreign keys and WAL.
- Use `(timestamp, id)` keyset cursors rather than `OFFSET` for interactive lists.
- Keep schema versioning, but permit destructive database reset while the app remains pre-beta.
- MMKV history migration, rollback and runtime fallback are not part of this feature.
- Existing small settings may remain in MMKV.

**VERIFY BEFORE CODING**

- SDK 56 bundled version.
- New Architecture compatibility.
- NDK-26 build compatibility.
- Transaction and WAL behavior on the target device.

## R2 — Development SQL cutover

**Decision**: SQL becomes canonical immediately and old MMKV chat history may be discarded.

**Rationale**: Production migration work would add substantial complexity without user value during current development.

**Rejected alternatives**

- One-release MMKV fallback: stale immediately because SQL becomes the only write target.
- Full verified migration: deferred until preservation of real user history becomes necessary.

**Exit requirement**: The app must expose a clear development reset path when the SQL schema changes incompatibly.

## R3 — Immutable messages and retries

**Decision**: Use one message table with immutable submitted user rows and assistant attempt rows.

**Lifecycle**

- User row is final on insert.
- Assistant row may append text only in `generating`.
- `completed`, `failed` and `interrupted` freeze content.
- Retry inserts another assistant row linked to the same user row.
- Selection metadata marks one attempt active; older attempts are never rewritten.
- Normal context includes user rows plus active completed assistant attempts only.

**Why this is preferable**

- Embeddings and summaries can reference stable source text.
- Retry bugs cannot silently corrupt previous answers.
- Failed attempts remain available for debugging.
- The model sees one clean canonical conversation projection.

**Difficulty**: Moderate, because streaming, retry, UI projection, persistence and context assembly must use the same active-attempt rule; it is not algorithmically difficult once the invariant is centralized.

## R4 — Images

**Decision**: Separate `image_asset` from `message_image`.

**Rationale**: A physical file can be reused or linked more than once; a single message-owned image row cannot safely enforce reference-count cleanup.

**Rules**

- File deletion is based on existence of remaining `message_image` rows, not a manually maintained counter.
- Evidence links to source message and asset.
- Missing file state is stored on the asset.
- Evidence may still support non-pixel follow-ups.

## R5 — Embeddings and similarity

**Decision**: Keep the embedding runtime provisional until an exact model spike succeeds; use a small quantized embedding GGUF through a verified local runtime, store float32 vectors in SQL and calculate cosine over a scope-filtered bounded candidate set.

**Required approved manifest**

- Model name and version.
- License.
- Source URL.
- Exact filename, size and SHA-256.
- Dimensions.
- Runtime/API call shape.
- Peak load and embedding memory.
- Average embedding latency on the target device.

**Lifecycle**

- Model is downloaded only through an explicit setup/recovery state.
- New terminal source content enters an embedding work queue.
- Backfill runs in batches of at most 25 units when idle.
- Every row records model artifact version/hash and source revision.
- Incompatible rows are marked stale and rebuilt.
- Lexical retrieval remains available whenever vectors are missing or failed.

**Why not native vector SQLite yet**: With scope limited to one active or selected conversation, hundreds of vectors are sufficient for bounded TypeScript cosine; native KNN can be revisited only after measurement.

**Pinned similarity threshold**: The cosine similarity threshold is a **versioned retrieval constant pinned at 0.62** (candidates below it are excluded). It lives with the retrieval config next to the response-mode profiles, is pinned by test, and may change only through recorded evaluation — never silently.

**Context budget units**: All "context budget units" are character-based estimates measured by the existing `CharacterContextBudgetPolicy` (text length), NOT tokenizer tokens.

## R6 — Chunking

**Decision**: Deterministic fixed-size overlapping windows for messages above a threshold; short messages create one searchable unit.

**Pinned values**: maximum **800 characters** per chunk with **120-character overlap**, versioned via `chunk_version`. Short messages (≤ the chunk size) remain a single searchable unit. Values are pinned by test and change only through recorded evaluation.

**Rules**

- Store original text unchanged.
- Persist ordinal and character boundaries (start/end offsets).
- Deduplicate retrieval by source message.
- Chunk config is versioned so changes trigger derived rebuilds.

## R7 — Summaries and durable facts

**Decision**: One `CompactionService` creates a summary and durable facts together through an isolated internal Qwen request.

**Initial deterministic trigger policy**

- At least 24 eligible messages outside the maximum 16-turn recent window, or
- At least 6,000 estimated units of unsummarized eligible older content.

**Isolation rules**

- Acquire the Qwen protected operation.
- Reset native context before the compaction prompt.
- Supply only the selected immutable visible range with source IDs.
- Require structured summary/fact output.
- Reset/release after completion.
- Never append compaction prompt or output to visible/managed history.

**Summary validity**

- A summary covers a contiguous visible source range.
- New messages after that range do not stale it.
- It stales when a covered message is deleted, the active assistant attempt inside the range changes, a source record changes unexpectedly or summarizer version changes.

**Fact lifecycle**

- Each fact has a normalized key and one-or-more source links.
- Duplicate same-value keys merge source links.
- A newer contradictory value creates a new fact that supersedes the earlier fact.
- Superseded facts remain stored but are excluded from active context.
- Facts are extracted only during deterministic compaction, never randomly per turn.

## R8 — Device resource policy

**Decision**: One explicit state machine/gate protects these mutually exclusive operations:

- Qwen answer generation.
- Qwen compaction.
- Embedding generation.
- Voice recording.
- Voice transcription.

**Chosen behavior**

- Recording itself is protected and cannot begin during another protected operation.
- No protected operation can begin while recording is active.
- UI navigation and draft editing remain available.
- A queued background embedding/compaction job yields to user-visible answer or voice work.
- Every path releases the gate on success, cancellation and failure.

This removes the earlier ambiguity about allowing recording to overlap generation.

## R9 — Offline voice

**Decision**: The voice runtime/model remains provisional until a physical-device spike verifies it.

**Preferred direction**: `whisper.rn` plus a small quantized model, but no dependency is installed until verification.

**Required verification**

- Current API and audio input format.
- New Architecture and NDK-26 build.
- Android API 26–35 permission behavior.
- License, model URL, filename, bytes and SHA-256.
- Download/resume/integrity behavior.
- Recording and transcription memory.
- Cancellation and context release.
- Transcription quality on representative accents/noise.

**Product rules**

- Explicit opt-in.
- Model size shown before download.
- Transcript fills the editable draft.
- Never auto-submit.
- Failure leaves draft and conversation intact.

## R10 — Per-conversation response modes

**Decision**: Store a non-null mode on every conversation; keep only a global default for initializing new chats.

**Rationale**: Different chats have different latency/depth needs, and per-chat persistence is simple once SQL exists.

**Complexity**: Low.

**Initial profiles**

| Setting | Low | Medium | High |
|---|---:|---:|---:|
| Recent exact turns | 6 | 10 | 16 |
| Same-chat retrieval limit | 2 | 4 | 6 |
| Selected-chat retrieval limit | 1 | 3 | 5 |
| Context budget units (characters) | 4,000 | 7,000 | 11,000 |
| Answer target tokens | 192 | 384 | 768 |
| Generation limit | 320 | 640 | 1,024 |

Changing mode affects only future requests; summaries and embeddings are mode-independent. Context budget units are character-based estimates (`CharacterContextBudgetPolicy`), not tokenizer tokens.

**Storage & conversion**: Modes are stored lowercase (`low`/`medium`/`high`) in SQL and mapped to the runtime `Low`/`Medium`/`High` union through one tested conversion function (single source of the mapping, both directions).

## R11 — Explicit past-chat targeting

**Decision**: Allow exactly one request-scoped selected past conversation.

**Resolution**

1. User selects a chat directly, or named-chat intent is detected.
2. Query normalized title tokens and optional date metadata only.
3. Return at most 10 candidates.
4. If one clear match exists, resolve its stable ID.
5. Otherwise require user selection.
6. Only after resolution may content/vector retrieval query that conversation.

**Out of scope**: automatic cross-chat memory and unrestricted all-chat search.

## R12 — Pagination and cache

**Decision**: Use keyset paging plus a bounded client page cache.

**Indexes**

- Conversation: `(updated_at DESC, id DESC)`.
- Message: `(conversation_id, created_at DESC, id DESC)`.
- Candidate title lookup: normalized title plus `(updated_at DESC, id DESC)`.
- Embedding compatibility/scope: `(conversation_id, model_version, state)`.

**Cache**

- 2 conversation pages maximum.
- 3 message pages maximum per active conversation.
- One inactive conversation may retain its newest page for fast return.
- Eviction must preserve list anchors; evicted ranges are re-read by cursor.

## R13 — Offline architecture guard

**Decision**: Add one lightweight automated guard test that fails if any module under `src/persistence/`, `src/retrieval/`, `src/inference/` (embedding/compaction paths), or `src/voice/` imports or calls a networking module (e.g. `fetch`, `expo-network` request APIs, `XMLHttpRequest`, sockets, or the background downloader from a non-model-artifact path).

**Rationale**: Constitution I (Privacy-First, NON-NEGOTIABLE) is structural. A cheap static import/call guard catches an accidental network dependency at test time, long before the final airplane-mode device audit. The project already exposes `NetworkGate`/`NetworkConnection`, so the allow/deny surface is well defined.

**Scope**: Static import-graph + source scan is sufficient; it complements — does not replace — the final physical airplane-mode validation.

## R14 — Test philosophy (reduced, focused)

**Decision**: Keep only tests required for core architecture, NON-NEGOTIABLE constitution rules, and high-risk lifecycle behavior. Do not add a separate test where an existing focused suite already covers the invariant.

**Applied**: pinned similarity threshold (0.62) is asserted inside the existing `HybridRetriever` suite; pinned chunk sizes (800/120) inside the `ChunkingService` suite; the lowercase↔runtime mode conversion inside the `ResponseMode` suite. Genuinely new suites are added only for: the embedding-lifecycle contract (model/version/hash/dimensions/source-revision/resource-lock/failure/≤25-batch), the offline architecture guard (R13), and one consolidated post-deletion cascade/orphan check after all tables exist.

## R15 — T092 live incremental voice gate (blocked, no runtime approved)

**Spike date**: 2026-07-14
**Gate result**: **BLOCKED — NOT APPROVED**

The required physical-device spike could not run. `adb devices -l` started the local ADB daemon successfully and then returned an empty device list. Because no Android device was available, no candidate was installed and no latency, memory, correction, permission, cancellation, cleanup, airplane-mode, New Architecture build, or NDK-26 build result was measured. T092 and its dependent T093 must remain unchecked.

### Source-inspected candidates (documentation evidence only)

| Candidate | Evidence found | Still unverified on Locra hardware |
|---|---|---|
| `whisper.rn` | The upstream project documents local `whisper.cpp` inference, a `RealtimeTranscriber`, PCM-stream adapter support, start/stop APIs, VAD/auto-slicing, Android support, MIT licensing, and Android build logic for both old and New Architecture source sets. Its build delegates `ndkVersion` to the consuming project and recommends NDK 24 or newer. | First-partial/update latency, whether callbacks provide sufficiently frequent revisable partials, peak memory beside Qwen, cancellation/resource cleanup, Android permission recovery, an actual New Architecture + NDK-26 Locra build, and model artifact selection/integrity. |
| `react-native-executorch` speech-to-text | Official documentation exposes offline Whisper models and accepts 16 kHz mono PCM as `Float32Array`; older streaming documentation describes incremental token callbacks and streaming actions. The current Android package uses the React Native Gradle plugin and supports arm64-v8a. | Current-version live incremental behavior (the current primary example is file transcription), correction semantics, latency/memory, cancellation/cleanup, compatibility with Locra's existing native stack and NDK-26, and exact approved model artifacts. |
| `sherpa-onnx` | Official documentation provides Android streaming and simulated-streaming ASR examples and states that prebuilt APKs run locally without internet. | A supported React Native New Architecture integration for this app, NDK-26 build compatibility, bridge/resource lifecycle, latency/memory, permission behavior, model choice and artifact integrity. |

Primary sources inspected:

- https://github.com/mybigday/whisper.rn
- https://raw.githubusercontent.com/mybigday/whisper.rn/main/android/build.gradle
- https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useSpeechToText
- https://raw.githubusercontent.com/software-mansion/react-native-executorch/main/packages/react-native-executorch/android/build.gradle
- https://k2-fsa.github.io/sherpa/onnx/android/prebuilt-apk.html
- https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html

### Measurements and artifact decision

| Required field | Result |
|---|---|
| Approved runtime/model | None — physical gate did not run |
| Model filename, size, URL and SHA-256 | Not selected; no manifest may be created from documentation alone |
| Audio format | Candidate documentation only: `whisper.rn` supports a PCM stream adapter; React Native ExecuTorch documents 16 kHz mono PCM `Float32Array` |
| First-partial latency | Not measured |
| Partial update latency | Not measured |
| Partial correction/revision behavior | Not measured |
| Peak recording/transcription memory | Not measured |
| Cancellation and native cleanup | Not measured |
| Microphone permission behavior | Not measured |
| Offline/airplane-mode behavior | Not measured |
| New Architecture compatibility | Not built on device |
| Android NDK-26 compatibility | Not built on device |
| License suitability | Candidate-level only; no final runtime/model license approved |

### Unblock criteria

Attach a representative supported Android physical device and run a release/dev-client spike built through the project's supported EAS Linux path. Capture timestamps for recording start, first partial, subsequent partial revisions and finalization; Android memory before/load/record/stop/release; permission grant/deny/permanent-deny recovery; cancel/restart behavior; airplane-mode operation after setup; and native resource release. Approve and record an exact runtime version and model manifest only after that run passes.
