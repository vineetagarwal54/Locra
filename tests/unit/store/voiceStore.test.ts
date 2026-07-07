import { readFileSync } from 'fs';
import { join } from 'path';

import type { VoiceTranscriptionHandle } from '../../../src/inference/useVoiceTranscription';
import { useVoiceStore } from '../../../src/store/voiceStore';

interface MockHandle extends VoiceTranscriptionHandle {
  startRecording: jest.Mock<Promise<void>, []>;
  stopAndTranscribe: jest.Mock<Promise<string>, []>;
  cancelRecording: jest.Mock<void, []>;
}

function makeHandle(
  overrides: Partial<{
    ready: boolean;
    recording: boolean;
    transcribing: boolean;
    error: string | null;
    progress: number;
    transcript: string;
  }> = {}
): MockHandle {
  const ready = overrides.ready ?? true;
  const error = overrides.error ?? null;
  return {
    startRecording: jest.fn(() => Promise.resolve()),
    stopAndTranscribe: jest.fn(() => Promise.resolve(overrides.transcript ?? 'hello world')),
    cancelRecording: jest.fn(),
    isReady: () => ready,
    isModelLoading: () => !ready && error === null,
    downloadProgress: () => overrides.progress ?? 1,
    isRecording: () => overrides.recording ?? false,
    isTranscribing: () => overrides.transcribing ?? false,
    getError: () => error,
    subscribe: () => () => undefined,
  };
}

describe('voiceStore (FR-033)', () => {
  beforeEach(() => {
    useVoiceStore.setState({ enabled: false, phase: 'idle', downloadProgress: 0, error: null });
    useVoiceStore.getState().registerHandle(null);
  });

  it('starts idle and unmounted; enableVoice flips it to loading + enabled (lazy model download)', () => {
    expect(useVoiceStore.getState().enabled).toBe(false);
    expect(useVoiceStore.getState().phase).toBe('idle');

    useVoiceStore.getState().enableVoice();

    expect(useVoiceStore.getState().enabled).toBe(true);
    expect(useVoiceStore.getState().phase).toBe('loading');
  });

  it('derives phase from the registered handle', () => {
    useVoiceStore.getState().registerHandle(makeHandle({ ready: true }));
    expect(useVoiceStore.getState().phase).toBe('ready');

    useVoiceStore.getState().registerHandle(makeHandle({ ready: false }));
    expect(useVoiceStore.getState().phase).toBe('loading');

    useVoiceStore.getState().registerHandle(makeHandle({ recording: true }));
    expect(useVoiceStore.getState().phase).toBe('recording');

    useVoiceStore.getState().registerHandle(makeHandle({ transcribing: true }));
    expect(useVoiceStore.getState().phase).toBe('transcribing');

    useVoiceStore.getState().registerHandle(makeHandle({ error: 'mic failed' }));
    expect(useVoiceStore.getState().phase).toBe('error');
    expect(useVoiceStore.getState().error).toBe('mic failed');
  });

  it('unregistering the handle resets to idle', () => {
    useVoiceStore.getState().registerHandle(makeHandle({ ready: true }));
    useVoiceStore.getState().registerHandle(null);
    expect(useVoiceStore.getState().phase).toBe('idle');
  });

  it('startRecording / stopAndTranscribe / cancel delegate to the handle', async () => {
    const h = makeHandle({ transcript: 'a red mug' });
    useVoiceStore.getState().registerHandle(h);

    await useVoiceStore.getState().startRecording();
    expect(h.startRecording).toHaveBeenCalledTimes(1);

    const text = await useVoiceStore.getState().stopAndTranscribe();
    expect(text).toBe('a red mug');
    expect(h.stopAndTranscribe).toHaveBeenCalledTimes(1);

    useVoiceStore.getState().cancel();
    expect(h.cancelRecording).toHaveBeenCalledTimes(1);
  });

  it('stopAndTranscribe returns empty string when no handle is registered', async () => {
    expect(await useVoiceStore.getState().stopAndTranscribe()).toBe('');
  });

  it('startRecording throws a clear error when voice is not mounted yet', async () => {
    await expect(useVoiceStore.getState().startRecording()).rejects.toThrow(/starting up/i);
  });
});

describe('voice hook isolation (Principle X / Principle IX)', () => {
  const hookSource = readFileSync(
    join(process.cwd(), 'src/inference/useVoiceTranscription.ts'),
    'utf8'
  );

  it('is the sanctioned useSpeechToText + useAudioStream call site (real 0.9.2 API, not useWhisper)', () => {
    expect(hookSource).toContain('useSpeechToText');
    expect(hookSource).toContain('useAudioStream');
    expect(hookSource).toContain('WHISPER_TINY_EN');
    // No CALL to the nonexistent useWhisper (the name may appear in a comment).
    expect(hookSource).not.toMatch(/useWhisper\s*\(/);
  });

  it('enforces the shared voice⇄VLM lock (FR-033 mutual exclusion)', () => {
    expect(hookSource).toContain("inferenceActivityLock.tryAcquire('voice')");
    expect(hookSource).toContain("inferenceActivityLock.release('voice')");
  });

  it('screens never import the voice hooks directly (only the store / host do)', () => {
    for (const rel of ['src/screens/CaptureScreen.tsx']) {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src).not.toContain('useSpeechToText');
      expect(src).not.toContain('useAudioStream');
      expect(src).not.toContain('useVoiceTranscription');
    }
  });
});
