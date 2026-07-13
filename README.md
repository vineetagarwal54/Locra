# Locra

On-device vision AI for Android. Locra runs a quantized vision-language model
locally, answers questions about a camera/gallery image, and keeps prompts,
images, answers, flags, and history on the phone.

The inference path is offline by architecture: capture -> preprocess -> model ->
answer -> persist makes no network calls. Network is used only for model/config
download before inference is available.

## Current Phase

Feature 001 (`specs/001-camera-vlm-qa`) is in pre-release validation.

Implemented locally:

- Camera/gallery image question flow.
- On-device LFM2.5-VL-1.6B quantized model through React Native ExecuTorch.
- Background model download with notification progress and integrity check.
- Single-flight inference queue with graceful error/cancel handling.
- 512x512 hard preprocessing ceiling, with image enhancement before the ceiling.
- Streamed answers, output cap handling, and local benchmark metrics.
- Multi-turn follow-up chat using one long-lived managed `useLLM` instance.
- Resumable local history, flagging, sharing, and voice dictation code paths.

Still requires physical-device validation:

- Full model download/background notification behavior.
- Camera/gallery capture on the release/dev-client APK.
- Real VLM answer quality and output truncation behavior.
- Multi-turn/context retention on device.
- Voice recording/transcription on device.

Deferred backlog is tracked in `specs/001-camera-vlm-qa/DEFERRED_BACKLOG.md`.

## Stack

| Area | Current value |
| --- | --- |
| Expo SDK | 56.0.14 |
| React Native | 0.85.3 |
| Runtime | React Native ExecuTorch 0.9.2 |
| Primary model | LFM2.5-VL-1.6B quantized |
| Storage | MMKV only |
| Navigation | React Navigation native stack |
| Target platform | Android physical device |
| Build strategy | EAS Build or EAS local mode on Linux CI; no local Windows native build |

## Architecture Rules

- Zero network in the inference path.
- One inference at a time.
- Screens contain UI only and call stores/components.
- `src/inference/` has no UI imports.
- `src/model/` owns model lifecycle and stays self-contained.
- `src/inference/useInferenceEngine.ts` is the only `useLLM` import/call site.
- `src/storage/mmkv.ts` is the only direct MMKV instance.
- No AsyncStorage or SQLite in Phase 1.
- All screen/component colors, spacing, and radii come from
  `src/constants/theme.ts`.

See `AGENTS.md` and `.specify/memory/constitution.md` for the full rules.

## Key Paths

```text
src/navigation/AppNavigator.tsx          App bootstrap and screen routing
src/screens/CaptureScreen.tsx            Camera/gallery input and prompt UI
src/screens/AnswerScreen.tsx             Streamed answer and follow-up chat
src/screens/ModelSetupScreen.tsx         Model download/setup UI
src/screens/HistoryScreen.tsx            Local persisted conversations
src/screens/BenchmarkScreen.tsx          Local performance metrics
src/inference/InferenceQueue.ts          Single-flight inference pipeline
src/inference/useInferenceEngine.ts      ExecuTorch useLLM adapter
src/inference/ContextBuilder.ts          Follow-up context prompt builder
src/inference/ImagePreprocessor.ts       512x512 preprocessing ceiling
src/inference/ImageEnhancer.ts           Orientation/crop/downscale stage
src/inference/useVoiceTranscription.ts   Speech-to-text adapter
src/model/ModelDownloadManager.ts        Download/integrity state machine
src/model/BackgroundDownloadFetcher.ts   Android background download adapter
src/model/DeviceCompatibility.ts         Memory/device compatibility gate
src/history/HistoryStore.ts              MMKV-backed history store
src/store/*.ts                           Screen-facing Zustand stores
```

## Local Development

Install dependencies:

```bash
npm install
```

Run the Metro dev server for an already-installed EAS dev-client APK:

```bash
npm run start:dev-client
adb reverse tcp:8081 tcp:8081
```

Do not run `npx expo run:android`, `npm run android`, local `gradlew`, or
`expo prebuild` on this Windows machine. The local Android native build is
blocked by the current NDK/native dependency constraints documented in
`AGENTS.md` and `specs/001-camera-vlm-qa/plan.md`.

Use an EAS-built dev-client APK for device testing. Rebuild the APK when native
dependencies or app config change.

## Local Validation Before Any EAS Build

Run the checks that do not consume remote build resources:

```bash
npm run type-check
npm run lint
npm test
npx expo-doctor
npx expo config --type public
```

An Android JavaScript bundle/export check may also be run with Expo export when
needed. Do not run `eas build` or `eas update` for this local validation step.

## Build Profiles

`eas.json` contains:

- `development`: internal dev-client APK.
- `production-apk`: internal release APK for pre-Play validation.
- `production`: Play Store AAB.

For current manual validation, prefer one fresh development build if you need
Metro/dev inspection, or `production-apk` if you are validating the exact release
experience without dev tooling.

### Model selection

On first launch, Locra asks the user to choose one of the two supported on-device
models. The choice is stored in MMKV and can later be changed from Settings. One
APK supports both models; separate LFM and Gemma builds are not required.

`EXPO_PUBLIC_LOCRA_VLM` remains available only as an optional developer override:

- `lfm2_5_vl_1_6b` for the default LFM2.5-VL-1.6B model.
- `gemma4_e2b` for the Gemma 4 E2B multimodal model.

Leave it unset for normal onboarding and testing. An invalid value is ignored, so
it never bypasses the persisted user selection or prevents first-launch selection.

## Specs

Feature 001 source of truth:

```text
specs/001-camera-vlm-qa/spec.md
specs/001-camera-vlm-qa/plan.md
specs/001-camera-vlm-qa/tasks.md
specs/001-camera-vlm-qa/quickstart.md
specs/001-camera-vlm-qa/quickstart-results.md
specs/001-camera-vlm-qa/DEFERRED_BACKLOG.md
specs/001-camera-vlm-qa/contracts/
```

## License

MIT. See `LICENSE`.
