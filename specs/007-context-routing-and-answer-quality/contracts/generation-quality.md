# Contract: Generation Quality

**Modules**: `GenerationTuning.ts`, `InferenceQueue.ts`,
`QwenLlamaRuntime.ts`, and `AnswerPostProcessor.ts`

## Generation plan

```ts
interface GenerationPlan {
  softTargetTokens: number;
  hardSafetyLimitTokens: number;
  samplingProfile: SamplingProfile;
  loopDetectionEligible: boolean;
  diagnosticsId: string;
  taskKind: GenerationTaskKind;
}
```

- Classification changes the soft target for normal visible prose.
- Normal factual answers, explanations, follow-ups, comparisons, image
  descriptions, unbounded visual extraction, long synthesis, and continuations
  retain the response-mode hard safety maximum: Low 320, Medium 640, High 1024.
- Reduced native caps apply only to structurally bounded outputs such as yes/no,
  one value, fixed-schema extraction, or an explicitly bounded list.
- Visible prose satisfies `hardSafetyLimitTokens > softTargetTokens` and should
  retain at least 128 tokens of completion headroom.
- Continuations use the full response-mode maximum, preserve the existing answer
  seed, and avoid repeating already displayed text.
- One authoritative effective limit flows to native `n_predict`.

Diagnostics separately record `responseModeHardMaximum`,
`effectiveNativeGenerationLimit`, `softTargetTokens`, and `generationPlanId`.
The effective value must equal the `n_predict` value used by the runtime.

## Finish reasons and post-processing

- Native `stopped_limit` and an exhausted `n_predict` remain `length`.
- EOS or a native stop word remains `natural`.
- A loop-detector stop remains `looping`.
- User cancellation remains `cancelled`.
- Length-truncated text is preserved, receives the visible truncation notice,
  and alone exposes the continue action.
- The final buffer receives one normal post-processing pass.

`QwenLlamaRuntime` is the single owner of loop-triggered native
`stopCompletion()`. Queue code does not issue a duplicate stop. Deterministic
mock coverage is complete, while physical stop/lease/cancellation acceptance
remains open under T034.

## Validation

Unit and integration tests cover plan invariants, continuation headroom,
native-limit propagation, diagnostic agreement, finish reasons, and prompt
assembly. Physical MV-011/T034 validation remains required and must reject any
mid-sentence or mid-list ending caused by a hard cap.
