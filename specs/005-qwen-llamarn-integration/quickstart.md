# Quickstart: Qwen3-VL Instruct via llama.rn Validation

## Prerequisites

- Physical Android 13+ device (minimum API 33) with enough memory for on-device VLM validation.
- Qwen3-VL-2B-Instruct Q4_K_M GGUF and Q8_0 projector metadata established: filenames, sizes, SHA-256 digests, and source URIs.
- EAS Build configured for temporary native Android builds while ExecuTorch and llama.rn coexist.
- USB device workflow available:

```powershell
adb reverse tcp:8081 tcp:8081
npx expo start --dev-client --clear
```

During ExecuTorch/llama.rn coexistence, do not run `npx expo run:android` or `npx expo prebuild` locally. After ExecuTorch removal, `npx expo run:android` must be re-enabled and validated on Windows, including replacing the current blocked Android script.

## Static validation

Run before device validation:

```powershell
npm test
npx tsc --noEmit
npx eslint src tests --ext .ts,.tsx
```

Expected outcome:

- All inference/model lifecycle unit tests pass.
- TypeScript strict mode passes.
- ESLint passes without `any` or unexplained `ts-ignore`.

## Native dependency validation

Before adding or upgrading llama.rn in the main app:

```powershell
findstr /r /s "ndkVersion" node_modules\llama.rn\android\*.gradle
```

Expected outcome:

- No hard requirement for NDK 27+ is introduced during coexistence.
- React Native New Architecture remains enabled.
- Any required native build plugin/config is documented in implementation tasks before install.
- The Qwen target platform remains Android 13+ / API 33 minimum.

## Migration phase 1: LFM2.5 default, Qwen internal

Build a dev client with Qwen disabled for normal users.

Validate:

1. Fresh install.
2. Complete onboarding/privacy/download flow.
3. Ask a text question.
4. Ask an image question.
5. Continue a 3-turn conversation.
6. Cancel one generation.
7. Export diagnostics.
8. Restart app and reopen history.

Expected outcome:

- Existing LFM2.5 behavior is unchanged.
- No unrelated model option appears.
- No Qwen picker or runtime switcher appears.
- No multi-model product UI appears.

## Qwen internal validation

Enable Qwen through the temporary build-time/internal startup selection.

Validate:

1. Start Qwen setup with no Qwen files present.
2. Confirm the existing download UX downloads both artifacts.
3. Confirm the GGUF and projector are independently verified.
4. Re-enter setup and confirm zero re-downloads.
5. Call `loadModel()` before each request path and confirm already-loaded Qwen returns immediately.
6. Send a text prompt and observe streamed output.
7. Send an image prompt and observe image-grounded output.
8. Send at least two follow-up turns.
9. Run extraction, extraction retry, visible answer, refusal retry, and later-turn paths where available.
10. Cancel one generation mid-stream.
11. Background and foreground the app during or after generation.

Expected outcome:

- Qwen uses existing chat UI, stores, history, image flow, diagnostics, and context orchestration.
- The existing aggregate `modelStore` UI contract is preserved; any per-artifact GGUF/projector state remains internal to the bundle manager.
- Qwen generation uses the supplied message list as the only authoritative conversation context.
- Follow-up status is not treated as proof that the model is resident.
- Stale KV/native conversation state is cleared before every generation without unloading the model, so extraction, extraction retry, visible answer, refusal retry, and later turns do not leak native context into one another.
- The 512 px preprocessing ceiling remains enforced.
- No `<think>` tags, hidden reasoning, raw model identifiers, hidden prompts, or internal stages are visible. If such output indicates the wrong model, a Thinking template, or invalid response config, validation fails instead of relying on sanitization to hide it.
- No network activity occurs during capture -> preprocess -> model -> answer -> persist.

## Failure validation

Run each failure case independently:

1. Delete the Qwen GGUF.
2. Delete the Q8_0 projector.
3. Corrupt the projector.
4. Use a mismatched projector.
5. Force device-compatibility failure.
6. Simulate OOM/load failure where possible.
7. Cancel while generation is streaming.

Expected outcome:

- The app reaches a clean recoverable state.
- The user receives a clear message.
- No crash occurs.
- No native context leaks.
- No half-loaded projector remains.
- The queue lock is released only after handling completes.

## Startup runtime selection validation

During the fallback phase:

1. Build/start with internal selection set to `executorch`.
2. Confirm only the ExecuTorch host mounts.
3. Build/start with internal selection set to `qwen-llamarn`.
4. Confirm only the Qwen llama.rn host mounts.
5. Attempt no in-process runtime switch; this path must not exist.

Expected outcome:

- Only the startup-selected host exists in the process.
- Two runtime hosts are never mounted simultaneously.
- Migration phase and parity evidence are planning/test records, not MMKV or Zustand product state.
- Normal users never see a runtime switcher.

## Performance parity validation

On the same validated device and comparable prompt/image set used by `spikes/qwen3vl-llamarn`, measure:

- Model load time.
- Comparable runtime-level vision completion time.
- Full Locra end-to-end vision latency, measured separately.
- Tokens per second.
- Memory before load, after load, after several requests, and after release.

Expected outcome:

- No unexplained regression greater than 25% from the comparable spike baseline: about 2.34s model load, 5.33s comparable runtime-level vision completion, and 35.7 tok/s.
- Full Locra end-to-end vision latency is reported separately because Locra may perform multiple inference stages and is not directly comparable to the spike's single comparable vision operation.
- Any regression over 25% has a documented explanation and explicit acceptance.
- No avoidable model reloads, duplicate preprocessing, or unnecessary generation passes are present.

## Final phase validation: Qwen-only V1

After parity approval and ExecuTorch removal:

1. Fresh install.
2. Complete the normal product flow.
3. Run text and image Q&A.
4. Continue conversation history.
5. Restart and reopen history.
6. Export diagnostics.
7. Run `npx expo run:android` on Windows.

Expected outcome:

- Qwen is the active Locra V1 runtime.
- ExecuTorch is not used for normal inference.
- ExecuTorch dependency, initialization path, model-path/configuration, and local-build restriction are removed.
- Windows local Android build works with `npx expo run:android`, and the current blocked Android script has been replaced.
- Existing conversations, diagnostics history, and non-model app state remain intact.
- No model selection, runtime switching, unrelated model option, or multi-model scenario appears.
