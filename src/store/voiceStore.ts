import { create } from 'zustand';

import type { VoiceTranscriptionHandle } from '../inference/useVoiceTranscription';

// ─────────────────────────────────────────────────────────────────────────────
// Screen-facing state for voice dictation (FR-033). Screens read from THIS store
// only, never from src/inference/ directly (Principle X). The live hook handle is
// registered by VoiceTranscriptionHost, which is mounted lazily — only once the
// user first enables voice — so the Whisper model isn't downloaded for users who
// never dictate.
// ─────────────────────────────────────────────────────────────────────────────

export type VoicePhase =
  | 'idle' // host not mounted yet (voice never used this session)
  | 'loading' // Whisper model downloading / preparing
  | 'ready' // model loaded, mic idle
  | 'recording'
  | 'transcribing'
  | 'error';

let voiceHandle: VoiceTranscriptionHandle | null = null;

function derivePhase(handle: VoiceTranscriptionHandle): VoicePhase {
  if (handle.getError() !== null) return 'error';
  if (handle.isRecording()) return 'recording';
  if (handle.isTranscribing()) return 'transcribing';
  if (handle.isReady()) return 'ready';
  return 'loading';
}

export interface VoiceStoreState {
  /** True once the user has activated voice (mounts the host + starts download). */
  enabled: boolean;
  phase: VoicePhase;
  downloadProgress: number;
  error: string | null;
  /** Activates voice: mounts the host so the Whisper model begins loading. */
  enableVoice: () => void;
  registerHandle: (handle: VoiceTranscriptionHandle | null) => void;
  /** Pushes the live handle state into the store (called by the host on change). */
  syncFromHandle: () => void;
  startRecording: () => Promise<void>;
  /** Stops + transcribes; resolves the recognized text (empty string if none). */
  stopAndTranscribe: () => Promise<string>;
  cancel: () => void;
}

export const useVoiceStore = create<VoiceStoreState>((set) => ({
  enabled: false,
  phase: 'idle',
  downloadProgress: 0,
  error: null,

  enableVoice: (): void => set({ enabled: true, phase: 'loading' }),

  registerHandle: (handle: VoiceTranscriptionHandle | null): void => {
    voiceHandle = handle;
    if (handle === null) {
      set({ phase: 'idle', downloadProgress: 0, error: null });
    } else {
      set({
        phase: derivePhase(handle),
        downloadProgress: handle.downloadProgress(),
        error: handle.getError(),
      });
    }
  },

  syncFromHandle: (): void => {
    if (voiceHandle === null) return;
    set({
      phase: derivePhase(voiceHandle),
      downloadProgress: voiceHandle.downloadProgress(),
      error: voiceHandle.getError(),
    });
  },

  startRecording: async (): Promise<void> => {
    if (voiceHandle === null) {
      throw new Error('Voice is still starting up.');
    }
    await voiceHandle.startRecording();
  },

  stopAndTranscribe: async (): Promise<string> => {
    if (voiceHandle === null) {
      return '';
    }
    return voiceHandle.stopAndTranscribe();
  },

  cancel: (): void => {
    voiceHandle?.cancelRecording();
  },
}));
