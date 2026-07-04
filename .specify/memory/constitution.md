<!--
Sync Impact Report
==================
Version change: TEMPLATE → 1.0.0 (initial ratification)

Modified principles: N/A (first fill of template placeholders)

Added sections:
  - Core Principles I–X (Privacy-First Architecture, Single-Flight Inference Queue,
    Graceful Degradation Over Crashes, Memory Safety on Constrained Hardware,
    Minimal Readable TypeScript, TDD for Core Systems, New Architecture Only,
    Single Local Store, Verify Before Assuming, Hard Architecture Boundaries)
  - Technology Constraints
  - Development Workflow
  - Governance

Removed sections: none (template placeholders replaced, no prior ratified content existed)

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gate is generic
    ("[Gates determined based on constitution file]") and already defers to this
    file; no structural edit required, but future /speckit-plan runs must
    enumerate all ten principles in that gate.
  - ✅ .specify/templates/spec-template.md — no constitution-specific references;
    compatible as-is.
  - ✅ .specify/templates/tasks-template.md — no constitution-specific references;
    compatible as-is. TDD principle (VI) implies inference/model-lifecycle test
    tasks are not optional even though the template marks tests as optional
    generally — plan/tasks authors must apply this override manually.
  - ⚠ CLAUDE.md / AGENTS.md — referenced by README.md project structure and by
    the Governance section below as the runtime guidance files, but neither
    exists in the repository yet. Create them to carry day-to-day guidance
    derived from these principles.

Follow-up TODOs:
  - TODO(RUNTIME_GUIDANCE_FILES): CLAUDE.md and AGENTS.md do not yet exist;
    create them and link back to this constitution once written.
-->

# Locra Constitution

## Core Principles

### I. Privacy-First Architecture (NON-NEGOTIABLE)

The inference pipeline — capture, preprocess, model, answer, persist — MUST make
zero network calls. This is a structural property enforced by the absence of
network permission in the inference path, not a runtime setting that can be
toggled off. No code in the capture, preprocessing, model execution, answer
generation, or persistence stages may open a network socket, call a network
API, or depend on a library that does so, under any circumstances.

**Rationale**: Locra's entire value proposition is that images never leave the
device. A setting can be flipped or a flag forgotten; a permission that was
never granted cannot be silently re-enabled.

### II. Single-Flight Inference Queue (NON-NEGOTIABLE)

Only one inference may run at a time. The queue lock MUST be acquired before
preprocessing begins and MUST be released only after the result is persisted,
or an error or cancellation has been fully handled. No code path may invoke
the model while bypassing this queue.

**Rationale**: Overlapping inferences on 6–8GB devices risk OOM cascades that
take down the whole app; a single-flight lock is the only reliable guarantee
against concurrent model invocations.

### III. Graceful Degradation Over Crashes

An unsupported device, a missing model, an out-of-memory error, and a
mid-stream cancel MUST all produce a clean, user-legible UI state. A crash is
always a bug, regardless of the triggering condition. An error message that
does not tell the user what happened and what they can do next is also a bug.

**Rationale**: On-device ML on heterogeneous Android hardware fails in more
varied ways than server-side ML ever does; the app must fail predictably and
informatively every time.

### IV. Memory Safety on Constrained Hardware

Every decision made in the inference pipeline MUST account for devices with
6–8GB of RAM. Image preprocessing MUST enforce a hard ceiling of 512×512
before any tensor is created. Device compatibility (available memory,
architecture support) MUST be checked before model load is attempted, never
after.

**Rationale**: A quantized 1.6B VLM, image tensors, and the RN/JS runtime
together leave little headroom on mid-range devices; discovering
incompatibility after a load attempt is a crash waiting to happen.

### V. Minimal, Readable TypeScript

Prefer the solution expressible in fewer lines without losing clarity over a
more feature-rich implementation. Strict mode is enabled project-wide. `any`
is not permitted. `@ts-ignore` is permitted only when paired with an inline
comment explaining why it is necessary and a TODO to remove it.

**Rationale**: A small on-device pipeline maintained by a small team benefits
more from legibility than from abstraction; every escape hatch from the type
system is a place a defect can hide undetected.

### VI. Test-Driven Development for Core Systems (NON-NEGOTIABLE)

