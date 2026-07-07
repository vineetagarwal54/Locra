# Contract: Evaluation Result

Evaluation results are reviewable JSONL records exported from saved evaluation runs and stored under `quality-eval/results/`.

## Required Fields

```json
{
  "caseId": "pan-001",
  "variant": "two-stage-v1",
  "official": true,
  "caseSetVersion": "cases.v1",
  "modelId": "LFM2_5_VL_1_6B_QUANTIZED",
  "generationConfigId": "recommended-lfm2-vl-v1",
  "deviceNameModel": "Pixel 8 Pro",
  "appBuildId": "locra-android-2026-07-07",
  "output": "The pan surface appears worn...",
  "perceptionLatencyMs": 1180,
  "answerTtftMs": 820,
  "answerGenerationLatencyMs": 6220,
  "totalEndToEndLatencyMs": 7400,
  "generatedTokens": 186,
  "promptTokens": 512,
  "looping": false,
  "truncated": false,
  "timestamp": "2026-07-07T16:30:00.000Z",
  "manualScore": {
    "directAnswer": true,
    "coreCorrectness": true,
    "hallucination": false,
    "usefulness": 4,
    "notes": "Useful but slightly verbose"
  }
}
```

## Rules

- Objective fields must come from the production-owned objective inference result record, not from manual PC-side transcription.
- `manualScore` is entered separately in the dev-only recorder and may be omitted before Save Result if the case is not yet finalized.
- Official records must include `official: true`, `caseSetVersion`, `variant`, `modelId`, `generationConfigId`, `deviceNameModel`, `appBuildId`, and execution date/timestamp either per record or in a containing run manifest.
- `usefulness` must be an integer from 1 through 5.
- `hallucination: true` means unsupported image-specific claims appeared.
- `looping` and `truncated` should be auto-populated when available.
- Records must compare by shared `caseId`, `variant`, and `generationConfigId`.
- Exported results must not be written to normal Locra conversation history.
- Official baseline/candidate comparisons must use physical Android device results captured after the recorder/export path exists.
