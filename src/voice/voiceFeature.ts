// Offline voice input is fully wired to the real Sherpa-ONNX streaming runtime
// (see SherpaVoiceRuntime.ts + VoiceSessionService.ts), but stays HIDDEN until the
// native packages (`@siteed/sherpa-onnx.rn`, `@siteed/audio-studio`) are installed
// and an Android release build + physical-device validation (T092) pass. Showing a
// microphone that cannot record is worse than hiding it, so this remains `false`
// until that on-device validation succeeds — do NOT flip it on a JS-only change.
export const VOICE_INPUT_ENABLED = false;
