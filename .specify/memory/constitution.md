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

------------------------------------------------------------------------------

Version change: 1.0.0 → 1.1.0

Modified principles: N/A (no existing principle redefined)

Added sections:
  - Technology Constraints: pinned NDK version (26.3.11579264) recorded as a
    project-wide constraint, discovered during Phase 1 setup (T001–T006) when
    `react-native-executorch`'s prebuilt native libraries and React Native's
    own Fabric headers were found to require conflicting NDK major versions
    (26 vs. 27) — see `specs/001-camera-vlm-qa/research.md` "Phase 1 Setup
    Findings" for the full investigation.
  - Development Workflow: new mandatory pre-install check — before adding any
    native dependency (any package with an `android/` directory containing a
    `CMakeLists.txt` or native `build.gradle`), verify it does not hard-require
    NDK 27+ by inspecting that file, since this project is permanently pinned
    to NDK 26.3.11579264 for local/EAS builds to succeed at all.

Rationale for MINOR bump (not MAJOR): no existing principle was redefined or
removed; this is materially expanded guidance (a new, concrete build
constraint plus a corresponding workflow gate) rather than a backward-
incompatible change to prior principles.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — no structural change needed; the
    Technical Context / Build Strategy sections in an individual feature's
    plan.md are where the concrete NDK pin gets restated per-feature.
  - ✅ .specify/templates/tasks-template.md — no structural change needed;
    task authors adding a native-dependency-install task should reference the
    new Development Workflow bullet when scoping that task's acceptance
    criteria.

Follow-up TODOs: none new.

------------------------------------------------------------------------------

Version change: 1.1.0 → 1.2.0

Modified principles: N/A (no existing principle redefined)

Added sections:
  - Core Principle XI (Single Theme Source): all color, spacing, radius, and
    typography-scale values MUST be imported from `src/constants/theme.ts`; no
    hardcoded hex values or magic numbers in `StyleSheet.create()`. Codifies the
    already-present `src/constants/theme.ts` (current accent `#7C5CFC`, electric
    violet) as the single, propagating source of design tokens.
  - Development Workflow: Constitution Check gate now evaluates against all
    ELEVEN principles; code-review checklist gains a design-token check (no
    hardcoded colors/magic numbers in StyleSheet, every screen/component
    references `theme.*` only).

Rationale for MINOR bump (not MAJOR): a new principle is added; no existing
principle is redefined or removed. Principle XI is a MUST-level discipline but
is NOT added to the NON-NEGOTIABLE blocking set (I, II, VI, VII), which is
reserved for app-safety-critical guarantees.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gate is generic
    ("[Gates determined based on constitution file]") and defers to this file;
    future /speckit-plan runs must enumerate all eleven principles in that gate.
  - ✅ .specify/templates/spec-template.md — no constitution-specific references;
    compatible as-is.
  - ✅ .specify/templates/tasks-template.md — no constitution-specific references;
    compatible as-is. Screen/component tasks must reference `theme.*` per XI.

Follow-up TODOs: none new.

------------------------------------------------------------------------------

Version change: 1.2.0 → 2.0.0

Modified principles:
  - XI. Single Theme Source → XI. Design Source of Truth (principle
    redefined, not merely extended: hardcoded design-token enforcement
    against `src/constants/theme.ts` is replaced by a pointer-based rule
    directing all UI work to `design/design.md`, `design/motion.md`,
    `design/screen_map.md`, and `design/references/`).

Added sections: none new (principle XI replaced in place; principle count
remains eleven).

Removed sections:
  - Prior wording of Principle XI (hardcoded accent `#7C5CFC`, canvas
    `#0f0f0f`, spacing/radius scale requirements) is superseded by the
    design folder; those concrete values now live in `design/design.md`
    and are no longer duplicated in the constitution.

