import { useEffect } from 'react';

import { useVoiceTranscription } from '../inference/useVoiceTranscription';
import { useVoiceStore } from '../store/voiceStore';

/**
 * Mounts the one sanctioned voice hook (`useSpeechToText` + `useAudioStream`) and
 * registers its plain handle with the voice store. Rendered lazily — only once
 * the user enables voice — so the Whisper model download does not run for users
 * who never dictate. Screens drive voice through the store only (Principle X).
 */
export function VoiceTranscriptionHost() {
  const registerHandle = useVoiceStore((s) => s.registerHandle);
  const handle = useVoiceTranscription();

  useEffect(() => {
    registerHandle(handle);
    return () => registerHandle(null);
  }, [handle, registerHandle]);

  useEffect(() => {
    return handle.subscribe(() => useVoiceStore.getState().syncFromHandle());
  }, [handle]);

  return null;
}
