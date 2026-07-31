# Spec 007 manual validation checklist

This worksheet covers the physical-device work intentionally left unchecked in
`tasks.md`. Record the device, Android version, build identifier, model artifact,
and date before starting. For each item, capture the visible result and the
diagnostics export where applicable. Do not mark the corresponding task complete
until every required result has been observed on hardware.

## Final hardening replay — one fresh chat

Build/install with `npm run android:diagnostic`, then start Metro with
`npm run start:diagnostic`. Before testing, export one turn and confirm
`appInfo.gitCommitSha`, `gitBranch`, `workingTreeState`, `buildIdentifier`,
`appBuildId`, `inferenceRuntimeVersion = llama.rn@0.12.5`, `deviceNameModel`,
and memory fields are populated. A dirty build
is acceptable only when its exported `workingTreeState` is `dirty`; `unknown`
provenance is not acceptable for a recorded replay. `thermalState` may be null
because the linked React Native device API does not expose Android thermal
status.

Use one new conversation for all ten cases. Save the diagnostics export after
each numbered case. In every new-authority case require
`architectureDiagnostics.planOwner = turn-planner:v1`,
`legacySemanticDecisionCount = 0`, one `executedPlanId` across every executed
stage, and no per-subsystem fallback owner.

1. [ ] **New fruit/vegetable image — general description**
   - Input: attach a clear fruit/vegetable image and ask for a general description.
   - Expected references/vision: the new durable image ID only;
     `inspect-and-structure`; original pixels inspected.
   - Expected evidence/grounding: validated evidence is persisted; exactly one
     assistant response; claims are limited to the selected image.
   - Expected ledger: `conversationFocusBefore.activeImageIds` is empty and
     `conversationFocusAfter.activeImageIds` contains the new image ID.
   - Inspect: plan/owner, selected image ID, per-image action/status/sufficiency,
     `extractionSchemaMode = native-json-schema`, schema version, extraction
     attempt limits/token count, visible token count, first-visible-token and
     total latency, validation/persistence outcomes, memory/thermal fields.

2. [ ] **OCR or price follow-up — same image**
   - Input: ask for exact visible text or a price from the same image.
   - Expected references/vision: active image ID from the ledger only; reuse
     evidence if the matching OCR/price field is sufficient, otherwise
     `inspect-and-structure` of that same original.
   - Expected evidence/grounding: one response; no object label may be treated as
     OCR and no other image may be substituted.
   - Expected ledger: active image remains unchanged; explicit-reference IDs
     update only when the prompt explicitly names/ordinals the image.
   - Inspect: before/after focus, resolution code, selected image ID, sufficiency
     reason, reuse versus pixel action, extraction/persistence fields and counts.

3. [ ] **Fine detail — forced reinspection**
   - Input: ask for a precise color, shape, location, damage, or other detail not
     present in stored evidence.
   - Expected references/vision: same active image; stored evidence marked
     insufficient; original pixels reinspected without replanning.
   - Expected evidence/grounding: one response; uncertainty/failure is explicit
     if the detail remains unsupported.
   - Expected ledger: active image identity remains unchanged.
   - Inspect: `sufficiencyResult = insufficient`, bounded reason,
     `action = pixel-inspection`, schema mode/version, separate token/timing
     fields, validation and persistence outcome.

4. [ ] **Two new images — comparison**
   - Input: add two images in separate turns, then ask to compare them.
   - Expected references/vision: exactly the ordered two-image ledger pair;
     `compare-evidence`; sufficient sides reused and at most the exact
     insufficient selected side reinspected.
   - Expected evidence/grounding: one response; comparison provenance remains
     separate by side/image/source/evidence ID. If a side is unavailable, name
     that side and do not substitute.
   - Expected ledger: completed comparison publishes the ordered active pair.
   - Inspect: plan ID/owner, both selected IDs, both per-image diagnostics,
     comparison provenance, missing IDs/failure reason, before/after focus.

