# Contract: Qwen llama.rn Runtime

## Purpose

Defines the internal inference-runtime boundary for Qwen3-VL-2B-Instruct. This contract is consumed by the existing inference queue and runtime host, not by screens.

## Public interface

```ts
type QwenRuntimeStatus =
  | 'unloaded'
  | 'loading'
  | 'loaded'
  | 'generating'
  | 'cancelling'
  | 'releasing'
  | 'errored';

interface QwenRuntimeLoadRequest {
  modelPath: string;
  projectorPath: string;
  config: QwenRuntimeConfig;
}

interface QwenRuntimeGenerateRequest {
  messages: AuthoritativeMessageContext;
  signal: AbortSignal;
  onToken: (cumulativeText: string, generatedTokenCount?: number) => void;
}

interface QwenRuntimeGenerateResult {
  text: string;
  promptTokens: number;
  generatedTokens: number;
  totalTokens: number;
  tokensPerSecond: number;
  firstTokenLatencyMs: number;
  totalWallTimeMs: number;
}

interface QwenRuntime {
  loadModel(request: QwenRuntimeLoadRequest): Promise<void>;
  generate(request: QwenRuntimeGenerateRequest): Promise<QwenRuntimeGenerateResult>;
  cancel(): void;
  release(): Promise<void>;
  getStatus(): QwenRuntimeStatus;
}
```

## Preconditions

- `loadModel()` may run only after both Qwen artifacts are independently verified.
- `loadModel()` may run only on supported Android 13+ / API 33 devices.
- `loadModel()` is idempotent. Every request may call it; if the model and projector are already loaded for the verified artifact set, it returns immediately without reloading, duplicate projector initialization, or native state corruption.
- `loadModel()` must be called only by the selected startup host. Startup selection is build-time/internal process-start only; runtime switching while the process is running is not supported.
- `loadModel()` must use the spike-validated CPU-only config: `n_ctx: 4096`, `n_gpu_layers: 0`, `ctx_shift: false`, `use_mlock: false`, projector `use_gpu: false`, default `n_predict: 512`, validated `n_predict` options `256/512/1024`, `temperature: 0`, no explicit stop-token list, and no custom chat template unless later implementation verification records a justified change.
- `generate()` may run only after private in-memory engine state confirms the model is loaded and multimodal vision support is confirmed.
- The caller must supply the full authoritative message context for every `generate()` call.
- The caller must hold the existing single-flight inference queue lock before preprocessing and generation.
- Follow-up/conversation status must not be used as proof that the model is resident.

## Postconditions

- A successful `loadModel()` leaves exactly one loaded llama.rn context and initialized projector.
- A failed projector init releases any half-initialized projector/context before returning an error.
- Before every `generate()`, stale KV cache and native conversation state are cleared without unloading the model.
- Extraction, extraction retry, visible answer generation, refusal retry, and later turns cannot leak native context into one another.
- `generate()` does not depend on hidden native chat history; the supplied message list is the only authoritative conversation context.
- `generate()` streams cumulative text through `onToken`.
- `cancel()` stops generation cleanly and leaves the runtime usable or releases it to a clean error state.
- `release()` attempts projector release before context release and leaves `getStatus() === 'unloaded'`.

## Output rules

- Returned text must not include `<think>` tags, hidden reasoning blocks, raw model identifiers, hidden prompts, or internal inference-stage markers.
- Thinking-specific spike behavior must not be copied.
- Output sanitization is only a narrow defensive guard for accidental control tags. It must not hide use of the wrong model, a Thinking template, or invalid response configuration; those are validation failures.
- Qwen-specific chat template handling is allowed only if implementation verification proves it is required for correct Instruct behavior. The spike configured no custom chat template.

## Error handling

- Missing files, corrupt files, projector mismatch, OOM, load failure, projector init failure, and cancellation must resolve to typed/user-legible errors at the queue/store boundary.
- Native errors must not be allowed to crash the app.
- No error path may leak a native context.
