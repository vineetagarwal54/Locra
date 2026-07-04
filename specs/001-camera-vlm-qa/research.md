# Research: Camera Vision Q&A (Phase 1)

All findings below were verified against primary sources as of 2026-07-03:
the `main` branch source of `software-mansion/react-native-executorch`
(`package.json` reports version **0.10.0**), its official docs site, and its
root README — not against AI-summarized secondhand blog content, which was
checked first and discarded where it disagreed with source. Two rounds of
web search and doc-page fetches produced mutually contradictory API shapes
(a sign of stale/SEO content or summarizer drift); everything reported as a
**Decision** below was cross-checked against the literal `.ts` source on
GitHub before being trusted.

## ⚠ Flagged Risks — require your confirmation before Phase 2 (tasks)

These are not guesses. They are verified facts that contradict the tech
stack and README as given, and they change scope/target decisions, not just
implementation detail — that's why they're flagged instead of silently
resolved.

### 1. React Native 0.76 is not a supported version

**Finding**: The library's own compatibility table states RN ExecuTorch
0.8.x/0.9.x support **RN 0.81 through 0.85 only**; "earlier React Native
versions (0.78–0.80) are not supported" (0.76 is further back still). New
Architecture is required regardless of version (confirmed in the root
README).

**Impact**: The plan below assumes **RN 0.81+** instead of the RN 0.76
stated in the feature input. This is a scope-relevant correction, not a
technicality — building against 0.76 would not run.

**Recommendation**: Bump to the newest RN version in the 0.81–0.85 supported
band at implementation time (re-check the compatibility table then, since it
may have moved again).

### 2. Minimum Android version conflicts with the project's existing README

**Finding**: The library's root README states its minimum supported OS is
**Android 13**. Locra's existing `README.md` (written before this feature)
states "Min Android: API 26 (Android 8.0)."

**Impact**: This directly changes the Device Compatibility gate (Principle
IV of the constitution, and FR-010/FR-011) and Success Criterion SC-002 —
"unsupported device" must now include every device below Android 13, which
is a much larger population than API 26–32 devices. It may also change the
project's stated target audience.

**Recommendation**: This plan adopts **Android 13 (API 33) as the enforced
minimum** in the Device Compatibility Result check, since shipping against
API 26 would mean the app cannot load the model at all on ~26–32 devices —
that is a crash-equivalent, not a compatibility edge case. Flagging this so
the README/marketing claim can be corrected in the same change.

### 3. Expo SDK version is a moving target between the docs and `main`

**Finding**: The docs compatibility page states the Expo resource-fetcher
adapter requires **Expo SDK 54 or 55** for library versions 0.8.x/0.9.x. But
the `main` branch source (`0.10.0`) throws at import time unless the new
`expo-file-system` `Directory`/`File.createDownloadTask` API is present,
with an explicit message: *"you're likely on Expo SDK <56 — import from
'react-native-executorch-expo-resource-fetcher/legacy' instead."* The docs
page has not caught up to that change.

**Impact**: The exact Expo SDK pin depends on which published npm version
Phase 1 actually installs, which cannot be pinned confidently from docs
alone right now.

**Recommendation**: At install time, check the installed
`react-native-executorch-expo-resource-fetcher` version's own README/error
messages (not the docs page) to decide whether to import the default or
`/legacy` entry point, and pin the Expo SDK version accordingly.

### 4. Architecture boundary tension: `useLLM` is a React hook

**Finding**: There is no non-hook / class-based entry point to run
inference — `useLLM` is the only documented API, and it is a React hook
(confirmed in its source: it's built on `useState`/`useEffect`/`useCallback`
and returns live state, not a plain async function you can call from a
non-React module).

**Impact**: The constitution's Principle X says "the inference module MUST
NOT import UI code" — but the only way to drive ExecuTorch is a hook, which
is UI-layer by construction. Taken literally, "no UI imports" is
unsatisfiable for the piece of code that calls `useLLM`.

