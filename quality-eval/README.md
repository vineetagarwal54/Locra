# Locra Quality Evaluation

This folder contains local, removable output-quality evaluation artifacts for Feature 002.

It is not part of the production app flow. Do not add a production rating UI, dashboard, analytics backend, telemetry upload, account system, or alternate inference path for this evaluation work.

## Structure

```text
quality-eval/
  cases/
  images/
  results/
  README.md
  rubric.md
```

## Fixed Case Set

Use `cases/cases.v1.json` for baseline and candidate comparisons. The set contains 18 cases:

- 3 visible facts
- 3 text-reading/OCR-style cases
- 3 visual reasoning cases
- 3 practical advice cases
- 3 active follow-up context cases
- 3 resumed conversation context cases

All v1 cases use repo-tracked SVG image fixtures under `images/`. Manual capture instructions are reserved for future camera/device-specific cases only.

## Device-to-JSONL Workflow

1. Install the physical Android build being evaluated.
2. Confirm the model is downloaded and ready.
3. Run each case from `cases/cases.v1.json` in order.
4. After each completed inference, copy or export the production-owned objective inference result record from the device/app.
5. Paste one JSON object per line into `results/run-template.jsonl`.
6. Include official metadata in every official record: `official: true`, `caseSetVersion`, `variant`, `modelId`, `generationConfigId`, `deviceNameModel`, `appBuildId`, and `timestamp`.
7. Fill `manualScore` fields using `rubric.md`.
8. Save the completed file under `results/`, for example `baseline-current.jsonl` or `candidate-two-stage-v1.jsonl`.
9. Validate locally with the evaluation helpers and Jest tests.

Official baseline and candidate artifacts must come from physical Android device runs. Dry-runs may help development, but they are not official quality evidence.

## No Production Coupling

Production code must not import from `quality-eval/` or `src/evaluation/`. Evaluation helpers are allowed to consume exported production-owned result records.
