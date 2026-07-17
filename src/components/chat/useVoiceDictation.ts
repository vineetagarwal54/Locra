import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useVoiceStore } from '../../store/voiceStore';
import {
  isComposerReadOnlyForVoice,
  isVoiceSessionActive,
  joinDictation,
  type VoiceSessionStatus,
} from '../../voice/dictationDraft';
import { VOICE_INPUT_ENABLED } from '../../voice/voiceFeature';

export type VoiceMicMode = 'idle' | 'recording' | 'transcribing';

export interface VoiceDictation {
  /** Whether the mic should be shown at all (feature flag + runtime readiness). */
  readonly enabled: boolean;
  /** The composer text field must be read-only while this is true. */
  readonly readOnly: boolean;
  /** A live session holds the composer (disable Send / image / past-chat). */
  readonly active: boolean;
  readonly micMode: VoiceMicMode;
  readonly elapsedLabel: string;
  readonly onMicPress: () => void;
  readonly onCancel: () => void;
  readonly sessionStatus: VoiceSessionStatus;
}

/**
 * Wires the voice store into the composer draft: preserves the text typed BEFORE
 * recording, streams partial transcripts into the active dictated segment while
 * recording, restores the original text on cancel/failure, and applies the final
 * transcript on stop — WITHOUT ever submitting the message.
 */
export function useVoiceDictation(params: {
  draftText: string;
  setDraftText: (text: string) => void;
}): VoiceDictation {
  const { draftText, setDraftText } = params;
  const sessionStatus = useVoiceStore((state) => state.sessionStatus);
  const partialTranscript = useVoiceStore((state) => state.partialTranscript);
  const recordingElapsedMs = useVoiceStore((state) => state.recordingElapsedMs);
  const startRecording = useVoiceStore((state) => state.startRecording);
  const stopAndFinalize = useVoiceStore((state) => state.stopAndFinalize);
  const cancel = useVoiceStore((state) => state.cancel);
  const acknowledgeResult = useVoiceStore((state) => state.acknowledgeResult);

  // The text the user had typed before recording began — never overwritten by the
  // dictated segment. A ref (not state) so partial updates don't need re-binding.
  const typedPrefixRef = useRef('');
  const setDraftTextRef = useRef(setDraftText);
  setDraftTextRef.current = setDraftText;

  // Stream partials into the draft only while actively recording; the final text
  // is applied explicitly on stop so there is no double-write.
  useEffect(() => {
    if (sessionStatus === 'recording') {
      setDraftTextRef.current(joinDictation(typedPrefixRef.current, partialTranscript));
    }
  }, [sessionStatus, partialTranscript]);

  // A failed session preserves the user's original typed text (FR recovery).
  useEffect(() => {
    if (sessionStatus === 'failed') {
      setDraftTextRef.current(typedPrefixRef.current);
    }
  }, [sessionStatus]);

  const onMicPress = useCallback((): void => {
    if (sessionStatus === 'recording') {
      void stopAndFinalize().then((finalTranscript) => {
        if (finalTranscript !== '') {
          setDraftTextRef.current(joinDictation(typedPrefixRef.current, finalTranscript));
        }
        acknowledgeResult();
      });
      return;
    }
    // Starting: capture the current typed text as the preserved prefix.
    typedPrefixRef.current = draftText;
    void startRecording();
  }, [acknowledgeResult, draftText, sessionStatus, startRecording, stopAndFinalize]);

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
  return {
    enabled: VOICE_INPUT_ENABLED,
    readOnly,
    active: readOnly,
    micMode:
      sessionStatus === 'recording'
        ? 'recording'
        : sessionStatus === 'preparing' || sessionStatus === 'transcribing'
          ? 'transcribing'
          : 'idle',
    elapsedLabel: formatElapsed(recordingElapsedMs),
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