**Decision (proposed, not yet exercised in code)**: Interpret the boundary
as: all inference *business logic* — the single-flight queue lock,
preprocessing, timing/metrics capture, cancellation bookkeeping — lives in
plain `.ts` modules with zero React/RN-UI imports. A single thin hook
(`useInferenceEngine` or similar, living in the inference module's own
directory, not in `screens/`) is the one sanctioned place `useLLM` is
called; it exists only to adapt ExecuTorch's hook-shaped API to the queue
module's plain-function interface. Screens never import `useLLM` directly —
only the inference module's own hook. This preserves the *spirit* of
Principle X (screens have no business logic, business logic doesn't reach
into UI) even though the hook technically lives in the React tree.

## Decisions

### Model selection & constant name

- **Decision**: Use `LFM2_5_VL_1_6B_QUANTIZED`, imported from
  `react-native-executorch`.
- **Rationale**: This is the current canonical export (`modelName:
  'lfm2.5-vl-1.6b-quantized'`, `capabilities: ['vision']`,
  `generationConfig` pre-tuned for the model per its model card). The name
  given in the feature input, `LFM2_VL_1_6B_QUANTIZED`, still exists and
  resolves to the exact same object today, but is annotated `@deprecated`
  in source with the note "this alias will be removed in a future major
  release" — so it works now but should not be the name written in new code.
- **Alternatives considered**: `LFM2_5_VL_450M_QUANTIZED` (smaller variant,
  faster/lighter but lower answer quality) — rejected for Phase 1 because
  the feature input specifically targets the 1.6B model and the spec's
  hardest-problem framing assumes that size.

### Initialization sequence

- **Decision**: App startup MUST call `initExecutorch({ resourceFetcher:
  ExpoResourceFetcher })` (from `react-native-executorch-expo-resource-fetcher`)
  exactly once, before any component mounts a `useLLM` call.
- **Rationale**: Confirmed in source — `ResourceFetcher.getAdapter()` throws
  `ResourceFetcherAdapterNotInitialized` if no adapter was registered, and
  the only way to register one is `initExecutorch`. This is a real
  requirement of the current library version, not present in older
  ExecuTorch releases the feature input's "v0.8+" phrasing may have been
  written against — surfacing this because it is easy to miss when
  following older tutorials.
- **Alternatives considered**: `react-native-executorch-bare-resource-fetcher`
  — rejected because the project uses Expo Dev Client, not a bare RN build.

### Multimodal request shape

- **Decision**: Use the hook's **managed mode** for the ask flow:
  `llm.sendMessage(questionText, { imagePath })`. `imagePath` is the field
  name on the `media` argument of `sendMessage` — confirmed directly in
  `useLLM.ts` and `types/llm.ts` (`MediaArg<C>` resolves to `{ imagePath?:
  string }` when the model declares the `'vision'` capability, which
  `LFM2_5_VL_1_6B_QUANTIZED` does).
- **Rationale**: Managed mode also maintains `messageHistory` automatically,
  which the History screen (User Story 3) can read directly instead of the
  app hand-rolling a parallel conversation log.
- **Important naming trap found during research**: the *functional* mode
  (`llm.generate(messages)`) takes a `Message[]` array whose field for
  attaching an image is **`mediaPath`**, not `imagePath` — a different name
  for the same concept depending on which of the two call styles is used.
  Do not assume the two are interchangeable when writing the inference
  module; Phase 1 only needs managed mode (`sendMessage`), so this is noted
  to prevent a future mix-up, not because both modes are used.
- **Alternatives considered**: Functional mode (`generate`) — rejected for
  Phase 1 because managed mode's automatic history + simpler single-shot
  `response`/`token` state maps more directly onto the single-flight queue
  design; functional mode would require the app to hand-manage
  `messageHistory` itself for no benefit here.

### Streaming mechanism

