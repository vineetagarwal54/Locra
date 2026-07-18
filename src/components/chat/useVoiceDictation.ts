import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useVoiceStore } from '../../store/voiceStore';
import {
  isComposerReadOnlyForVoice,
  isVoiceSessionActive,
  joinDictation,
  MAX_RECORDING_MS,
  RECORDING_WARNING_MS,
  type VoiceSessionStatus,
} from '../../voice/dictationDraft';
import { VOICE_INPUT_ENABLED } from '../../voice/voiceFeature';

export type VoiceMicMode = 'idle' | 'recording' | 'transcribing';

export interface VoiceDictation {
  /** Whether the mic should be shown at all (feature flag + runtime readiness). */
  readonly enabled: boolean;
  /** The composer text field must be read-only while this is true. */
  readonly readOnly: boolean;
  /** A live session holds the composer (disable Send and image controls). */
  readonly active: boolean;
  readonly micMode: VoiceMicMode;
  readonly elapsedLabel: string;
  /** True during the final seconds before the hard recording limit auto-stops. */
  readonly nearLimit: boolean;
  /** Whole seconds left before the auto-stop limit (only meaningful while recording). */
  readonly secondsRemaining: number;
  readonly onMicPress: () => void;
  readonly onCancel: () => void;
  readonly sessionStatus: VoiceSessionStatus;
}

/**
 * Wires the voice store into the composer draft: preserves the text typed BEFORE
 * recording, leaves the draft untouched WHILE recording (there are no live
 * partials), restores the original text on cancel/failure, and applies the single
 * final transcript once the session reaches 'ready' — WITHOUT ever submitting the
 * message. The same 'ready' path covers a manual stop and the 30 s auto-stop.
 */
export function useVoiceDictation(params: {
  draftText: string;
  setDraftText: (text: string) => void;
}): VoiceDictation {
  const { draftText, setDraftText } = params;
  const sessionStatus = useVoiceStore((state) => state.sessionStatus);
  const recordingElapsedMs = useVoiceStore((state) => state.recordingElapsedMs);
  const startRecording = useVoiceStore((state) => state.startRecording);
  const stopAndFinalize = useVoiceStore((state) => state.stopAndFinalize);
  const cancel = useVoiceStore((state) => state.cancel);
  const acknowledgeResult = useVoiceStore((state) => state.acknowledgeResult);

  // The text the user had typed before recording began — never overwritten while
  // recording (the draft is NOT modified during recording), only appended to when
  // the single final transcript arrives on stop.
  const typedPrefixRef = useRef('');
  const setDraftTextRef = useRef(setDraftText);
  setDraftTextRef.current = setDraftText;
  const acknowledgeResultRef = useRef(acknowledgeResult);
  acknowledgeResultRef.current = acknowledgeResult;

  // A failed session preserves the user's original typed text (FR recovery).
  useEffect(() => {
    if (sessionStatus === 'failed') {
      setDraftTextRef.current(typedPrefixRef.current);
    }
  }, [sessionStatus]);

  // Apply the single final transcript when the session reaches 'ready'. This is
  // the ONE place text is written, so a manual Stop and the 30 s auto-stop behave
  // identically (and it never fires more than once per session).
  useEffect(() => {
    if (sessionStatus !== 'ready') {
      return;
    }
    const finalTranscript = useVoiceStore.getState().finalTranscript;
    if (finalTranscript !== '') {
      setDraftTextRef.current(joinDictation(typedPrefixRef.current, finalTranscript));
    }
    acknowledgeResultRef.current();
  }, [sessionStatus]);

  const onMicPress = useCallback((): void => {
    if (sessionStatus === 'recording') {
      // Just request the stop; the 'ready' effect above applies the transcript.
      void stopAndFinalize();
      return;
    }
    // Starting: capture the current typed text as the preserved prefix.
    typedPrefixRef.current = draftText;
    void startRecording();
  }, [draftText, sessionStatus, startRecording, stopAndFinalize]);

  const onCancel = useCallback((): void => {
    // Restore the pre-recording text immediately, keep the composer locked while
    // native teardown + lease release run, then return the machine to idle.
    setDraftTextRef.current(typedPrefixRef.current);
    void cancel().then(() => acknowledgeResult());
  }, [acknowledgeResult, cancel]);

  // Cancel + await native cleanup when the app backgrounds or the composer
  // unmounts mid-session, so the recorder/recognizer and the exclusive voice-input
  // lease are always released even if the user never taps cancel/stop (item 10).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && isVoiceSessionActive(useVoiceStore.getState().sessionStatus)) {
        void cancel();
      }
    });
    return () => {
      subscription.remove();
      if (isVoiceSessionActive(useVoiceStore.getState().sessionStatus)) {
        void cancel();
      }
    };
  }, [cancel]);

  const readOnly = isComposerReadOnlyForVoice(sessionStatus);
  const isRecording = sessionStatus === 'recording';
  const secondsRemaining = Math.max(0, Math.ceil((MAX_RECORDING_MS - recordingElapsedMs) / 1000));
  const nearLimit = isRecording && recordingElapsedMs >= MAX_RECORDING_MS - RECORDING_WARNING_MS;
  return {
    enabled: VOICE_INPUT_ENABLED,
    readOnly,
    active: readOnly,
    micMode:
      isRecording
        ? 'recording'
        : sessionStatus === 'preparing' || sessionStatus === 'transcribing'
          ? 'transcribing'
          : 'idle',
    elapsedLabel: formatElapsed(recordingElapsedMs),
    nearLimit,
    secondsRemaining,
    onMicPress,
    onCancel,
    sessionStatus,
  };
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
