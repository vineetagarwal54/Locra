# AGENTS.md — Locra

Shared conventions for all AI coding agents (Claude Code, Codex, Copilot).
This file is the single source of truth for agent behavior. CLAUDE.md points here.

---

## Project identity

**Locra** — on-device vision AI for Android. A quantized vision-language model runs
entirely on the device. No network calls are made during inference. No image or prompt
data is ever sent to a server. This constraint is architectural, not a setting.

---

## Non-negotiables (never violate these)

1. **Zero network in the inference path.** capture → preprocess → model → answer → persist
   must make no network calls. If a task seems to require one, stop and ask.

2. **Single-flight inference queue.** Only one inference may run at a time. The queue lock
   is acquired before preprocessing begins and released only after the result is persisted
   or an error or cancel is fully handled. Never bypass the queue.

3. **Graceful degradation, never crash.** Unsupported device, missing model, OOM, cancel —
   all must produce a clean UI state. A crash is always a bug.

4. **Memory safety on constrained hardware.** Image preprocessing enforces a hard 512x512
   ceiling. Device compatibility is checked before model load, not after.

5. **Minimal readable TypeScript over feature-rich.** Strict mode throughout.
   No any, no ts-ignore without explanation and a TODO.

6. **TDD for core systems.** Every function in inference pipeline and model lifecycle
   must have unit tests. Write the test before the implementation.

7. **New Architecture only.** No library that disables it.

8. **Single local store.** MMKV for all persistence in Phase 1. No AsyncStorage. No SQLite.

9. **Verify before assuming.** ExecuTorch API details change frequently. Always verify
   against current docs before implementing. Never assume.

10. **Hard architecture boundaries.** Screens contain no business logic. Inference has
    no UI imports. Model lifecycle is self-contained.

---

## Design system

The authoritative design sources are `design/design.md`, `design/motion.md`,
`design/screen_map.md`, and the approved references under
`design/references/`. Follow them instead of inventing a parallel design
system — do not restate their tokens, colors, or timings here or anywhere
else in code comments.

- The centralized runtime theme module (`src/constants/theme.ts`)
  implements the approved tokens — it does not originate them. It MUST be
  derived from and stay consistent with `design/design.md`.
- Screens/components MUST consume the centralized theme tokens and shared
  components, not hardcode competing colors, spacing, typography, radius,
  or visual patterns.
- If the runtime theme or existing implementation conflicts with
  `design/`, `design/` wins — update the theme module/components to
  match. Old styling (including prior dark/purple styling) already
  present in `theme.ts` or existing screens has no authority just because
  it predates the current design sources.
- Do not redesign an existing screen as a side effect of unrelated work.
  A feature explicitly scoped to implement the approved design system may
  update existing screens and shared theme tokens.
- New screens/components extend the tokens, components, interaction
  patterns, navigation model, and motion language already defined in
  `design/`, not competing ones.
- Accessibility, responsive layout, keyboard-safe layouts, reduced-motion
  support, and minimum touch targets from the design system are product
  requirements.
- Motion stays lightweight and never competes with model loading, image
  processing, inference, streaming, or local speech processing.
- Never expose hidden inference stages, internal prompts, intermediate
  perception output, raw model identifiers, or developer diagnostics in
  product UI unless a spec explicitly requires it.
- If `design/` conflicts with older styling guidance in a spec, `design/`
  wins for visual presentation; functional requirements in specs still
  stand unless a newer spec supersedes them.

---

## Build strategy (permanent)

- Local Windows builds are blocked by NDK 26 vs 27 conflict between
  executorch prebuilt OpenCV and reanimated C++20 requirements.
- Production and development APK builds via EAS Build (Expo Linux CI).
- Local dev server: npx expo start --dev-client --clear with USB.
- adb reverse tcp:8081 tcp:8081 required for USB connection.
- Do NOT attempt npx expo run:android or npx expo prebuild locally.

---

## NDK compatibility rule

Before installing any new native dependency, verify it does not require NDK 27+.
Check the package's CMakeLists.txt and android/build.gradle for ndkVersion.
Run: findstr /r /s "ndkVersion" node_modules\<package>\android\*.gradle
If it requires NDK 27+, flag it before installing — it will break the build.

---

## Code style

- Named functions, not anonymous arrow functions at module level.
- Explicit return types on all public functions.
- No default exports except React Native screen components.
- File names: PascalCase.tsx for components/screens, camelCase.ts for utilities.
- No barrel index.ts files unless 5+ exports from a directory.

---

## Architecture boundaries (Phase 1)
src/screens/     → UI only. No business logic. Calls hooks, reads stores.
src/inference/   → Inference pipeline. No UI imports. No network.
src/model/       → Model lifecycle. Download, validate, load, delete.
src/store/       → Zustand stores. No side effects in store definitions.
src/components/  → Shared UI components. Stateless where possible.
src/constants/   → theme.ts and other constants. No logic.

Cross-boundary rules:
- Screens import from store/ and components/. Not from inference/ directly.
- inference/ may import from model/ for model loading. Not from screens/.
- model/ is self-contained. No imports from inference/ or screens/.
- useInferenceEngine.ts is the ONLY file that may import useLLM.

---

## Task execution rules

- Read the relevant spec before writing any code: specs/001-camera-vlm-qa/
- Check tasks.md for the current task before starting. Do not jump ahead.
- One task at a time. Complete, test, and commit before starting the next.
- Commit format: type(scope): short description
- Do not modify specs/ unless explicitly asked.

---

## Testing

- Jest + React Native Testing Library. Co-locate as *.test.ts(x).
- Every function in src/inference/ and src/model/ must have unit tests.
- Run tests before marking a task complete: npm test.
- Run npx tsc --noEmit and npx eslint src tests --ext .ts,.tsx before committing.

---

## Spec Kit integration

This repo uses Spec Kit for spec-driven development.
Claude Code commands: /speckit.constitution, /speckit.specify, /speckit.plan,
/speckit.tasks, /speckit.implement, /speckit.converge.
Constitution: .specify/memory/constitution.md
Current phase: Phase 1 — specs/001-camera-vlm-qa/