- **Decision**: Treat streaming as **hook state, not a callback API**. There
  is no `onToken(callback)` registration anywhere in the library. `useLLM`
  exposes `token` (the most recently generated token/chunk) and `response`
  (the cumulative string built from all tokens so far in the current
  generation) as plain state values that change on every generated token;
  the consuming component re-renders on each change. `isGenerating`
  (boolean) marks whether a generation is in flight, and `interrupt()`
  cancels it.
- **Rationale**: This is exactly what's in `useLLM.ts` — a
  `tokenCallback` internal to the hook drives `setToken`/`setResponse`; no
  such callback is exposed to hook consumers to register their own.
- **Impact on metrics (FR-008)**: None of `model load time`, `image
  preprocessing time`, `first-token latency`, `tokens/sec`, or `total wall
  time` are provided by the library itself. All five must be measured by
  the app: wrap the `initExecutorch`→`isReady` transition for load time, the
  app's own resize/compress step for preprocessing time, the timestamp of
  the call to `sendMessage` vs. the first `token` state change for
  first-token latency, `getGeneratedTokenCount()` combined with elapsed
  time for tokens/sec, and the `sendMessage` call vs. `isGenerating`
  flipping back to `false` for total wall time.

### Model download, pause/resume, and storage management

- **Decision**: Use `ExpoResourceFetcher` (singleton export of
  `react-native-executorch-expo-resource-fetcher`) directly for download
  lifecycle control — `pauseFetching(...sources)`, `resumeFetching(...sources)`,
  `cancelFetching(...sources)`, `listDownloadedModels()`,
  `deleteResources(...sources)`, `getFilesTotalSize(...sources)` — where
  `sources` are the `modelSource`/`tokenizerSource`/`tokenizerConfigSource`
  values already present on the `LFM2_5_VL_1_6B_QUANTIZED` constant.
  `useLLM`'s own `downloadProgress` state (0–1) covers the passive progress
  bar; the imperative pause/resume/cancel controls live outside the hook.
- **Rationale**: Confirmed directly in `BaseResourceFetcherClass.ts` and
  `expo-resource-fetcher/src/ResourceFetcher.ts` — these are real, public,
  documented methods, not internal-only. The README for the adapter package
  explicitly documents this as its intended usage.
- **Gap found — integrity verification is NOT provided by the library**:
  Nothing in `ResourceFetcher`, `BaseResourceFetcherClass`, or
  `ExpoResourceFetcher` computes or checks a checksum/hash. `fetch()` is
  documented as idempotent — "if the file already exists, return its path
  without re-downloading" — meaning a corrupted local `.pte` file will
  silently be reused forever unless the app itself detects the corruption.
  FR-012/FR-013 (missing-or-corrupt model routes to the download screen)
  therefore requires app-level SHA-256 verification (e.g. via
  `expo-crypto`) run once after `ExpoResourceFetcher.fetch()` resolves and
  again as a sanity check before the app trusts a previously-downloaded
  file at cold start, with `ExpoResourceFetcher.deleteResources(...)` used
  to clear a failed file before re-download.
- **Alternatives considered**: Relying on `useLLM`'s own `error` state to
  detect corruption after a failed load attempt — rejected as the sole
  mechanism because it means the user reaches a load *attempt* (with its
  memory cost, see Principle IV) before finding out the file was bad;
  app-level pre-load verification is cheaper and matches "checked before
  model load, not after."

### Device compatibility check

- **Decision**: Device compatibility (Principle IV, FR-010) must be a
  custom check the app implements itself — most likely via
  `react-native-device-info`'s total-RAM query plus `Platform.Version` for
  the OS-level gate — run before `initExecutorch`/`useLLM` are ever touched.
- **Rationale**: There is no device-capability or memory-check API anywhere
  in `react-native-executorch`'s `hooks/general` or `modules` directories;
  the library assumes the host app has already decided it's safe to load a
  model.
