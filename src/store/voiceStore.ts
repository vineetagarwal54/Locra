import { create } from 'zustand';

import { deviceResourcePolicy } from '../inference/DeviceResourcePolicy';
import type { VoiceSessionStatus } from '../voice/dictationDraft';
import {
  VoiceModelLifecycle,
  type VoiceModelState,
} from '../voice/VoiceModelLifecycle';
import { voicePermissionAdapter } from '../voice/voicePermission';
import type { VoiceSession, VoiceSessionRuntime } from '../voice/VoiceSession';
import { VoiceSessionService } from '../voice/VoiceSessionService';

interface VoiceDependencies {
  lifecycle: VoiceModelLifecycle;
  session: VoiceSessionService;
}

export interface VoiceStoreState extends VoiceModelState {
  readonly disclosureVisible: boolean;
  /** Live session state machine, independent of the model-setup lifecycle. */
  readonly sessionStatus: VoiceSessionStatus;
  /** Current best partial transcript for the active dictated segment. */
  readonly partialTranscript: string;
  readonly recordingElapsedMs: number;
  readonly sessionError: string | null;
  readonly storageBytes: number | null;
  showDisclosure(): void;
  hideDisclosure(): void;
  clearError(): void;
  confirmEnable(): Promise<void>;
  removeModel(): Promise<void>;
  startRecording(): Promise<void>;
  /** Stops, finalizes, and returns the transcript. NEVER submits a message. */
  stopAndFinalize(): Promise<string>;
  /**
   * Cancels an in-flight session and AWAITS native recorder/recognizer teardown +
   * lease release before resolving. The composer stays locked ('cancelling') for
   * the whole duration and only unlocks once this resolves ('cancelled').
   */
  cancel(): Promise<void>;
  /** Returns the session machine to idle once the composer has consumed the result. */
  acknowledgeResult(): void;
}

let dependencies = createUnavailableDependencies();
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let recordingStartedAt = 0;

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  ...dependencies.lifecycle.getState(),
  disclosureVisible: false,
  sessionStatus: 'idle',
  partialTranscript: '',
  recordingElapsedMs: 0,
  sessionError: null,
  storageBytes: dependencies.lifecycle.storageBytes,
  showDisclosure: (): void => set({ disclosureVisible: true, error: null, sessionError: null }),
  hideDisclosure: (): void => set({ disclosureVisible: false }),
  clearError: (): void => set({ error: null, sessionError: null }),
  confirmEnable: async (): Promise<void> => {
    set({ disclosureVisible: false, error: null, sessionError: null });
    try {
      // Ask for microphone access up front — as part of the single "Download &
      // enable" tap — so the user is never surprised by a separate permission
      // prompt the first time they later press the mic.
      const permissionGranted = await dependencies.lifecycle.requestMicPermission();
      if (!permissionGranted) {
        set({
          ...dependencies.lifecycle.getState(),
          sessionStatus: 'failed',
          sessionError:
            'Microphone permission is needed for voice input. Turn it on in Android settings, then try again.',
        });
        return;
      }
      await dependencies.lifecycle.enable();
    } finally {
      set({ ...dependencies.lifecycle.getState() });
    }
  },
  removeModel: async (): Promise<void> => {
    await dependencies.lifecycle.remove();
    set({ ...dependencies.lifecycle.getState(), sessionStatus: 'idle', partialTranscript: '' });
  },
  startRecording: async (): Promise<void> => {
    const modelStatus = get().status;
    // Enable/download already running from a previous tap — don't stack another
    // disclosure or download (this is what caused "tap download twice").
    if (modelStatus === 'downloading' || modelStatus === 'verifying') {
      return;
    }
    if (modelStatus !== 'ready') {
      get().showDisclosure();
      return;
    }
    const permissionGranted =
      get().permissionGranted || (await dependencies.lifecycle.requestMicPermission());
    if (!permissionGranted) {
      set({
        permissionGranted: false,
        sessionStatus: 'failed',
        sessionError: 'Microphone permission is required for voice input.',
      });
      return;
    }
    set({
      sessionStatus: 'preparing',
      partialTranscript: '',
      recordingElapsedMs: 0,
      sessionError: null,
      permissionGranted: true,
    });
    try {
      await dependencies.session.start((partialText) => {
        // Each partial fully replaces the active segment; the composer keeps the
        // user's typed prefix and only swaps the dictated part.
        set({ partialTranscript: partialText });
      });
      startElapsedTimer(set);
      set({ sessionStatus: 'recording' });
    } catch (error) {
      stopElapsedTimer();
      set({ sessionStatus: 'failed', sessionError: toMessage(error), partialTranscript: '' });
    }
  },
  stopAndFinalize: async (): Promise<string> => {
    if (get().sessionStatus !== 'recording') {
      return '';
    }
    stopElapsedTimer();
    set({ sessionStatus: 'transcribing' });
    try {
      const transcript = (await dependencies.session.stop()).trim();
      if (transcript === '') {
        // Recorded fine but whisper found no speech (silence / too short / too
        // quiet). Give clear feedback instead of silently doing nothing.
        set({
          sessionStatus: 'failed',
          sessionError: 'No speech detected. Tap the mic and speak clearly, then stop.',
        });
        return '';
      }
      // 'ready' — the finalized text is now in the draft; stopping never sends.
      set({ sessionStatus: 'ready', partialTranscript: transcript });
      return transcript;
    } catch (error) {
      set({ sessionStatus: 'failed', sessionError: toMessage(error) });
      return '';
    }
  },
  cancel: async (): Promise<void> => {
    const status = get().sessionStatus;
    // Only a live session can be cancelled; ignore a repeat cancel already in flight.
    if (status !== 'preparing' && status !== 'recording' && status !== 'transcribing') {
      return;
    }
    stopElapsedTimer();
    // Enter the locked 'cancelling' state immediately; the composer stays read-only
    // until the awaited native teardown + lease release below completes.
    set({ sessionStatus: 'cancelling', partialTranscript: '', recordingElapsedMs: 0 });
    try {
      await dependencies.session.cancel();
    } finally {
      set({ sessionStatus: 'cancelled' });
    }
  },
  acknowledgeResult: (): void => {
    set({ sessionStatus: 'idle', partialTranscript: '', sessionError: null });
  },
}));

