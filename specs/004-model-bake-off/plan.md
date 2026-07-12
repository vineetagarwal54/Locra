# Implementation Plan: Runtime Model Choice

## Approach

Keep `ActiveModel.ts` as a lazy two-model descriptor registry, but remove its eager
singleton. Add an MMKV-backed Zustand selection store that resolves persisted selection
during bootstrap and optionally applies `EXPO_PUBLIC_LOCRA_VLM` as a developer override.

Recreate the model lifecycle manager whenever the selected descriptor changes. Inject
the descriptor's sources, filename, integrity endpoint/fallback, size, presentation data,
and attribution. Filename-scoped reconciliation preserves coexistence and prevents one
model from satisfying the other's readiness check.

Mount the existing single `InferenceEngineHost` only when the selected lifecycle is
verified. Pass its descriptor into the existing sole `useInferenceEngine`/`useLLM` call.
During a Settings switch, set a pending target first, which removes the host; commit the
MMKV selection in the following effect, initialize the target lifecycle, reconcile, and
route to setup or success.

## Boundaries

- Screens render state and invoke store/coordinator actions only.
- Model lifecycle remains self-contained and has no UI imports.
- Inference continues to use one queue and one host.
- MMKV remains the only persistence implementation.
- No prompt, context, preprocessing, history, evaluation-case, or theme changes.

## Verification

Run the four focused behavior areas, TypeScript, ESLint, and the full Jest suite. Local
Android builds remain prohibited; device verification uses one EAS-built APK.
