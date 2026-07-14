# Phase 1 Data Model: Hybrid Context, Per-Conversation Response Modes & Voice Input

**Feature**: `006-hybrid-context-response-voice`  
**Date**: 2026-07-13

SQLite is the canonical conversation store. Existing MMKV chat history may be discarded during development; MMKV remains only for small settings such as the global default response mode.

All timestamps are epoch milliseconds. Foreign keys use `ON DELETE CASCADE` unless stated otherwise. All interactive pagination uses stable timestamp-plus-ID keysets.

## Relationship Overview

```text
conversation 1 ──∞ message
message(user) 1 ──∞ message(assistant attempts via reply_to_message_id)
conversation 1 ──∞ image_asset
message ∞ ──∞ image_asset through message_image
message 1 ──∞ visual_evidence
message 1 ──∞ chunk
chunk/message/evidence/fact 1 ──∞ embedding (enforced nullable FKs)
conversation 1 ──∞ summary
conversation 1 ──∞ durable_fact
durable_fact ∞ ──∞ message through durable_fact_source

conversation_target, conversation_candidate and voice_transcript are transient.
voice model state and global default response mode may remain in MMKV.
```

## Persisted Entities

### conversation

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | Stable identity; never derived from title. |
| title | TEXT | Display/discovery metadata. |
| normalized_title | TEXT idx | Deterministic lowercase/token-normalized candidate lookup. |
| response_mode | TEXT NOT NULL | Stored lowercase `low`/`medium`/`high`; copied from global default at creation; mapped to the runtime `Low`/`Medium`/`High` union via one tested conversion function. |
| created_at | INTEGER | |
| updated_at | INTEGER | Updated when a visible message/attempt changes. |
| deleted_at | INTEGER NULL | Optional deletion guard before hard delete. |

**Indexes**

- `(updated_at DESC, id DESC)`
- `(normalized_title, updated_at DESC, id DESC)`

### message

One table stores submitted user messages and assistant attempts.

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | → conversation.id |
| role | TEXT | `user` or `assistant` |
| reply_to_message_id | TEXT FK NULL idx | Assistant attempt → source user message; NULL for user. |
| attempt_number | INTEGER NULL | Assistant only; starts at 1 per source user message. |
| is_active_attempt | INTEGER NOT NULL | Assistant only; 1 means canonical visible attempt. |
| text | TEXT | User text is immutable on insert; assistant text mutable only while generating. |
| status | TEXT | User: `submitted`; assistant: `generating`, `completed`, `failed`, `interrupted`. |
| error_message | TEXT NULL | Terminal diagnostic text. |
| finalized_at | INTEGER NULL | Set at assistant terminal transition. |
| created_at | INTEGER | Stable ordering. |

**Indexes and constraints**

- `(conversation_id, created_at DESC, id DESC)` for keyset paging.
- `(reply_to_message_id, attempt_number)` unique for assistant attempts.
- Partial unique index allowing at most one active assistant attempt per `reply_to_message_id`.
- CHECK: user rows have NULL reply/attempt and status `submitted`.
- CHECK: assistant rows have non-NULL reply/attempt.
- Application/transaction invariant: terminal text/status cannot be updated.
- Updating `is_active_attempt` is allowed selection metadata and does not alter content.

**Canonical conversation projection**

- Include every user message in order.
- For each user message include only its active assistant attempt when that attempt is `completed`.
- Exclude generating, failed, interrupted and superseded attempts from normal model context.
- Diagnostic/history inspection may query every attempt.

### image_asset

Physical local image file.

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | Owning conversation for isolation/deletion. |
| local_path | TEXT UNIQUE | |
| available | INTEGER | 1 when file exists/readable. |
| content_hash | TEXT NULL | Optional dedup/integrity key. |
| created_at | INTEGER | |

Physical deletion occurs only after the transaction confirms no `message_image` rows reference the asset.

### message_image