5. [ ] **First, previous, latest, and `fiest`**
   - Input: issue four turns that refer to the first, previous, latest, and
     misspelled `fiest` image.
   - Expected references/vision: first/previous/latest resolve deterministically
     to their exact IDs and inspect/reuse only those IDs. The explicitly
     enumerated deterministic typo alias `fiest` resolves to the first image; it
     is not a broad semantic-regex match.
   - Expected evidence/grounding: one response per input and no image
     substitution.
   - Expected ledger: each successful exact reference becomes active; the
     `fiest` publishes the first image as active.
   - Inspect: resolution code/candidates, selected IDs, strategy, per-image
     sufficiency/action, fallback, response count, focus transition.

6. [ ] **“it” and “that”**
   - Input: ask two unambiguous follow-ups using “it” and “that.”
   - Expected references/vision: active single image or active pair comes only
     from `conversationFocusBefore`; strategy follows evidence sufficiency.
   - Expected evidence/grounding: one response; clarification instead of legacy
     fallback if more than one target is materially plausible.
   - Expected ledger: resolved focus is preserved; unresolved ambiguity does not
     replace it.
   - Inspect: before-focus IDs, resolved/candidate IDs, plan owner/ID, strategy,
     sufficiency/action, and zero legacy decisions.

7. [ ] **Difficult/dark image — extraction failure and repeat reference**
   - Input: attach a difficult/dark image, trigger structured extraction failure,
     then ask about that image again.
   - Expected references/vision: first turn inspects that image and returns one
     controlled uncertainty/failure; the next turn resolves the same stable image
     ID and may reinspect its original pixels. No text-only vision fallback.
   - Expected evidence/grounding: malformed/truncated evidence is not persisted;
     one response per turn; no previous guess/refusal becomes evidence.
   - Expected ledger: the image identity may remain active after the controlled
     completed response, but evidence and identity remain separate.
   - Inspect: extraction attempt limits/count, schema mode/version,
     `evidenceValidationOutcome = invalid`, persistence `not-attempted`, per-image
     validity/failure reason, same selected ID on the repeat turn.

8. [ ] **Code follow-up**
   - Input: obtain generated code, then ask “the code you gave” and “explain each
     line.”
   - Expected references/vision: active assistant/code artifact message ID from
     the ledger; vision strategy `none`.
   - Expected evidence/grounding: one response per input; explanation is grounded
     in the selected canonical code message, not retrieval/image evidence.
   - Expected ledger: code/document artifact and assistant focus remain active
     across both follow-ups.
   - Inspect: before/after active assistant/artifact, resolved message ID,
     required context source ID, no selected image IDs, owner/plan ID.

9. [ ] **Cancellation — hidden processing and visible generation**
   - Input: cancel separate turns during preprocessing, extraction formatting,
     extraction tokenization, extraction prefill, hidden generation, visible
     prefill, and visible generation.
   - Expected references/vision: original validated plan remains recorded; no
     fallback plan or second response is created.
   - Expected evidence/grounding: hidden-stage cancels create no completed visible
     answer; visible-generation cancel preserves at most the single partial
     assistant attempt; unvalidated evidence is not persisted.
   - Expected ledger: `conversationFocusAfter` equals before for every cancelled
     attempt.
   - Inspect: exact `cancellationStage`, active/last-completed stages, separate
     extraction/visible token counts, first-visible latency null before the first
     visible token, persistence `not-attempted`, one attempt/response maximum,
     resource release and next-turn readiness.

10. [ ] **Restart — active image and code follow-ups**
    - Input: force-stop/restart, reopen the same chat, repeat one active-image
      follow-up and one “the code you gave” follow-up.
    - Expected references/vision: ledger is loaded or deterministically rebuilt
      from canonical history before planning; exact prior image/code IDs resolve.
    - Expected evidence/grounding: image evidence is reused only if sufficient,
      otherwise that image is reinspected; code uses canonical code context; one
      response per turn.
    - Expected ledger: rebuilt before-focus matches pre-restart canonical focus
      and publishes only after each successful turn.
    - Inspect: focus schema/hash/rebuild status, before/after IDs, selected plan
      ID/owner, selected image/message IDs, evidence action, response count,
      provenance/build fields, memory/thermal/total latency.

