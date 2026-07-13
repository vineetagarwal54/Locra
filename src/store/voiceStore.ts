import { create } from 'zustand';

import { deviceResourcePolicy } from '../inference/DeviceResourcePolicy';
import {
  VoiceModelLifecycle,
  type VoiceModelState,
} from '../voice/VoiceModelLifecycle';
import { voicePermissionAdapter } from '../voice/voicePermission';
import { VoiceRecordingService } from '../voice/VoiceRecordingService';
import { VoiceTranscriptionService } from '../voice/VoiceTranscriptionService';

interface VoiceDependencies {
  lifecycle: VoiceModelLifecycle;
  recording: VoiceRecordingService;
  transcription: VoiceTranscriptionService;
}

export interface VoiceStoreState extends VoiceModelState {
  readonly disclosureVisible: boolean;
  readonly recording: boolean;
  readonly transcribing: boolean;
  readonly storageBytes: number | null;
  showDisclosure(): void;
  hideDisclosure(): void;
  clearError(): void;
  confirmEnable(): Promise<void>;
  startRecording(): Promise<void>;
  stopAndTranscribe(): Promise<string>;
  cancel(): void;
}

let dependencies = createUnavailableDependencies();

export const useVoiceStore = create<VoiceStoreState>((set, get) => ({
  ...dependencies.lifecycle.getState(),
  disclosureVisible: false,
  recording: false,
  transcribing: false,
  storageBytes: dependencies.lifecycle.storageBytes,
  showDisclosure: (): void => set({ disclosureVisible: true, error: null }),
  hideDisclosure: (): void => set({ disclosureVisible: false }),
  clearError: (): void => set({ error: null }),
  confirmEnable: async (): Promise<void> => {
    set({ disclosureVisible: false, error: null });
    try {
      await dependencies.lifecycle.enable();
      set({ ...dependencies.lifecycle.getState() });
    } catch {
      set({ ...dependencies.lifecycle.getState() });
    }
  },
  startRecording: async (): Promise<void> => {
    if (get().status !== 'ready') {
      get().showDisclosure();
      return;
    }
    const permissionGranted = get().permissionGranted ||
      await dependencies.lifecycle.requestMicPermission();
    if (!permissionGranted) {
      set({ permissionGranted: false, error: 'Microphone permission is required for voice input.' });
      return;
    }
    try {
      await dependencies.recording.startRecording();
      set({ recording: true, error: null, permissionGranted: true });
    } catch (error) {
      set({ error: toMessage(error), recording: false });
    }
  },
  stopAndTranscribe: async (): Promise<string> => {
    set({ recording: false, transcribing: true, error: null });
    try {
      const path = await dependencies.recording.stopRecording();
      return await dependencies.transcription.transcribe(path);
    } catch (error) {
      set({ error: toMessage(error) });
      return '';
    } finally {
      set({ transcribing: false });
    }
  },
  cancel: (): void => {
    dependencies.recording.cancel();
    dependencies.transcription.cancel();
    set({ recording: false, transcribing: false });
  },
}));

let unsubscribeLifecycle = subscribeToLifecycle(dependencies.lifecycle);

export function configureVoiceDependencies(next: VoiceDependencies): void {
  unsubscribeLifecycle();
  dependencies = next;
  useVoiceStore.setState({
    ...next.lifecycle.getState(),
    storageBytes: next.lifecycle.storageBytes,
    error: null,
  });
  unsubscribeLifecycle = subscribeToLifecycle(next.lifecycle);
}

function subscribeToLifecycle(lifecycle: VoiceModelLifecycle): () => void {
  return lifecycle.subscribe((state) => {
    useVoiceStore.setState({ ...state, storageBytes: lifecycle.storageBytes });
  });
}

function createUnavailableDependencies(): VoiceDependencies {
  const lifecycle = new VoiceModelLifecycle({
    storageBytes: null,
    isReady: async () => false,
    download: async () => {
      throw new Error('Offline voice is unavailable until its device-verified model is installed.');
    },
    verify: async () => false,
  }, voicePermissionAdapter);
  const unavailableRecorder = {
    start: async (): Promise<void> => {
      throw new Error('Offline voice recording runtime is unavailable.');
    },
    stop: async (): Promise<string> => { throw new Error('Voice recording has not started.'); },
    cancel: (): void => undefined,
  };
  const unavailableTranscriber = {
    transcribe: async (): Promise<string> => {
      throw new Error('Offline voice transcription runtime is unavailable.');
    },
    release: (): void => undefined,
  };
  return {
    lifecycle,
    recording: new VoiceRecordingService(unavailableRecorder, deviceResourcePolicy),
    transcription: new VoiceTranscriptionService(unavailableTranscriber, deviceResourcePolicy),
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Voice input failed.';
}
