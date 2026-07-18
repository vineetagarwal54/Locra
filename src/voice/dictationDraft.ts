// Pure, dependency-free helpers for offline voice dictation. Kept separate from
// the store/UI so the typed-prefix preservation and read-only rules are unit
// tested directly (no rendering, no native modules).

// Hard cap on a single recording. Whisper transcribes a completed utterance, and
// unbounded recordings risk memory blow-ups, so the session auto-stops at this
// limit and begins transcription.
export const MAX_RECORDING_MS = 30_000;
// During the final window before the limit, the composer shows a visible warning.
export const RECORDING_WARNING_MS = 5_000;

export type VoiceSessionStatus =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'transcribing'
  // Cancellation requested; native recorder/recognizer teardown and the exclusive
  // resource-lease release are still in flight. The composer stays LOCKED through
  // this state and only unlocks once cleanup resolves (→ 'cancelled').
  | 'cancelling'
  | 'ready'
  | 'cancelled'
  | 'failed';

/** Statuses during which the composer text field must be read-only. */
const READ_ONLY_STATUSES: ReadonlySet<VoiceSessionStatus> = new Set([
  'preparing',
  'recording',
  'transcribing',
  'cancelling',
]);

/**
 * Composes the visible draft from the text the user had already typed BEFORE
 * recording (the preserved prefix) and the current dictated segment (a partial or
 * final transcript). The dictated segment is treated as ONE replaceable unit, so
 * each incremental partial fully replaces the previous partial while never
 * touching the preserved prefix.
 */
export function joinDictation(typedPrefix: string, dictatedSegment: string): string {
  const prefix = typedPrefix;
  const segment = dictatedSegment.trim();
  if (segment === '') {
    return prefix;
  }
  if (prefix.trim() === '') {
    return segment;
  }
  // Keep exactly one separating space; respect a prefix the user ended with space.
  return /\s$/.test(prefix) ? `${prefix}${segment}` : `${prefix} ${segment}`;
}

/**
 * True while a live voice session is holding the composer: recording is capturing
 * audio or the final transcript is still settling. The field is read-only and the
 * partial transcript must not be user-editable during these states.
 */
export function isComposerReadOnlyForVoice(status: VoiceSessionStatus): boolean {
  return READ_ONLY_STATUSES.has(status);
}

/** True when a session is in flight (used to disable Send and image controls). */
export function isVoiceSessionActive(status: VoiceSessionStatus): boolean {
  return isComposerReadOnlyForVoice(status);
}
