# Phase 001 Pre-Build Audit

Date: 2026-07-07

## 1. Final Verdict

BUILD

All locally detectable blockers found during this audit were fixed. The repository now passes TypeScript, ESLint, Jest, Expo Doctor, Expo public config evaluation, and Android JavaScript export/bundle validation without running EAS or Gradle.

Use this verdict only for the next Phase 001 physical-device validation build. It is not a Play Store release approval because every quickstart scenario is still pending physical-device evidence.

## 2. Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short` | Passed | Worktree was already dirty before the audit; unrelated/spec changes were not reverted. |
| `rg --files` and targeted `rg`/`Get-Content` inspections | Passed | Read constitution, Feature 001 docs/contracts/checklists, README, config, source, and tests. |
| `npm run type-check` | Passed | `tsc --noEmit`. |
| `npm run lint` | Passed | `eslint src --ext .ts,.tsx`. |
| `npm test -- --runInBand` | Passed | 29 suites, 190 tests. |
| `npx expo-doctor` | Failed, then passed | Initial failures: invalid `newArchEnabled` app config field and Expo patch mismatches. Fixed; rerun passed 21/21. |
| `npx expo config --type public` | Passed | Confirms dark UI style, runtimeVersion policy, plugins, package id, permissions. |
| `npx expo export --platform android --output-dir .tmp\prebuild-audit-export --clear` | Passed | Android bundle generated: 1 Hermes bundle, 36 assets. Temporary output removed. |
| `npm audit --omit=dev --audit-level=moderate` | Failed first due registry/audit endpoint, rerun with approval | Reports 11 moderate `uuid` transitive vulnerabilities through Expo config/CLI tooling; no fix available. |
| Native metadata grep in `node_modules` | Completed | Found VisionCamera/Nitro package default NDK values, but Gradle files defer to root `ndkVersion` when provided. Requires EAS/native confirmation. |

## 3. Test Summary

- Suites: 29 passed / 29 total.
- Tests: 190 passed / 190 total.
- Failed: 0.
- Skipped: 0.
- New tests added: 2 model lifecycle tests in `tests/unit/model/ModelDownloadManager.test.ts`.

## 4. Task Verification Summary

Audited all task IDs T001-T101 in `tasks.md`, including unchecked and deferred tasks.

| Verdict | Count |
| --- | ---: |
| VERIFIED | 87 |
| PARTIAL | 3 |
| NOT FOUND | 0 |
| MANUAL ONLY | 4 |
| DEFERRED | 7 |

PARTIAL:

- T001: RN/Expo version band verified and local generated Gradle has `newArchEnabled=true`, but Expo SDK 56 rejects `newArchEnabled` in `app.json`. The next EAS build must confirm the generated native project remains New Architecture enabled.
- T034: task names removed `ReportButton.tsx`; flagging is implemented through `AnswerActions.tsx`.
- T035: task names mounting `ReportButton`; actual reachable UI is `AnswerActions` on `AnswerScreen`, with history flag rendering verified.

MANUAL ONLY:

- T043: original physical-device quickstart validation.
- T068: on-device multi-turn context validation.
- T083: on-device resumable-thread validation.
- T095: on-device output quality validation.

DEFERRED:

- T060-T064, T075, T077. These match `DEFERRED_BACKLOG.md` and are not Phase 001 build blockers.

## 5. Code Issues Found and Fixed

1. Duplicate/cancelled model download race.
   - Files: `src/model/ModelDownloadManager.ts`, `tests/unit/model/ModelDownloadManager.test.ts`.
   - Fix: added manager-level active download deduplication and stale-run guards so duplicate starts share one promise and cancelled fetch rejection cannot overwrite state with `failed`.
   - Coverage: new tests for repeated `startDownload()` and cancel-after-start settling order.

2. Cold-start model reconciliation trusted present `.pte` too much.
   - Files: `src/model/ModelDownloadManager.ts`, `tests/unit/model/ModelDownloadManager.test.ts`.
   - Fix: reconciliation now performs a cheap expected-size check using model metadata before marking an existing model ready, without re-hashing the multi-GB file.
   - Coverage: unit and contract lifecycle tests.

3. Voice recording cleanup could leave lock held if stream stop threw.
   - File: `src/inference/useVoiceTranscription.ts`.
   - Fix: added safe stream stop wrapper so cleanup still releases the shared voice/VLM lock.
   - Coverage: existing voice lock/store tests; behavior remains device-gated for real mic validation.

4. Stale local build instructions could trigger forbidden native build.
   - Files: `README.md`, `package.json`, `scripts/blocked-local-android.js`.
   - Fix: README now reflects EAS/dev-client strategy; `npm run android` exits with a clear message; added `npm run start:dev-client`.

5. Expo config mismatches.
   - Files: `app.json`, `package.json`, `package-lock.json`.
   - Fix: added `runtimeVersion.policy = sdkVersion`, switched app UI style to dark, removed invalid `newArchEnabled` field, updated Expo patch versions (`expo` 56.0.15, `expo-asset` 56.0.19, `expo-image-manipulator` 56.0.21).
   - Coverage: Expo Doctor 21/21 and Expo public config pass.

