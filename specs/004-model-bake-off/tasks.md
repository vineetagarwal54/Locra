# Tasks: Runtime Model Choice

- [X] T001 Replace the eager active-model singleton with a lazy two-model registry.
- [X] T002 Add MMKV-backed bootstrap, persisted selection, and developer override behavior.
- [X] T003 Add first-launch routing and the onboarding model-selection screen.
- [X] T004 Recompose lifecycle, integrity, storage, and presentation from the selected descriptor.
- [X] T005 Pass the selected descriptor into the single inference host and attribution paths.
- [X] T006 Add confirmed Settings switching with inference/download guards and host unmount handshake.
- [X] T007 Preserve foreign model files and reuse verified selected-model files without fetching.
- [X] T008 Remove the normal Gemma-specific EAS profile and document one-APK testing.
- [X] T009 Add minimal tests for persistence/routing, lifecycle isolation, one host, and no redownload.
- [X] T010 Run TypeScript, ESLint, focused tests, and full Jest verification.

Validation note: TypeScript, ESLint, and 53 focused tests pass. The full suite has
the same eight pre-existing prompt/context expectation failures outside Feature 004.
