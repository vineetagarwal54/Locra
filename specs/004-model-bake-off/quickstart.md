# Quickstart: Runtime Model Choice

1. Build one development or production APK with `EXPO_PUBLIC_LOCRA_VLM` unset.
2. Clear app data, launch, complete Welcome and Privacy, and verify model selection appears.
3. Select each model in separate runs and verify only that model enters setup/download.
4. From Settings, confirm Change model is blocked during inference and download activity.
5. Switch after both models have been verified and confirm the target is reused immediately.
6. Export diagnostics/evaluation results and verify the effective selected model ID is recorded.

For developer-only forced startup, set `EXPO_PUBLIC_LOCRA_VLM` to `lfm2_5_vl_1_6b` or
`gemma4_e2b`. Normal testing leaves it unset.
