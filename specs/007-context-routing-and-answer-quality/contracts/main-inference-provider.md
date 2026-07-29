# Contract: Model-Independent Main Inference Provider

Locra continues to use the current Qwen3-VL model in this phase. This boundary
allows a future Qwen3.5 or other compatible multimodal model to replace it
without redesigning planning, memory, retrieval, image evidence, context
ranking, storage, or diagnostics.

## Capability descriptor

```ts
interface MainInferenceProvider {
  getCapabilities(): MainModelCapabilities;
  countPromptTokens(input: PromptTokenizationInput, signal: AbortSignal):
    Promise<PromptTokenizationResult>;
  generate(input: PlannedGenerationInput, signal: AbortSignal):
    AsyncIterable<GenerationEvent>;
  extractStructured(input: PlannedExtractionInput, signal: AbortSignal):
    Promise<StructuredExtractionResult>;
}

interface MainModelCapabilities {
  readonly providerId: string;
  readonly modelDescriptor: string;
  readonly supportsTextGeneration: boolean;
  readonly supportsImageInput: boolean;
  readonly supportsStructuredExtraction: boolean;
  readonly contextLimitTokens: number;
  readonly generationLimits: GenerationLimitDescriptor;
  readonly tokenizerDescriptor: string;
  readonly projectorRequirements: readonly string[];
  readonly runtimeCompatibility: string;
  readonly cancellation: CancellationCapability;
  readonly supportedPromptFormats: readonly string[];
}
```

## Invariants

- Prompt assembly and token verification use the selected provider's native
  tokenizer capability; Qwen-specific constants do not define the application
  architecture.
- The provider executes a validated `TurnPlan` and `VisionExecutionPlan`; it does
  not reclassify intent, dependencies, references, retrieval scope, or image
  strategy.
- A provider lacking a required capability causes plan validation or execution
  fallback before unsafe generation. An image-required turn never becomes a
  silent text-only call.
- All provider calls that perform inference use the existing single-flight
  queue, support cancellation, persist terminal outcomes, and degrade without
  crashing.
- Provider-specific prompt templates, tokenizer behavior, projector assets, and
  runtime details remain behind this boundary.
- Switching the main provider does not change canonical messages, ledger state,
  memory schemas, retrieval-unit schemas, embedding indexes, or evidence
  provenance.
- Changing the main provider does not require re-embedding memories. Re-embedding
  is required only when the active embedding provider/index descriptor changes.
