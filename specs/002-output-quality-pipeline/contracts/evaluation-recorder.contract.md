# Contract: Dev-Only Evaluation Recorder

The evaluation recorder is a development-only interface for saving scored evaluation results from the current completed inference.

## Required Recorder Flow

1. The developer manually runs one fixed evaluation case through the real Locra app.
2. After the answer completes, the recorder reads the current production-owned objective result record.
3. The recorder auto-populates all available objective fields.
4. The developer only:
   - confirms or selects `caseId`
   - sets `directAnswer`
   - sets `coreCorrectness`
   - sets `hallucination`
   - sets `usefulness`
   - optionally enters `notes`
5. The developer taps Save Result.
6. Saved cases accumulate into one evaluation run until exported or reset.
7. The developer taps Export Results to produce a JSONL artifact for the run.

## Required Recorder Constraints

- The recorder must be unavailable in production/release builds.
- Objective fields come from the production-owned DTO and must not be manually typed into the recorder.
- Save Result must persist evaluation records only to evaluation-only storage.
- Export Results must produce one JSONL record per saved case.
- Exported records must satisfy the evaluation result contract.

## Required Recorder Tests

- Objective fields are populated from the production result DTO.
- Subjective fields are entered separately from objective fields.
- Save Result does not write to normal history.
- Multiple cases accumulate in one evaluation run.
- Exported JSONL contains one valid record per saved case.
- Recorder is unavailable in production builds.