Rationale for MAJOR bump (not MINOR): Principle XI is redefined, not
additively extended — the compliance bar for "what UI code must reference"
changes from `theme.ts` to the `design/` folder, and code-review criteria
tied to the old wording (no hardcoded colors/magic numbers in
`StyleSheet.create()`, `theme.*`-only references) no longer apply as
stated. This is a backward-incompatible principle redefinition per the
versioning policy in Governance.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gate is
    generic and defers to this file; no structural edit required, but
    future /speckit-plan runs must enumerate all eleven principles under
    their current definitions, including the new Design Source of Truth
    wording.
  - ✅ .specify/templates/spec-template.md — no constitution-specific
    references; compatible as-is.
  - ✅ .specify/templates/tasks-template.md — no constitution-specific
    references; compatible as-is.
  - ✅ AGENTS.md — "Design system" section (previously listing hardcoded
    hex values and a spacing/radius scale) rewritten to point at
    `design/design.md`, `design/motion.md`, `design/screen_map.md`, and
    `design/references/` instead of restating token values.
  - ⚠ CLAUDE.md — still does not exist in the repository; AGENTS.md states
    "CLAUDE.md points here," so there is no separate file to update, but
    this gap is carried forward from the 1.0.0 report and remains
    unresolved.

Follow-up TODOs:
  - TODO(RUNTIME_GUIDANCE_FILES): CLAUDE.md still does not exist; carried
    forward unresolved from the 1.0.0 report.

------------------------------------------------------------------------------

Version change: 2.0.0 → 2.1.0

Modified principles:
  - XI. Design Source of Truth (clarified, not redefined: the design
    folder remains the sole authoritative source of visual/interaction
    decisions; this amendment adds an explicit relationship between that
    authority and a centralized runtime theme module such as
    `src/constants/theme.ts`, a conflict-resolution rule when the runtime
    diverges from `design/`, an explicit statement that pre-existing
    theme/screen styling has no grandfathered authority, and a narrow
    exception allowing a feature explicitly scoped to implement the
    approved design system to update existing screens and shared theme
    tokens).

Added sections: none new (Principle XI amended in place; principle count
remains eleven).

Removed sections: none.

Rationale for MINOR bump (not MAJOR, not PATCH): the core rule from
v2.0.0 — the `design/` folder is the sole design authority and UI code
must not invent a parallel design system — is unchanged and not
redefined, so this is not backward-incompatible. The amendment is more
than a wording/typo fix: it adds materially new, testable guidance (the
theme-module-as-implementation-detail rule, the conflict-resolution
direction, the no-grandfathering rule for old styling, and the
design-scoped-feature exception to the no-redesign rule), so PATCH does
not fit either. MINOR — materially expanded guidance on an existing
principle — is the correct classification.

Templates requiring updates:
  - ✅ .specify/templates/plan-template.md — Constitution Check gate is
    generic and defers to this file; no structural edit required, but
    future /speckit-plan runs must evaluate Principle XI under its
    current wording, including the theme-module/design-folder
    relationship.
  - ✅ .specify/templates/spec-template.md — no constitution-specific
    references; compatible as-is.
  - ✅ .specify/templates/tasks-template.md — no constitution-specific
    references; compatible as-is.
  - ✅ AGENTS.md — "Design system" section updated to state that a
    centralized runtime theme module implements (but does not originate)
    the design sources, that the design folder wins on conflict, and that
    pre-existing theme/screen styling is not grandfathered in.
  - ⚠ CLAUDE.md — still does not exist in the repository; carried forward
    unresolved from prior reports.

Follow-up TODOs:
  - TODO(RUNTIME_GUIDANCE_FILES): CLAUDE.md still does not exist; carried
    forward unresolved from the 1.0.0 report.
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

### XI. Design Source of Truth

The authoritative product design sources are `design/design.md`,
`design/motion.md`, `design/screen_map.md`, and the approved visual
references under `design/references/`. These sources define the
authoritative visual and interaction decisions for the app; UI
implementation MUST follow them instead of inventing a parallel design
system, and the constitution does not restate their tokens, layouts, or
timings.

Runtime implementation MAY represent the approved design tokens in a
centralized, code-level theme module (e.g. `src/constants/theme.ts`).
That module is an implementation representation of the design system, not
an independent design authority: it MUST be derived from and remain
consistent with `design/design.md`, and MUST NOT introduce colors,
spacing, typography, radii, or other visual values that do not trace back
to the design sources. Screens and components MUST consume the
centralized runtime design tokens and shared components rather than
independently hardcoding competing colors, spacing, typography, radius,
or other visual patterns.

