// Offline voice input is fully wired to the real whisper.rn (whisper.cpp) runtime
// (see WhisperVoiceRuntime.ts + VoiceSessionService.ts + VoiceComposition.ts). The
// Android release build compiled the native packages (`whisper.rn`,
// `@siteed/audio-studio`), so the microphone is enabled here to allow on-device
// validation (Settings → "Voice validation", the T092 gate). If that validation
// surfaces a problem, flip this back to `false` to hide the mic without reverting
// the implementation.
export const VOICE_INPUT_ENABLED = true;