## 6. Remaining Risks

BLOCKER:

- None for triggering the Phase 001 validation build.

HIGH:

- No quickstart scenario has physical-device evidence yet. `quickstart-results.md` still says zero of twelve scenarios have been executed.
- Native build/runtime behavior cannot be fully proven without installing the APK: ExecuTorch model load, VisionCamera capture, background downloader service/notification, expo-audio mic stream, and keyboard-controller behavior.
- New Architecture must be confirmed from EAS build logs or generated native files because SDK 56 does not accept an explicit `newArchEnabled` app config key.

MEDIUM:

- `expo-audio` adds foreground-service/media-playback related permissions in public config. The model downloader itself uses data-sync service code, but the merged release manifest and Play Console foreground service declarations must be checked.
- `react-native-vision-camera` and `react-native-nitro-image` package defaults mention newer NDKs, though their Gradle files use root `ndkVersion` when present. EAS is the final proof.
- `npm audit` reports 11 moderate transitive `uuid` advisories through Expo config/CLI tooling with no available fix.

LOW:

- `specs/001-camera-vlm-qa.zip` is untracked generated/backup output. It was not deleted because its purpose is ambiguous.
- Older task text still references `ReportButton`, while the actual implementation is `AnswerActions`.

## 7. Native / EAS Build Risks

- Fresh build required: native dependencies changed since older builds (`expo-audio`, `expo-image-manipulator`, background downloader, keyboard-controller).
- Confirm EAS build logs use the expected Expo SDK 56 / RN 0.85.3 native template and New Architecture.
- Confirm generated Android manifest includes required camera, mic, notification, and background data-sync service permissions.
- Confirm Android 13+ notification permission prompt behavior.
- Confirm notification tap returns to the app/setup flow as expected.
- Confirm Play Console foreground service declaration matches actual merged manifest types.
- Confirm release-mode model file paths match `react-native-executorch` expected `RNEDirectory + filename` location.
- Confirm ProGuard/R8/minification remains non-breaking if enabled later; current config does not locally validate minified native release behavior.

## 8. Phase 002 Recommendations

- Add explicit image lifecycle/storage management: delete cached gallery copies, enhanced/intermediate images, and abandoned capture files when conversations are deleted or reset.
- Add storage accounting for model files, image cache, and Whisper assets.
- Persist verified model metadata (`model id`, `version`, `expected size`, `sha256`, `verifiedAt`) so launch reconciliation can avoid network config fetches while still detecting stale/corrupt state.
- Add a controlled repair path for orphaned partial model files.
- Keep MMKV payloads path-only; do not persist base64 images.

## 9. Optimal One-Build Manual Test Sequence

Prerequisites:

- One fresh EAS-built Android APK installed on a physical Android 13+ device with at least 6 GB RAM.
- Stable WiFi, charger, and at least 6 GB free storage.
- Start from a clean app install if possible.
- Keep the device connected for logs if using a development build.

Checklist:

1. Launch fresh install. Complete onboarding. Grant camera; do not start model download yet.
2. Open Model Setup. Confirm supported-device state and model size warning.
3. Start model download on WiFi. Confirm progress UI and Android notification.
4. While download is early, test pause and resume once.
5. Background the app. Confirm notification progress continues.
6. Kill/reopen the app during download. Confirm it reattaches instead of starting a duplicate download.
7. Tap the notification. Confirm it returns to the app/setup flow.
8. Let the model complete and verify. Confirm app routes to Capture.
9. Enable airplane mode. Capture a photo and ask a simple visible question. Confirm streamed answer and no network requirement.
10. Ask pronoun-based follow-ups in the same chat. Include one off-image general knowledge follow-up. Confirm context is preserved and the assistant does not refuse unnecessarily.
11. Navigate back to Capture, take a new photo, and confirm the old thread does not bleed into the new chat.
12. Open History. Continue the earlier thread. Ask one more follow-up. Kill/reopen app and verify the thread is still resumable.
13. Use copy/share/flag on a completed answer. Confirm history shows flagged local state.
14. Open Benchmark. Confirm metrics are populated and labels match observed behavior.
15. Test gallery input once. Confirm selected image can be asked about.
16. Enable voice. Let Whisper prepare. Hold to record, release, confirm transcript fills the prompt without auto-submitting. Submit manually.
17. While VLM is answering, confirm voice is unavailable; while voice is recording, confirm inference cannot start concurrently.
18. Run Scenario 10 answer-quality checks with a label/document-like image and a broader follow-up.
19. Run the sustained-use loop as late as possible: 50 asks, monitoring crashes/OOM/thermal behavior.
20. At the end only, perform destructive storage/corruption tests if needed, because they may force a re-download.

## 10. Final Recommendation

Safe to trigger the Phase 001 EAS validation build.