- **Alternatives considered**: Attempt-and-catch (try loading the model,
  fall back to the setup screen on OOM) — rejected as the primary strategy
  because it violates Principle IV's "checked before model load, not
  after," though the OOM error path (FR-023) still needs to exist as a
  defense-in-depth backstop for devices that pass the pre-check but still
  fail under real memory pressure.

## Summary of Technical Context inputs this research resolves

| Item | Resolved value |
|---|---|
| React Native version | 0.81–0.85 (not 0.76 — see Flagged Risk 1) |
| ExecuTorch package version | Verify exact installed version at `yarn add` time; source referenced here is `main` (reports `0.10.0`) |
| Model constant | `LFM2_5_VL_1_6B_QUANTIZED` (not the deprecated `LFM2_VL_1_6B_QUANTIZED` alias) |
| Required companion packages | `react-native-executorch-expo-resource-fetcher`, `expo-file-system`, `expo-asset` |
| Minimum Android version | 13 (API 33) — conflicts with existing README's API 26 claim (see Flagged Risk 2) |
| Expo SDK version | 54/55 per docs, but `main`'s resource fetcher wants 56+ or its `/legacy` import — verify against the installed version (see Flagged Risk 3) |

## Phase 1 Setup Findings (verified 2026-07-04, during T001–T006)

These findings were discovered while actually building the scaffold on a physical
Windows machine — not from docs, but from reproducing native build failures directly
and inspecting installed package sources and NDK headers. They supersede the Expo
SDK/RN pin implied by the initial scaffold (Expo SDK 57 / RN 0.86.0) with the values
below, and they resolve Flagged Risk 1 concretely rather than leaving it as a range.

### Finding: react-native-executorch's prebuilt native libs require NDK 26, not 27

**Finding**: `react-native-executorch` 0.9.2 bundles prebuilt OpenCV/KleidiCV static
libraries (`libopencv_core.a`, `libkleidicv_hal.a`) under
`android/third-party/android/libs/`. These were built against NDK 26.x's libc++ ABI.
Linking them under NDK 27.x fails with `undefined symbol:
std::__ndk1::__libcpp_verbose_abort(char const*, ...)` — confirmed by direct
`ld.lld` link errors, not a guess from docs.

**Decision**: Pin `ndkVersion` to `26.3.11579264` for every native module in the
Android project (not just the app module — `react-native-executorch`'s own Gradle
module doesn't declare an `ndkVersion`, so it silently falls back to whichever NDK
AGP resolves as default — 27.x on Expo SDK 56/57 — unless forced). Implemented as a
root `android/build.gradle` `ext { ndkVersion = "26.3.11579264" }` plus a
`subprojects { afterEvaluate { ... } }` hook forcing every subproject onto it.

**Impact**: This is a real, permanent constraint on every future native dependency
in this project (see the new constitution requirement) — not a one-time workaround.

### Finding: NDK 26's libc++ conflicts with React Native's own core headers