## Native stop behavior (T034)

- [ ] Start a response long enough to stream for several seconds.
- [ ] Cancel it during streaming.
- [ ] Confirm the linked `llama.rn` `stopCompletion()` call stops generation.
- [ ] Confirm already-streamed text remains visible and persisted.
- [ ] Confirm the inference queue releases and the next request runs normally.
- [ ] Trigger loop stopping near a user cancellation and confirm exactly one
  native stop, no double completion, no erroneous cancellation verdict, and no
  queue state left in `cancelling`.
- [ ] Record the device result before changing or approving any stopping threshold.

## Routing and image continuity (MV-001–MV-010, MV-012)

- [ ] **MV-001:** Ask a standalone factual question inside a chat containing
  unrelated turns, facts, a summary, and an image. Confirm diagnostics select no
  unrelated context.
- [ ] **MV-002:** Ask genuine dependent follow-ups such as “What about that?” and
  confirm only the turns needed to resolve the reference are selected.
- [ ] **MV-003:** In a summarized long chat, recover a relevant earlier fact, then
  ask an unrelated standalone question and confirm the old topic is absent.
- [ ] **MV-004:** Attach a new image, ask about it, and confirm visual evidence is
  recorded and the image becomes active.
- [ ] **MV-005:** Ask a non-pixel-dependent follow-up about the active image and
  confirm stored evidence is reused; then ask a non-visual question and confirm no
  image evidence is attached.
- [ ] **MV-006:** Ask OCR, count, and price questions about the active image.
  Confirm each required fresh vision inference uses the original local image and
  evidence remains linked to that image without duplicate active retrieval noise.
- [ ] **MV-007:** With at least two images, reference an older image by ordinal and
  by a unique description. Confirm the intended older image is selected.
- [ ] **MV-008:** With two plausible images, then with three plausible images, use
  a generic reference. Confirm `unresolved-reference`/clarification is recorded,
  no image/evidence is selected, and no visual claim is made until resolution.
  Then unambiguously refer to the active visual entity and confirm `active-image`
  is allowed only in that non-ambiguous case.
- [ ] **MV-009:** Remove an original image file. Confirm a pixel-dependent question
  reports `original-unavailable`, while a non-pixel question may reuse sufficient
  stored evidence.
- [ ] **MV-010:** Immediately after an image turn, ask an unrelated standalone
  question and confirm image evidence is neither queried nor selected.
- [ ] After an image turn, ask `What is the cost of tuition?`, `Count the possible
  combinations.`, `What color should my website use?`, and `What is the total
  population?`; confirm all remain text-only and never re-run the image.
- [ ] Confirm `Read the number in the image`, `How many objects are visible?`,
  `What price is on the receipt?`, and `What color is the chair in the first
  photo?` take the appropriate visual route.
- [ ] **MV-012:** Submit identical text once by typing and once through voice
  transcription. Confirm classification and context diagnostics match.

## Generation, retrieval, and persistence (MV-011, MV-013–MV-016)

- [ ] **MV-011:** Exercise a loop-prone prompt, a short factual request, and a
  genuinely detailed request. Confirm early loop stopping, concise short answers,
  and sufficient detail respectively. Across Low/Medium/High, confirm normal
  visible prose uses hard limits 320/640/1024 even when its soft target is lower.
  Reject any hard-cap ending that stops mid-sentence, mid-list, or in an
  incomplete bullet. Continue a genuine `length` result and confirm the
  continuation has full mode headroom and does not repeat displayed text.
