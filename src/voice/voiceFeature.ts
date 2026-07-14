// Offline voice input is gated behind an approved on-device runtime/model
// manifest (tasks T006/T073/T074). Until that runtime is installed the microphone
// is HIDDEN rather than shown as a broken feature that only ever errors. Flip this
// to `true` in the same change that wires up the real recording/transcription
// services so the control reappears with a working pipeline behind it.
export const VOICE_INPUT_ENABLED = false;
