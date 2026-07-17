// The isolated integration boundary for offline streaming voice input.
//
// Everything above this line (store, services, UI) depends ONLY on these
// interfaces — never on the native speech/audio packages directly. The real
// implementation that wires `whisper.rn` + `@siteed/audio-studio`
// lives in WhisperVoiceRuntime.ts and satisfies these contracts; tests inject
// fakes. This keeps the whole pipeline testable without the native modules and
// lets the recognizer/model be swapped without touching callers.

/** A live recording + streaming-recognition session (one exclusive voice-input hold). */
export interface VoiceSession {
  /**
   * Subscribes to incremental partial transcripts emitted while audio streams in.
   * Each call delivers the CURRENT best partial for the active dictated segment
   * (not a delta) so callers can replace the segment wholesale.
   */
  onPartial(listener: (partialText: string) => void): void;
  /** Stops capture, flushes the recognizer, and resolves the finalized transcript. */
  stop(): Promise<string>;
  /** Aborts capture/recognition without producing a transcript. */
  cancel(): Promise<void> | void;
  /**
   * Releases the recognizer and recorder and deletes any temporary audio. Safe to
   * call more than once and after stop/cancel; never throws.
   */
  release(): Promise<void> | void;
}

/** Starts a fully-initialized live voice session (model load + mic stream + recognizer). */
export interface VoiceSessionRuntime {
  /** Whether the native speech/audio runtime is actually present and usable. */
  isAvailable(): boolean;
  /** Initializes the recognizer/recorder and begins streaming. */
  start(): Promise<VoiceSession>;
}
