# Contract: Migration and Parity

## Purpose

Defines the planning/test migration phases from LFM2.5/ExecuTorch to Qwen/llama.rn and the acceptance gates for making Qwen the active V1 runtime. These phase records are not new MMKV or Zustand product state.

## Migration phases

```ts
type MigrationPhase =
  | 'lfm_default_qwen_internal'
  | 'qwen_internal_validated'
  | 'qwen_only';
```

Runtime selection during migration is a build-time or internal process-start value such as `executorch` or `qwen-llamarn`. Only the selected host mounts for the process, and runtime switching while the process is running is not supported.

## Phase rules

### `lfm_default_qwen_internal`

- Normal users continue to use the existing LFM2.5/ExecuTorch path.
- Qwen is reachable only through a temporary build-time or internal development flag.
- No normal-user model picker, runtime switcher, unrelated model option, or multi-model UI may appear.

### `qwen_internal_validated`

- Qwen is validated through the internal startup selection after parity evidence is collected.
- ExecuTorch may remain only as a separate startup-selected fallback while final migration work is pending.
- Both runtime hosts must never be mounted in the same app process.
- Normal users still must not see runtime switching.
- EAS Build remains the temporary native build path while both dependencies coexist.

### `qwen_only`

- Qwen is the only normal runtime path.
- ExecuTorch is removed from dependencies, initialization paths, model-path/configuration, and final runtime path.
- The current blocked local Android script is replaced and Windows local Android builds using `npx expo run:android` are re-enabled and validated.
- Existing user conversations, diagnostics, and non-model app state remain intact.

## Parity gates

Qwen reaches parity only when all of the following pass:

- Existing LFM2.5 normal-user journeys remain unchanged during migration.
- Qwen text generation streams through the existing chat UI and persists to existing history.
- Qwen image Q&A uses the existing image flow and 512 px preprocessing ceiling.
- Qwen follow-up turns use supplied messages as authoritative context.
- Cancellation, missing files, corrupt files, projector failures, incompatible device, OOM, and app background/foreground produce clean recoverable states.
- No network activity occurs in the inference path.
- No hidden reasoning, Thinking tags, raw model ids, hidden prompts, or internal stages are visible in product UI. A narrow defensive control-tag guard is allowed, but it must not hide a wrong model, Thinking template, or invalid response configuration.
- Physical-device performance has no unexplained regression greater than 25% against the validated spike baseline on the same device and prompt/image set for comparable runtime-level operations: about 2.34s model load, 5.33s comparable runtime-level vision completion, and 35.7 tok/s.
- Full Locra end-to-end vision latency is measured separately because Locra may perform multiple inference stages and must not be compared directly against the spike's single comparable vision operation.
- Windows local Android build restoration is complete after ExecuTorch removal: `npx expo run:android` succeeds and the blocked Android script has been replaced.

## Runtime exclusivity

- Only the startup-selected host may mount in a given process.
- There is no in-process runtime switching path.
- Qwen runtime ownership is private in-memory engine state; it must not become persisted product state.
- Runtime ownership may be represented in diagnostics only at the approved aggregate level and without exposing raw developer internals in product UI.
