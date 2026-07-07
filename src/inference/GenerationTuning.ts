import type { GenerationConfig } from 'react-native-executorch';

// Device-TUNABLE generation defaults — not ground truth. Only fields verified
// present on the installed react-native-executorch 0.9.2 GenerationConfig may
// appear here (checked directly against
// node_modules/react-native-executorch/lib/typescript/types/llm.d.ts on
// 2026-07-06): temperature, topP, minP, repetitionPenalty, outputTokenBatchSize,
// batchTimeInterval. There is still no `topK`, no native maximum-output, and no
// sequence-length field on this version — output length is a device-tunable
// app-level cap instead (OUTPUT_TOKEN_BUDGET, enforced in InferenceQueue).
//
// These numbers are tuned for a bold, expansive personal assistant: warmer and
// wider than the model card's own {temperature: 0.1, minP: 0.15} so answers can
// range and surprise. Treat them as a starting point to adjust per device/taste,
// not as fixed constants.

export const LOCRA_GENERATION_CONFIG: GenerationConfig = {
  temperature: 0.7, // imaginative and confident, vs. the clipped model-card 0.1
  topP: 0.95, // wide nucleus so answers can wander somewhere interesting
  minP: 0.05, // keep a low floor rather than the model card's aggressive 0.15
  repetitionPenalty: 1.05, // still guards the small-model looping tail
};

/**
 * App-level output cap (there is no native max-tokens setting to configure on
 * this library version). Once the engine reports this many generated tokens
 * mid-stream, InferenceQueue stops generation and completes with the partial
 * answer plus a visible notice. Sized for expansive, multi-paragraph answers —
 * device-tunable, raise or lower to taste.
 */
export const OUTPUT_TOKEN_BUDGET = 640;

export const OUTPUT_LIMIT_NOTICE =
  'Locra reached its length limit here — ask it to keep going for more.';

export const TRUNCATED_ANSWER_NOTICE =
  'This answer may have been cut off before it finished.';

export const LOOPING_ANSWER_NOTICE =
  'This answer started repeating itself, so Locra trimmed it.';
