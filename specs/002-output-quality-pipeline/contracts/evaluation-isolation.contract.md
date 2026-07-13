# Contract: Evaluation Isolation

Evaluation tooling must be removable and must not change production Locra behavior.

## Allowed Dependencies

- Production inference code may expose neutral objective result DTOs and metrics needed by evaluation consumers.
- `src/evaluation/` may import stable production DTOs or helpers needed to consume completed inference outputs.
- `quality-eval/` may contain fixed cases, smoke subsets, images, rubric docs, and exported result artifacts.
- Dev-only recorder UI, evaluation run storage, and export helpers may depend on evaluation modules.

## Forbidden Dependencies

- Production inference must not import `src/evaluation/` or `quality-eval/` to create or expose the objective result record.
- `src/screens/`, `src/navigation/`, and `src/history/` must not depend on evaluation tooling for normal production flows.
- Save Result must not write to normal conversation history, flagging data, or production analytics.
- Evaluation code must not introduce cloud services, telemetry upload, accounts, analytics backends, mock inference, alternate models, batch automation, or a separate evaluation app.
- Release builds must not expose or require the dev-only recorder.

## Removability Test

Removing `quality-eval/` and `src/evaluation/` must leave production camera, chat, history, flagging, voice, model setup, and inference source paths intact. Production compilation and runtime behavior must remain valid after that removal.
