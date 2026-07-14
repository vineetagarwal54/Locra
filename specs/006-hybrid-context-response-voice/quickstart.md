# Quickstart & Validation Guide

**Feature**: 006-hybrid-context-response-voice

This guide proves the feature end-to-end. It references [data-model.md](./data-model.md), [contracts/](./contracts/), and the spec's acceptance scenarios & success criteria — it does not restate implementation. Run on the authoritative target: a physical Android device with 6–8GB RAM, New Architecture, NDK-26 build. This is a development-stage SQL cutover: **existing MMKV chat history may be discarded; there is no migration to validate.**

## Prerequisites

- Existing Locra dev-client build runs (`npm run android`) with the Qwen model downloaded.
- New native deps installed and verified against NDK 26.3.11579264 (research R1 for SQLite; R5/R9 spike gates for embedding/voice) **before** building.
- Jest available: `npm test`.

## Automated checks (run first, TDD — Constitution VI)

```bash
npm test          # focused suites: schema contract, device resource policy, conversation/message
                  # pagination, message immutability + retry attempts, response-mode profiles + lowercase
                  # conversion, image persistence, chunking (800/120), hybrid retrieval (threshold 0.62),
                  # lexical fallback, embedding lifecycle, compaction triggers/staleness, fact lifecycle,
                  # target resolution, voice flow, OFFLINE ARCHITECTURE GUARD, consolidated deletion cascade.
npm run type-check
npm run lint
```

Expected: all focused suites exist and pass; the offline architecture guard passes (no networking imports in persistence/retrieval/embedding/compaction/voice); no `any`; lint clean.

## Manual validation scenarios

Each maps to spec user stories (US) and success criteria (SC).

### V1 — Scale & pagination (US1 / SC-001, SC-002, SC-003)
1. Seed ≥200 conversations (several with ~500 messages) via the seed fixture.
2. Open the conversation list. **Expect**: first page < 1.5s; only a bounded page (≤50) loaded.
3. Open a long chat, scroll page-by-page. **Expect**: first message page < 1s, next pages < 500ms; the page cache stays within bounds (≤2 list pages, ≤3 message pages) with no full-history load.

### V2 — Immutable messages & retries (US2 / SC-004, SC-005)
1. Submit a prompt; force the assistant attempt to fail; retry. **Expect**: a new attempt appears; the failed attempt's text is preserved unchanged.
2. Let a later attempt complete. **Expect**: no completed text is ever overwritten; only the active completed attempt enters normal context; failed/interrupted/superseded attempts remain queryable for diagnostics only.

### V3 — Deletion & isolation (US1 / SC-014)
1. Delete a conversation. **Expect**: its messages, attempts, chunks, embeddings, evidence, summaries, facts, image links are gone and unreferenced image files are removed; zero orphans (mirrors the consolidated deletion test).
2. In conversation A, ask something answerable only by conversation B's content **without** referencing B. **Expect**: no B content appears.

### V4 — Long-chat continuity (US3 / SC-006, SC-007)
1. Establish a fact early in a long chat; continue for many unrelated turns; ask a dependent follow-up. **Expect**: answer reflects the early fact.
2. Ask something unrelated to any stored content. **Expect**: no low-relevance filler (candidates below the pinned 0.62 threshold are excluded).
3. Repeat an identical request on identical state twice. **Expect**: identical selected sources + ordering (determinism). With embeddings absent, retrieval falls back to lexical without failing.

### V5 — Image follow-ups (US5 / SC-008)
1. Attach an image, ask about it, then ask two follow-ups. **Expect**: follow-ups reuse stored evidence, original image **not** reprocessed; latency lower than the first answer.
2. Attach a second image. **Expect**: it becomes the active image; an explicit reference to the first still resolves to the first image's evidence.
3. Delete the image-bearing message; simulate a missing file. **Expect**: file removed only when unreferenced; non-pixel follow-ups may still use evidence; pixel-dependent requests report the original image unavailable and never substitute another image.

### V6 — Per-conversation response modes (US6 / SC-011)
1. Create a new conversation. **Expect**: it starts at the global default (Medium).
2. Send the same request under Low, Medium, High in different conversations. **Expect**: monotonic differences in context budget (character-based), retrieval depth, and answer length; same model.
3. Change one conversation's mode. **Expect**: only that conversation and only future requests are affected; other conversations unchanged; no messages/embeddings/summaries/drafts lost.

### V7 — Explicit past-chat retrieval (US7 / SC-010)
1. Create several chats with overlapping titles. Ask "use my <name> chat". **Expect**: only that resolved conversation ID is searched; sources retain references.
2. Give an ambiguous description. **Expect**: a bounded (≤10) selection list; no retrieval until you pick.
3. Reference a deleted chat. **Expect**: a clear "cannot find that chat" notice; the request continues without cross-chat context; no substitute used.
4. Across the run, confirm **0** automatic cross-chat injections when not explicitly requested, and that no unrestricted all-chat search exists.

### V8 — Offline voice (US8 / SC-012)
1. Put the device in airplane mode. Enable voice (first-time: storage disclosure + mic permission + local download/verify).
2. Record a spoken request. **Expect**: an editable transcript appears in the draft; nothing auto-submits.
3. Edit the text, submit. **Expect**: handled by the same pipeline as typed input.
4. Start recording while a generation/compaction/embedding op is active. **Expect**: blocked with a clear status (one protected operation at a time); cancellation/failure leaves the draft intact.

### V9 — Offline guarantee (SC-015)
- Automated: the offline architecture guard (in `npm test`) fails on any networking import/call in the protected modules.
- Manual (final): with the device in airplane mode, run V1–V8. **Expect**: zero network calls in persistence, retrieval, embedding, compaction, voice, vision, or answer-generation paths.

## Evaluation baseline (FR-047 / FR-048 / FR-049)
Before implementation, record baseline short-chat and image-answer quality plus long-thread/latency/memory cases and a manual scoring rubric in `src/evaluation/baselines/`, so V4/V5/V6 can assert no regression (SC-004) and measurable long-chat improvement (SC-006).

## Done = all focused suites green (incl. offline guard + consolidated deletion) + V1–V9 pass on a physical 6–8GB device.
