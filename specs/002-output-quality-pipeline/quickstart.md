# Quickstart: Output Quality Pipeline Validation

## Prerequisites

- Dependencies installed with `npm install`.
- A physical Android device with a Locra development build for recorder-based evaluation runs.
- The primary LFM2.5-VL-1.6B model downloaded and integrity-verified in the app.
- No EAS build is required to run static checks, but smoke and official evaluation runs require a physical-device development build with the dev-only recorder enabled.

Do not use `npx expo run:android` or local prebuild on Windows for this project.

## Local Static Validation

Run these before device evaluation:

```powershell
npm run type-check
npm run lint
npm test
```

Also verify evaluation isolation:

```powershell
rg -n "src/evaluation|quality-eval" src/screens src/navigation src/history src/store src/inference
```

Expected result: production screens, navigation, normal history, and production inference do not import evaluation-only modules or artifacts. Production modules may expose reusable result/metric DTOs, but evaluation remains the consumer.

## Evaluation Artifacts

Feature implementation should create:

```text
quality-eval/
|-- README.md
|-- rubric.md
|-- cases/
|-- images/
`-- results/
```

Use `quality-eval/cases/` for the fixed case set and smoke subset, `quality-eval/images/` for repo-tracked sample images, and `quality-eval/results/` for exported baseline/candidate JSONL artifacts.

## Smoke Evaluation Run

1. Install a development build that includes the production output pipeline, the production-owned objective result DTO, and the dev-only recorder/export path.
2. Ensure the model is downloaded and ready.
3. Run the fixed 6-case smoke subset in `quality-eval/cases/smoke-subset.v1.json`.
4. After each completed case, open the dev-only evaluation recorder for the current result.
5. Confirm or select the `caseId`.
6. Enter only the subjective fields: `directAnswer`, `coreCorrectness`, `hallucination`, `usefulness`, and optional `notes`.
7. Tap Save Result. The recorder should already contain all available objective fields from the production-owned result DTO, including answer text, model/config identifiers, pipeline variant, timing, token counts when available, truncation/looping status, timestamp, and device/build metadata.
8. After the smoke subset run is complete, tap Export Results and save the JSONL artifact under `quality-eval/results/`.

Expected result: the evaluator never manually types answer text, metrics, identifiers, timestamps, or device/build data.

## Official Full Evaluation Run

1. Use the same development build class and device class for baseline/candidate comparisons.
2. Run the full 18-case set from `quality-eval/cases/cases.v1.json` only after the stabilized candidate pipeline and recorder/export path exist.
3. Save each case through the dev-only recorder, then export the completed run to `quality-eval/results/`.
4. Ensure exported official artifacts include `official: true`, case-set version, pipeline variant, model identifier, generation config identifier, device name/model, app/build identifier, and execution date.
5. Compare candidate versus baseline by shared `caseId`.

Expected result: exported artifacts are ready for baseline-versus-candidate comparison without cloud services, telemetry, a dashboard, or manual PC-side reconstruction.

## Core Scenario Checks

1. First image question: ask a practical question about an image. Expected: the visible answer directly answers the question and does not expose raw structured extraction unless requested.
2. Grounded advice: ask what to do about a visible object/problem. Expected: answer separates visible facts from general guidance and states uncertainty briefly when needed.
3. Active follow-up: ask a pronoun-based follow-up in the same live chat. Expected: the app sends only the new follow-up to the managed engine when live context is valid.
4. Resumed conversation: reopen a persisted conversation and ask one follow-up. Expected: the app reconstructs hidden evidence and recent context once.
5. Later resumed follow-up: ask another follow-up. Expected: the app does not repeatedly embed the entire transcript.
6. Tall/document-like image: submit a receipt, screenshot, code screenshot, or chat screenshot. Expected: preprocessing preserves relevant content before applying the final 512x512 ceiling.
7. Evaluation isolation: confirm Save Result does not write to normal history and release builds do not expose the recorder.
8. Evaluation removability: temporarily remove/ignore `quality-eval/` and `src/evaluation/` in a clean branch. Expected: production app source still typechecks and production flow is unchanged.
9. New image clean context: start a second image conversation after a completed first image. Expected: managed history, pinned visual evidence, and active session context are cleared so no evidence crosses images.
10. Voice and flagging regressions: verify voice/VLM mutual exclusion still prevents concurrent activity and releases after completion, cancellation, and errors; verify answer flagging still persists after two-stage answers.

## Success Evidence

Use the measurable outcomes in `spec.md` SC-001 through SC-017 as the release gate. Official quality claims must be based on physical Android device result artifacts exported from the dev-only recorder, not local dry-runs or subjective one-off testing.
