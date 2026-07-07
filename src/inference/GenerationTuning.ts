import type { GenerationConfig } from 'react-native-executorch';

// FR-051: generation settings tuned for grounded, non-rambling visual answers.
// ONLY the fields verified to exist on the installed react-native-executorch
// 0.9.2 GenerationConfig may appear here (research.md "Phase 3 API
// Verification"): temperature, topP, minP, repetitionPenalty,
// outputTokenBatchSize, batchTimeInterval. There is no native maximum-output
// or sequence-length field on this version — output length is enforced at the
// app level instead (FR-052, see OUTPUT_TOKEN_BUDGET and InferenceQueue).

export const LOCRA_GENERATION_CONFIG: GenerationConfig = {
  temperature: 0.35,
  repetitionPenalty: 1.05,
  minP: 0.05,
};

/**
 * FR-052: app-level output cap. Once the engine reports this many generated
 * tokens mid-stream, the InferenceQueue aborts generation and completes with
 * the partial answer plus a visible notice — because the installed library
 * has no native "stop after N tokens" setting to configure.
 */
export const OUTPUT_TOKEN_BUDGET = 256;

export const OUTPUT_LIMIT_NOTICE =
  'Locra paused this answer at its length limit so it stays concise.';

export const TRUNCATED_ANSWER_NOTICE =
  'This answer may have been cut off before it finished.';

export const LOOPING_ANSWER_NOTICE =
  'This answer started repeating itself, so Locra trimmed it.';