When the runtime theme module or existing implementation conflicts with
the current `design/` folder, the design folder is authoritative and the
runtime theme module and/or affected components MUST be updated to match
it. Styling that already exists in the runtime theme module or in
existing screens — including prior dark/purple styling — carries no
authority merely because it predates the current design sources; it MUST
be brought into conformance when touched under a design-scoped feature.

Existing screens MUST NOT be redesigned during unrelated feature work. A
feature explicitly scoped to implement the approved design system MAY
update existing screens and the shared runtime theme tokens according to
the design sources. New screens and components MUST extend the
established tokens, reusable components, interaction patterns, navigation
model, and motion language already defined in the design sources, not
introduce competing ones. Accessibility, responsive behavior,
keyboard-safe layouts, reduced-motion support, and minimum touch targets
defined by the design system are product requirements, not optional
polish.

Motion MUST remain lightweight and MUST NOT compete with local model
loading, image processing, inference, streaming, or local speech
processing for device resources. Product UI MUST NOT expose hidden
inference stages, internal prompts, intermediate perception output, raw
model identifiers, or developer diagnostics, unless a future
specification explicitly requires them.

When design documents conflict with older styling guidance in earlier
specifications, the current `design/` folder is authoritative for visual
presentation. Functional requirements from existing specifications remain
authoritative unless explicitly superseded by a new feature specification.

**Rationale**: A single, versioned design source keeps the UI coherent as
the app grows past Phase 1, prevents each feature from drifting into its
own visual language, and keeps design changes auditable — without
hardcoding specific colors or tokens into the constitution itself, which
would go stale the moment the design system evolves. Allowing a
centralized runtime theme module to implement — but never originate —
design decisions gives engineering a single code-level place to consume
tokens without turning that module into a second, competing design
authority; the module must track `design/design.md`, not drift from it.

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
- The Android NDK version is pinned project-wide to **26.3.11579264**.
  `react-native-executorch`'s prebuilt native libraries require NDK 26's
  libc++ ABI and fail to link under NDK 27; conversely, NDK 26's libc++
  cannot compile some C++20 features present in React Native's own core
  Fabric headers and in other native dependencies without a patch. This is
  a real, load-bearing constraint discovered by direct build investigation
  (`specs/001-camera-vlm-qa/research.md`, "Phase 1 Setup Findings"), not an
  arbitrary preference — do not bump this version to resolve an unrelated
  build issue without re-verifying both sides of this conflict.

## Development Workflow

- Every `/speckit-plan` Constitution Check gate MUST evaluate the feature
  against all eleven principles above before Phase 0 research begins, and again
  after Phase 1 design.
- A violation of a NON-NEGOTIABLE principle (I, II, VI, VII) blocks the plan;
  it MUST be redesigned, not justified away in Complexity Tracking.
- Violations of the remaining principles MAY be justified in Complexity
  Tracking, but only with a concrete reason the simpler, compliant
  alternative is insufficient.
- Code review MUST confirm: no network calls were added to the inference
  path, the single-flight lock is respected end-to-end, tests precede
  implementation for inference/model-lifecycle code, the architecture
  boundaries in Principle X are intact, and any UI change conforms to the
  design sources in `design/` rather than inventing new tokens, components,
  or visual patterns ad hoc. Code review MUST also confirm that the
  centralized runtime theme module (e.g. `src/constants/theme.ts`)
  implements, and does not diverge from, `design/design.md`; that screens
  and components consume the centralized runtime tokens and shared
  components rather than hardcoding competing colors, spacing, typography,
  radius, or visual patterns; and that the change does not redesign an
  existing screen as a side effect of unrelated feature work unless the
  feature is explicitly scoped to implement the approved design system
  (Principle XI).
- Before installing any new native dependency (any package whose `android/`
  directory contains a `CMakeLists.txt` or its own native `build.gradle`),
  verify it does not hard-require NDK 27+ by inspecting those files for an
  explicit `ndkVersion` or NDK-version-gated build logic. This project is
  pinned to NDK 26.3.11579264 (see Technology Constraints); a dependency
  that only works on NDK 27+ will break the existing build the same way
  `react-native-executorch` broke under NDK 27, and this MUST be caught
  before the dependency is added, not after a failed build.

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

**Version**: 2.1.0 | **Ratified**: 2026-07-03 | **Last Amended**: 2026-07-09