- [ ] **MV-013:** The production embedding artifact is still separately gated.
  Until it is approved, confirm lexical fallback works and no semantic-runtime
  claim is made and all submissions make zero embedding calls. After separate
  approval, verify only plans with eligible semantic candidates call the
  provider; an “independent” label alone neither forces nor forbids that call.
  Verify same-chat/cross-chat gates, fused exact-plus-semantic retrieval, and
  failure/stale/backfill lexical fallback.
- [ ] **MV-014:** Confirm cross-chat memory is off by default. Enable it and verify
  explicit memory-seeking retrieval from both a new chat and a short chat;
  ordinary independent questions remain same-chat-only. Verify attributed local
  retrieval, bilateral current/source exclusions, then disable globally and
  confirm the very next turn makes no cross-chat query.
- [ ] **MV-015:** Cancel and restart the app. Confirm partial text behavior, the
  cross-chat setting, per-chat exclusions, and deterministic routing survive as
  specified.
- [ ] **MV-016:** Exercise Low, Medium, and High response modes near the model
  context limit. Confirm diagnostics' used/maximum token units agree with the
  estimated and final native prompt counts, protected current/referenced-image
  evidence is retained, and `usedUnits` never exceeds `maximumUnits`. Include
  token-dense code and non-English input; confirm any shortened question preserves
  its beginning, end, visible marker, and image.
  Confirm `effectiveNativeGenerationLimit` equals native `n_predict` and is not
  confused with either the soft target or response-mode maximum.

- [ ] Re-run an explicit same-chat and cross-chat memory question with exact
  values. Confirm retrieved text is used as factual conversation data while any
  instruction quoted inside it is ignored.
- [ ] Compare two explicitly referenced prior images. Confirm both labeled
  evidence blocks reach the answer prompt, provenance stays separate, and a
  missing side is identified specifically rather than claiming both images were
  absent.

- [ ] Query first-position and multi-word names (`Accenture spending`,
  `Microsoft revenue`, `Vineet apartment address`, `Graduate Hills rent`) plus an
  ID, price, and date; confirm exact lexical matches survive fusion. Confirm
  generic openers such as `Find`, `Show`, and `Explain` are not protected alone.

## Grounding diagnostics (optional Phase 8)

- [ ] Ask one answerable and one deliberately unsupported image/retrieval question.
  Confirm `supported`/`unsupported` appears only in developer diagnostics and does
  not alter the visible response. Repeat for a new image, active-image OCR
  re-inference, and older-image re-inference so fresh hidden evidence is exercised.

## Offline and regression validation (MV-017–MV-018)

- [ ] **MV-017 / T053:** Enable airplane mode and exercise classification, image
  re-inference, budgeting, lexical/fused retrieval as available, cross-chat scope,
  and generation controls. Confirm no network request occurs.
- [ ] **MV-018 / T054:** Run the Spec 006 physical-device regression: text chat,
  image chat, voice capture/transcription, History pagination/search, model
  download and verification where the fixture permits, cancellation,
  checkpoint/recovery, durable images, and offline operation.
- [ ] **T055:** Execute every phase in `quickstart.md` end to end and record all
  deviations plus a before/after comparison against the T001 baseline fixtures.

## Architecture revision golden matrix (Waves A–E)

Record both the legacy result and shadow/authoritative `TurnPlan`, including
field confidence, source provenance, selected retrieval units, image IDs,
provider/index descriptors, fallback, and execution result. Do not mark any new
task complete from a desktop/mock result when the task requires physical
hardware.

For every golden scenario below, confirm diagnostics record one authority mode,
one exact plan owner, and `constrainedPlanner.invoked: false`.

For Wave A, these are deterministic planning fixtures with injected/mocked
ledger state, active entities, image-reference candidates, explicit-memory
candidates, and lexical retrieval candidates. They validate the expected plan,
fallback, authority mode, and no Tier-3 invocation only. They do not claim
end-to-end vision, ledger persistence, explicit-memory persistence, or semantic
retrieval execution; those claims belong to Waves B, C, and D.

