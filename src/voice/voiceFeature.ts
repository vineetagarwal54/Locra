// Offline voice input is fully wired to the real Sherpa-ONNX streaming runtime
// (see SherpaVoiceRuntime.ts + VoiceSessionService.ts + VoiceComposition.ts) and
// enabled: the Android release build (assembleRelease) compiled the native
// packages (`@siteed/sherpa-onnx.rn`, `@siteed/audio-studio`) and the resulting
// APK bundles the real libsherpa-onnx-jni / libonnxruntime / libaudio-studio-cpp
// libraries. With this true, the microphone appears in the composer's right-side
// column directly above Send.
//
// On-device validation (Settings → "Voice validation", the T092 gate) still needs
// to confirm real streaming metrics + airplane-mode operation on hardware; if that
// surfaces a problem, flip this back to false to hide the mic without reverting the
// implementation.
export const VOICE_INPUT_ENABLED = true;