Every function in the inference pipeline and the model lifecycle MUST have a
unit test written before its implementation. Red-Green-Refactor is the
required cycle for this code; implementing before a failing test exists is
not permitted in these two areas.

**Rationale**: Bugs in the inference pipeline either crash the app or silently
corrupt output across a range of devices too wide to manually enumerate;
tests written first are the primary defense.

### VII. New Architecture Only

React Native's New Architecture MUST remain enabled at all times, because
React Native ExecuTorch requires it. No dependency that disables the New
Architecture, requires it be disabled, or is incompatible with it may be
introduced.

**Rationale**: ExecuTorch is a hard dependency for on-device inference;
anything that conflicts with it undermines the app's core function.

### VIII. Single Local Store

MMKV is the only persistence mechanism for Phase 1. AsyncStorage MUST NOT be
introduced. SQLite MUST NOT be introduced until Phase 2, and only if MMKV
proves insufficient at that time.

**Rationale**: One storage engine keeps the local-only architecture auditable
and avoids reconciling two sources of truth on a device that already has no
server to reconcile against.

### IX. Verify Before Assuming

React Native ExecuTorch's API surface and supported model constants change
frequently between releases. Implementation MUST verify current behavior
against upstream documentation before writing code against it. The newest
model checkpoint available upstream MUST NOT be assumed to be available in
the React Native ExecuTorch library without verification.

**Rationale**: Building against a remembered or assumed API is a common
source of silent breakage when the underlying dependency moves as fast as
ExecuTorch does.

### X. Hard Architecture Boundaries

Screens MUST contain no business logic. The inference module MUST NOT import
UI code. The model lifecycle module MUST be self-contained and MUST NOT reach
into screens, stores, or inference internals beyond its published interface.
Crossing one of these boundaries is a bug, not an acceptable shortcut.

**Rationale**: These boundaries are what keep the inference pipeline
independently testable and the UI safely replaceable; violating them under
time pressure compounds technical debt in the most safety-critical part of
the app.

## Technology Constraints

- React Native 0.76+ with the New Architecture enabled, targeting Android
  only (min API 26, target API 35).
- React Native ExecuTorch is the sole on-device inference runtime; model
  assets are quantized and loaded from local storage only.
- TypeScript strict mode is enabled repository-wide; see Principle V for the
  `any` / `@ts-ignore` policy.
- MMKV is the sole persistence layer for Phase 1 (Principle VIII).
- A physical Android device with 6GB+ RAM is required for meaningful
  inference testing; emulator results are not authoritative for latency or
  memory behavior.

## Development Workflow

- Every `/speckit-plan` Constitution Check gate MUST evaluate the feature
  against all ten principles above before Phase 0 research begins, and again
  after Phase 1 design.
- A violation of a NON-NEGOTIABLE principle (I, II, VI, VII) blocks the plan;
  it MUST be redesigned, not justified away in Complexity Tracking.
- Violations of the remaining principles MAY be justified in Complexity
  Tracking, but only with a concrete reason the simpler, compliant
  alternative is insufficient.
- Code review MUST confirm: no network calls were added to the inference
  path, the single-flight lock is respected end-to-end, tests precede
  implementation for inference/model-lifecycle code, and the architecture
  boundaries in Principle X are intact.

## Governance

This constitution supersedes all other project practices, style guides, and
prior informal conventions where they conflict. Amendments require: (1) a
documented rationale for the change, (2) a version bump per the policy below,
(3) propagation of the change into `.specify/templates/plan-template.md`,
`spec-template.md`, and `tasks-template.md` wherever those templates
reference affected principles, and (4) an update to the runtime guidance
files (`CLAUDE.md`, `AGENTS.md`) if agent-facing guidance is affected.

Versioning follows semantic versioning: MAJOR for backward-incompatible
principle removals or redefinitions, MINOR for new principles or materially
expanded guidance, PATCH for clarifications and wording fixes that do not
change enforcement.

All PRs and `/speckit-plan` runs MUST verify compliance with this
constitution via the Constitution Check gate. Use `CLAUDE.md` and
`AGENTS.md` for day-to-day runtime development guidance derived from these
principles.

**Version**: 1.0.0 | **Ratified**: 2026-07-03 | **Last Amended**: 2026-07-03