### GV-001 — Text dependency

- [ ] Ask for recursive and iterative implementations of the same algorithm.
- [ ] Ask “Which one is better?”
- [ ] Ask “Which of the two should I use in an interview?”
- [ ] Confirm both code entities remain distinct comparison targets in the
  ledger and the final plan selects only their relevant messages/code blocks.
- [ ] Confirm no regex phrase is the sole reason for dependency resolution.

### GV-002 — Immediate explicit memory

- [ ] Tell Locra to remember a specific apartment rent.
- [ ] Immediately inspect diagnostics/storage and confirm an explicit-memory
  unit with user-source provenance is available before compaction or indexing.
- [ ] Ask unrelated questions.
- [ ] Ask for the rent without “remember,” “earlier,” or “mentioned.”
- [ ] Confirm direct/lexical recall works while semantic indexing is paused,
  stale, or disabled.

### GV-003 — Image continuity and associations

- [ ] Upload a market image and ask which products are visible.
- [ ] Confirm a stable image entity and reusable structured evidence are
  persisted even if the visible answer used direct image generation.
- [ ] Ask “What are their prices?”
- [ ] Ask which price belongs to one named product.
- [ ] Confirm object, text, numeric value, and price-to-object associations retain
  the same source image ID and uncertainty.

### GV-004 — Image reinspection after false refusal

- [ ] Produce or inject a false image-unavailable/refusal-like assistant attempt.
- [ ] Ask Locra to inspect the image again.
- [ ] Confirm the plan uses the canonical original image entity, not the refusal
  as evidence.
- [ ] Confirm the prior refusal is low-trust/ineligible for factual grounding and
  the original asset remains active when available.

### GV-005 — Multi-image comparison

- [ ] Upload two images in separate turns and ask for a comparison.
- [ ] Confirm the plan names both image IDs and selects `compare-evidence`.
- [ ] Confirm evidence blocks, objects, uncertainties, and provenance remain
  separate through final prompt assembly.
- [ ] Remove one asset and confirm the missing side is identified specifically;
  no substitution or merged “both unavailable” claim occurs.

### GV-006 — Retrieval negative

- [ ] Ask an unrelated self-contained question after text and image-heavy turns.
- [ ] Confirm zero irrelevant conversation/image sources are selected.
- [ ] Confirm the planner may evaluate eligible semantic/ledger signals and does
  not rely on a global “independent means never retrieve” switch.

### GV-007 — Main provider substitution

- [ ] Substitute a mocked compatible main inference provider.
- [ ] Confirm `TurnPlan`, ledger, memory, retrieval units, embedding index,
  evidence schemas, and persisted diagnostics remain unchanged.
- [ ] Confirm prompt token verification uses the substitute provider descriptor.
- [ ] Substitute a provider without image capability and confirm an image-required
  turn uses explicit fallback, never silent text-only generation.

### GV-008 — Embedding migration

- [ ] Build an active index, then change provider/version/dimensions or prompt
  policy.
- [ ] Confirm existing vectors become stale by descriptor, a new index version
  builds from restart-safe progress, validation precedes atomic activation, and
  the previous index is retired later.
- [ ] Confirm lexical retrieval remains available during build, pause,
  cancellation, restart, and failure.
- [ ] Confirm canonical messages/memories are unchanged and conversation deletion
  cascades to both old/new derived units and vectors.

### GV-009 — Explicit-memory write negatives and correction

- [ ] Ask “Do you remember my rent?” and confirm a memory read, not a write.
- [ ] Ask “Remember when we discussed graphs?” and confirm a memory read.
- [ ] Say “I remember that algorithm.” and confirm neither automatic read nor
  durable write.
- [ ] Correct a stored rent value. Confirm the new memory supersedes the old,
  both source provenances remain, and normal recall returns only the active value.

## Planner authority and semantic-decision audit