| Field | Type | Rules |
|---|---|---|
| message_id | TEXT FK | → message.id |
| image_asset_id | TEXT FK | → image_asset.id |
| ordinal | INTEGER | Attachment order. |
| created_at | INTEGER | |

**Primary key**: `(message_id, image_asset_id)`.

### visual_evidence

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | |
| source_message_id | TEXT FK idx | Image-bearing user message. |
| image_asset_id | TEXT FK idx | |
| evidence_version | TEXT | |
| subject_object | TEXT | |
| visible_features_json | TEXT | |
| visible_text_json | TEXT | |
| visible_condition | TEXT | |
| uncertainty_json | TEXT | |
| source_revision | TEXT | Hash/version of source image + evidence prompt/parser. |
| created_at | INTEGER | |

A compatible ready evidence row is reused; it is not regenerated for every follow-up.

### chunk

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | |
| source_message_id | TEXT FK idx | Immutable source message/attempt. |
| image_asset_id | TEXT FK NULL | Optional source image. |
| chunk_version | TEXT | Chunking configuration version. |
| ordinal | INTEGER | |
| start_offset | INTEGER | |
| end_offset | INTEGER | |
| text | TEXT | Derived fragment. |
| source_revision | TEXT | Stable source-content hash. |
| created_at | INTEGER | Source timestamp. |

Unique: `(source_message_id, chunk_version, ordinal)`.

Deterministic chunking config (pinned, versioned by `chunk_version`): **maximum 800 characters per chunk with 120-character overlap**; a message ≤ 800 characters produces exactly one chunk. `start_offset`/`end_offset` are character offsets. Values change only through recorded evaluation.

### embedding

One table with enforceable nullable source FKs instead of a polymorphic unverified `source_id`.

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | Scope filter before scoring. |
| chunk_id | TEXT FK NULL | |
| message_id | TEXT FK NULL | |
| evidence_id | TEXT FK NULL | |
| fact_id | TEXT FK NULL | |
| model_id | TEXT | |
| model_artifact_hash | TEXT | Exact artifact compatibility. |
| embedding_version | TEXT idx | Runtime/prompt/pooling version. |
| dimensions | INTEGER | |
| source_revision | TEXT | |
| vector | BLOB | Little-endian float32. |
| state | TEXT | `pending`, `ready`, `stale`, `failed`, `rebuilding`. |
| created_at | INTEGER | |
| updated_at | INTEGER | |

**Constraints**

- CHECK exactly one of `chunk_id`, `message_id`, `evidence_id`, `fact_id` is non-NULL.
- Partial unique index per source FK + embedding version + artifact hash for one compatible active row.
- Index `(conversation_id, embedding_version, model_artifact_hash, state)`.

### summary

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | |
| first_source_message_id | TEXT FK | Inclusive visible range start. |
| last_source_message_id | TEXT FK | Inclusive visible range end. |
| source_view_hash | TEXT | Hash of ordered visible source IDs/attempt IDs/content hashes. |
| summarizer_version | TEXT | Prompt/parser/model config version. |
| text | TEXT | Derived, never replaces originals. |
| status | TEXT | `ready`, `stale`, `superseded`, `failed`. |
| version | INTEGER | Monotonic per conversation. |
| created_at | INTEGER | |
| updated_at | INTEGER | |

**Validity**

- Appending new turns after `last_source_message_id` does not stale the row.
- It becomes stale when a source in the range is removed, active-attempt selection in the range changes, the source-view hash changes or summarizer version changes.
- Only the newest compatible ready range summary participates in context.

### durable_fact

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT FK idx | |
| normalized_key | TEXT idx | Deterministic dedup/contradiction key. |
| value_text | TEXT | |
| fact_type | TEXT | `fact` or `decision`. |
| extraction_version | TEXT | Compaction prompt/parser version. |
| status | TEXT | `ready`, `stale`, `superseded`, `failed`. |
| supersedes_fact_id | TEXT FK NULL | New contradictory fact points to older fact. |
| source_view_hash | TEXT | |
| created_at | INTEGER | |
| updated_at | INTEGER | |