let unsubscribeLifecycle = subscribeToLifecycle(dependencies.lifecycle);

export function configureVoiceDependencies(next: VoiceDependencies): void {
  unsubscribeLifecycle();
  stopElapsedTimer();
  dependencies = next;
  useVoiceStore.setState({
    ...next.lifecycle.getState(),
    storageBytes: next.lifecycle.storageBytes,
    sessionStatus: 'idle',
    partialTranscript: '',
    recordingElapsedMs: 0,
    sessionError: null,
    error: null,
  });
  unsubscribeLifecycle = subscribeToLifecycle(next.lifecycle);
}

function subscribeToLifecycle(lifecycle: VoiceModelLifecycle): () => void {
  return lifecycle.subscribe((state) => {
    useVoiceStore.setState({ ...state, storageBytes: lifecycle.storageBytes });
  });
}

function startElapsedTimer(set: (patch: Partial<VoiceStoreState>) => void): void {
  stopElapsedTimer();
  recordingStartedAt = Date.now();
  elapsedTimer = setInterval(() => {
    set({ recordingElapsedMs: Date.now() - recordingStartedAt });
  }, 250);
}

function stopElapsedTimer(): void {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function createUnavailableDependencies(): VoiceDependencies {
  const lifecycle = new VoiceModelLifecycle(
    {
      storageBytes: null,
      isReady: async () => false,
      download: async () => {
        throw new Error('Offline voice is unavailable until its device-verified model is installed.');
      },
      verify: async () => false,
      remove: async () => undefined,
    },
    voicePermissionAdapter,
  );
  const unavailableRuntime: VoiceSessionRuntime = {
    isAvailable: () => false,
    start: async (): Promise<VoiceSession> => {
      throw new Error('The offline voice runtime is unavailable.');
    },
  };
  return {
    lifecycle,
    session: new VoiceSessionService(unavailableRuntime, deviceResourcePolicy),
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Voice input failed.';
}