**Finding**: `ReactCommon/react/renderer/core/graphicsConversions.h` (a header
shared by every Fabric-based native view component — confirmed present, byte-for-byte
identical in both RN 0.85.3 and RN 0.86.0) calls `std::format(...)`. NDK 26.3's
libc++ compiles this out by default (`_LIBCPP_HAS_NO_INCOMPLETE_FORMAT` is defined
unconditionally in that NDK's `__config` unless `_LIBCPP_ENABLE_EXPERIMENTAL` is set),
while NDK 27's libc++ ships it unconditionally. This surfaces as a hard compile error
in any native module that includes this header for a custom Fabric view component
(observed via `react-native-nitro-image`, pulled in transitively by
`react-native-vision-camera`).

**Decision**: Patch the one line (`std::format("{}%", dimension.value)` →
`std::to_string(dimension.value) + "%"`) directly in
`node_modules/react-native/ReactCommon/react/renderer/core/graphicsConversions.h`,
applied automatically via `scripts/patch-react-native.js` wired as the npm
`postinstall` script (not `patch-package`, which fails on this Windows machine's git
diff step independent of this issue).

**Alternatives considered**: Using NDK 27 instead (rejected — reintroduces the
executorch prebuilt-lib link failure above; the two constraints are mutually
exclusive on any single NDK version tested).

### Finding: Expo SDK 57 / RN 0.86.0 is outside react-native-executorch's supported band

**Finding**: Flagged Risk 1 (above) already established that ExecuTorch's own
compatibility table excludes RN 0.86; the initial scaffold (T001) nonetheless
pinned Expo SDK 57, which bundles RN 0.86.0 exclusively — there is no way to run
Expo SDK 57 against an earlier RN version. Expo SDK 56.0.14 bundles RN 0.85.3
exactly, which is both within ExecuTorch's supported band and matches
`react-native-vision-camera`'s own tested `react-native` devDependency (0.85.3).

**Decision**: Downgrade the scaffold to Expo SDK 56.0.14 / RN 0.85.3.

**Verification note**: downgrading RN version alone did **not** resolve the NDK 26
vs. 27 conflict above — the `graphicsConversions.h` `std::format` call and the
executorch prebuilt-lib ABI requirement are both present identically under RN 0.85.3
and RN 0.86.0. The NDK pin + header patch (above) are what actually resolve it,
independent of RN version.

### Finding: react-native-nitro-modules and react-native-nitro-image are peer, not transitive, dependencies

**Finding**: `react-native-mmkv` and `react-native-vision-camera` both declare
`react-native-nitro-modules` (and, for vision-camera, `react-native-nitro-image`) as
`peerDependencies`, not regular `dependencies`. npm's automatic peer-dependency
installation is not reliable across every install in this environment — it can leave
a package directory present in `node_modules` but empty of a real `package.json`
(observed after a partial `rm -rf node_modules` interrupted by a Windows file lock).

**Decision**: Install `react-native-nitro-modules` and `react-native-nitro-image`
explicitly as direct dependencies in `package.json` rather than relying on implicit
peer auto-install.

### Decision: production and development builds via EAS Build, not local Gradle

**Decision**: This machine cannot produce a working local Android build at all —
every NDK version tested satisfies at most one of the two conflicting native
constraints above (see the two Findings above). Local Windows Gradle builds are
therefore permanently out of scope for this project, not a temporarily broken
workaround. `npx expo run:android` / local `gradlew assembleDebug` MUST NOT be relied
upon as a build-verification step going forward.

**Rationale**: EAS Build runs on Expo's own Linux CI with a version-pinned toolchain
per Expo SDK; it was verified to produce an installable, working build (Samsung S26
Ultra, model SM-S948U1) with the exact dependency set in this document, including
the NDK-26-only reanimated/worklets pair (`react-native-reanimated@4.3.1` +
`react-native-worklets@0.8.3` — the versions `expo install --fix` resolves natively
for Expo SDK 56, without the manual reanimated version bump this machine's local
build investigation explored and then reverted).

**Alternatives considered**: Continuing to chase a local-Gradle-compatible NDK/library
combination — rejected after confirming (a) no single NDK version satisfies both
conflicting native constraints, and (b) a linker-flag relaxation attempt
(`-DCMAKE_SHARED_LINKER_FLAGS=-Wl,--allow-shlib-undefined`) made the build worse by
replacing CMake's default linker flags outright rather than appending to them,
dropping essential C++ runtime linkage entirely.

**Local development workflow**: `npx expo start --dev-client --clear`, device
connected via USB with `adb reverse tcp:8081 tcp:8081` — Metro/JS-only iteration
does not require a local native build once an EAS-built dev client APK is installed
on the device. `app.json`'s `runtimeVersion` policy is set to `sdkVersion` so EAS
builds and the JS bundle stay compatible without a native rebuild on every JS change.