Unique active target may be enforced by `(conversation_id, normalized_key)` where status is `ready`.

### durable_fact_source

| Field | Type | Rules |
|---|---|---|
| fact_id | TEXT FK | |
| message_id | TEXT FK | Source visible message/attempt. |

Primary key: `(fact_id, message_id)`.

This supports facts derived from multiple turns and ensures every fact remains attributable.

## Non-Persisted / Settings Entities

### response_mode configuration

Code-owned immutable profiles:

| Setting | Low | Medium | High |
|---|---:|---:|---:|
| Recent exact turns | 6 | 10 | 16 |
| Same-chat retrieval limit | 2 | 4 | 6 |
| Selected-chat retrieval limit | 1 | 3 | 5 |
| Context budget units (characters) | 4,000 | 7,000 | 11,000 |
| Answer target tokens | 192 | 384 | 768 |
| Generation limit | 320 | 640 | 1,024 |

- "Context budget units" are **character-based** estimates measured by the existing `CharacterContextBudgetPolicy` (text length), not tokenizer tokens.
- Conversation choice is persisted lowercase in `conversation.response_mode` and converted to/from the runtime `Low`/`Medium`/`High` union through one tested conversion function.
- Global default remains a small MMKV setting and only initializes a new conversation.
- The cosine similarity retrieval threshold is a versioned constant pinned at **0.62**, co-located with these profiles in `ResponseMode.ts` / retrieval config; changeable only through recorded evaluation.

### conversation_target

Transient request scope:

| Field | Type |
|---|---|
| targetConversationId | string or null |
| origin | `active`, `named`, `selected` |
| sourceLabel | title/date snapshot for attribution |

Exactly one selected past conversation is allowed; no all-chat target exists.

### conversation_candidate

Transient picker record:

- conversation ID
- title
- updated date
- optional short metadata preview

At most 10 candidates.

### voice_model_state

May remain in MMKV because it is small lifecycle/settings state:

- enabled
- artifact manifest/version
- download status/progress
- integrity verified
- permission state
- last error

### voice_transcript

Uses the existing draft text; no committed message exists until the user presses Send.

## Derived Invariants

1. **Content immutability**: submitted user text and terminal assistant text never change.
2. **One active attempt**: each user message has at most one active assistant attempt.
3. **Clean model view**: context uses active completed attempts only.
4. **Derived-data authority**: chunks, vectors, summaries and facts can be deleted/rebuilt without modifying original messages.
5. **Scope before similarity**: embedding rows are selected by conversation scope and compatibility before cosine scoring; candidates below the pinned **0.62** cosine threshold are excluded.
6. **Stable ordering**: score DESC, source time DESC, source ID ASC is the final deterministic retrieval order.
7. **Summary range stability**: appended turns outside a range do not stale it.
8. **Fact history**: contradictions supersede older facts rather than overwriting/deleting them.
9. **Image cleanup**: assets are unlinked only after no message references remain.
10. **Bounded memory**: repositories return pages; stores cache only configured pages.
11. **Development cutover**: no MMKV history migration/fallback state exists in this schema.

## State Transitions

- **Assistant attempt**: `generating → completed | failed | interrupted`; all terminal states are immutable.
- **Attempt selection**: old active attempt `1 → 0`, new attempt `0 → 1` in one transaction.
- **Embedding**: `pending → ready | failed`; `ready → stale → rebuilding → ready`.
- **Summary**: `ready → stale | superseded`; regeneration creates a new version.
- **Durable fact**: `ready → stale | superseded`; contradictory extraction creates a new linked fact.
- **Voice operation**: `disabled → model_needed → downloading → ready → recording → transcribing → draft_ready`.