- [ ] In shadow mode, confirm legacy executes the complete turn and the shadow
  plan changes no context/image/memory/inference behavior.
- [ ] In controlled mode, confirm only an explicitly named class uses the new
  plan and every semantic consumer for that turn bypasses legacy routing. For a
  controlled image class, verify the plan owns reference resolution, image
  selection, context-source selection, context assembly, vision strategy,
  generation-task projection, and inference execution; record zero legacy
  semantic decisions for the complete turn.
- [ ] In authoritative mode, confirm legacy semantics are not consulted. Exercise
  rollback and confirm the entire turn—not individual subsystems—returns to
  legacy ownership.
- [ ] Confirm context orchestration, generation planning, vision execution,
  `InferenceQueue`, refusal recovery, and grounding all receive the same
  validated plan ID/version.
- [ ] Confirm none independently changes intent, modality, image target,
  dependency, retrieval scope, or memory operations.
- [ ] Confirm low confidence in intent does not remove an attachment, direct
  reference, explicit memory write, or required current input.
- [ ] Disable embeddings and confirm authoritative lexical-only topic/entity
  matching still uses ledger identities, canonical labels, known aliases, exact
  lexical matches, code identifiers, direct references, and active comparison
  state, without introducing semantic regex routing.
- [ ] Confirm ambiguous image references request clarification, select no
  image/evidence, and make no target-specific visual claim; the active image is
  never an ambiguity fallback.
- [ ] Confirm deterministic regex remains only for syntax/validation.

## Failure, restart, and immediately-following-turn matrix

- [ ] Complete a turn that establishes a comparison/image/entity/decision, then
  submit the next turn immediately. Confirm the new ledger state is already
  visible and is not one turn behind.
- [ ] Restart with missing, stale, incompatible, and corrupt ledger caches.
  Confirm rebuild from canonical data and no canonical-history mutation.
- [ ] Open an existing conversation with no ledger cache. Confirm it is not
  planned as a first turn.
- [ ] Simulate Tier-3 cancellation, 8-second timeout, malformed output, candidate
  injection, confidence below `0.80`, and app suspension. Confirm deterministic
  conservative fallback, resource release, and next-turn readiness.
- [ ] Force structured image-evidence extraction to return malformed/incomplete
  data. Confirm `partial`/`failed`, original-pixel reinspection availability, and
  no new visual fact from a text-only formatting retry.
- [ ] Delete one asset in a two-image comparison. Confirm the missing side is
  identified and not substituted. Retain older evidence and confirm it is marked
  `stale`, not freshly inspected.
- [ ] Freshly inspect pixels after a prior assistant refusal. Confirm the refusal
  is excluded as factual evidence.
- [ ] Interrupt background indexing with process death. Confirm restart-safe
  progress and uninterrupted lexical retrieval.
- [ ] Exclude a source conversation after creating an explicit memory. Confirm
  local recall still works there but the memory is absent from cross-chat.
- [ ] Force a false legacy independent classification for an exact memory/fact
  query. Confirm exact lexical recovery prevents the old hard skip.

## Final architecture physical validation

- [ ] Validate EmbeddingGemma 256- and 512-dimension benchmark results on the
  recorded 6–8GB device matrix before selecting production dimensions.
- [ ] Confirm background indexing pauses for visible inference and resumes after
  restart without corrupting the active index.
- [ ] Confirm golden scenarios never call constrained planning. For separately
  mocked ambiguous Tier-3 fixtures, confirm only unresolved fields are requested,
  the call is serial/single-flight, stays within 96 tokens/8 seconds, and
  cancellation/suspension releases the resource cleanly.
- [ ] Run the complete architecture in airplane mode and verify zero network
  calls across planning, embeddings, retrieval, memory, vision, generation,
  persistence, deletion, and migration.
- [ ] Re-run every historical open hardware task (T034, T052–T055, T058)
  independently; this new matrix does not close them by implication.
