import { SingleFlightResourcePolicy } from '../../../src/inference/DeviceResourcePolicy';
import { configureVoiceDependencies, useVoiceStore } from '../../../src/store/voiceStore';
import { isComposerReadOnlyForVoice } from '../../../src/voice/dictationDraft';
import { VoiceModelLifecycle } from '../../../src/voice/VoiceModelLifecycle';
import type { VoiceSession, VoiceSessionRuntime } from '../../../src/voice/VoiceSession';
import { VoiceSessionService } from '../../../src/voice/VoiceSessionService';

function fakeSession(finalText = ' editable transcript '): VoiceSession & { emit: (t: string) => void } {
  let listener: ((text: string) => void) | null = null;
  return {
    onPartial: (l: (text: string) => void): void => {
      listener = l;
    },
    stop: jest.fn(async () => finalText),
    cancel: jest.fn(),
    release: jest.fn(),
    emit: (text: string): void => listener?.(text),
  } as unknown as VoiceSession & { emit: (t: string) => void };
}

function fakeRuntime(session: VoiceSession): VoiceSessionRuntime {
  return { isAvailable: () => true, start: jest.fn(async () => session) };
}

function readyLifecycle(permissionGranted = true): VoiceModelLifecycle {
  return new VoiceModelLifecycle(
    {
      storageBytes: 70_000_000,
      isReady: jest.fn(async () => true),
      download: jest.fn(async () => undefined),
      verify: jest.fn(async () => true),
      remove: jest.fn(async () => undefined),
    },
    { request: jest.fn(async () => permissionGranted) },
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('offline voice model lifecycle', () => {
  it('streams lifecycle setup state into the UI store', async () => {
    let finishDownload: (() => void) | undefined;
    const lifecycle = new VoiceModelLifecycle(
      {
        storageBytes: 50_000_000,
        isReady: jest.fn(async () => false),
        download: jest.fn(async (onProgress) => {
          onProgress(0.5);
          await new Promise<void>((resolve) => { finishDownload = resolve; });
        }),
        verify: jest.fn(async () => true),
        remove: jest.fn(async () => undefined),
      },
      { request: jest.fn(async () => true) },
    );
    configureVoiceDependencies({
      lifecycle,
      session: new VoiceSessionService(fakeRuntime(fakeSession()), new SingleFlightResourcePolicy()),
    });

    const enabling = useVoiceStore.getState().confirmEnable();
    await Promise.resolve();

    expect(useVoiceStore.getState()).toEqual(
      expect.objectContaining({ status: 'downloading', downloadProgress: 0.5 }),
    );
    finishDownload?.();
    await enabling;
    expect(useVoiceStore.getState().status).toBe('ready');
  });

  it('requires explicit enablement and recovers from download/integrity failure', async () => {
    let verify = false;
    const lifecycle = new VoiceModelLifecycle(
      {
        storageBytes: 50_000_000,
        isReady: jest.fn(async () => false),
        download: jest.fn(async (onProgress) => onProgress(1)),
        verify: jest.fn(async () => verify),
        remove: jest.fn(async () => undefined),
      },
      { request: jest.fn(async () => true) },
    );

    expect(lifecycle.getState().enabled).toBe(false);
    await expect(lifecycle.enable()).rejects.toThrow(/integrity/i);
    expect(lifecycle.getState().status).toBe('error');
    verify = true;
    await expect(lifecycle.enable()).resolves.toBeUndefined();
    expect(lifecycle.getState()).toEqual(expect.objectContaining({ enabled: true, status: 'ready' }));
  });

  it('removes the voice model and returns to disabled without touching conversations', async () => {
    const remove = jest.fn(async () => undefined);
    const lifecycle = new VoiceModelLifecycle(
      {
        storageBytes: 50_000_000,
        isReady: jest.fn(async () => true),
        download: jest.fn(async () => undefined),
        verify: jest.fn(async () => true),
        remove,
      },
      { request: jest.fn(async () => true) },
    );
    configureVoiceDependencies({
      lifecycle,
      session: new VoiceSessionService(fakeRuntime(fakeSession()), new SingleFlightResourcePolicy()),
    });
    await useVoiceStore.getState().confirmEnable();

    await useVoiceStore.getState().removeModel();

    expect(remove).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState()).toEqual(
      expect.objectContaining({ enabled: false, status: 'disabled' }),
    );
  });
});

describe('voice session store', () => {
  it('streams partials, then stops with an editable transcript and NEVER submits', async () => {
    const session = fakeSession();
    configureVoiceDependencies({
      lifecycle: readyLifecycle(),
      session: new VoiceSessionService(fakeRuntime(session), new SingleFlightResourcePolicy()),
    });
    await useVoiceStore.getState().confirmEnable();

    await useVoiceStore.getState().startRecording();
    expect(useVoiceStore.getState().sessionStatus).toBe('recording');

    session.emit('hello');
    session.emit('hello world');
    expect(useVoiceStore.getState().partialTranscript).toBe('hello world');

    const transcript = await useVoiceStore.getState().stopAndFinalize();

    // Stopping finalizes and leaves the text ready & editable — it never sends.
    expect(transcript).toBe('editable transcript');
    expect(useVoiceStore.getState().sessionStatus).toBe('ready');
    expect(isComposerReadOnlyForVoice(useVoiceStore.getState().sessionStatus)).toBe(false);
  });

  it('cancels a recording session, clearing the partial transcript', async () => {
    const session = fakeSession();
    configureVoiceDependencies({
      lifecycle: readyLifecycle(),
      session: new VoiceSessionService(fakeRuntime(session), new SingleFlightResourcePolicy()),
    });
    await useVoiceStore.getState().confirmEnable();
    await useVoiceStore.getState().startRecording();
    session.emit('partial in progress');

    // Cancel awaits native teardown + lease release; the composer stays locked in
    // 'cancelling' until it resolves, then transitions to 'cancelled'.
    const cancelling = useVoiceStore.getState().cancel();
    expect(useVoiceStore.getState().sessionStatus).toBe('cancelling');
    expect(isComposerReadOnlyForVoice(useVoiceStore.getState().sessionStatus)).toBe(true);
    await cancelling;

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().sessionStatus).toBe('cancelled');
    expect(useVoiceStore.getState().partialTranscript).toBe('');
  });

  it('fails the session on microphone permission denial without starting a recording', async () => {
    const runtime = fakeRuntime(fakeSession());
    configureVoiceDependencies({
      lifecycle: readyLifecycle(false),
      session: new VoiceSessionService(runtime, new SingleFlightResourcePolicy()),
    });
    await useVoiceStore.getState().confirmEnable();

    await useVoiceStore.getState().startRecording();

    expect(useVoiceStore.getState().sessionStatus).toBe('failed');
    expect(useVoiceStore.getState().sessionError).toMatch(/permission/i);
    expect(runtime.start).not.toHaveBeenCalled();
  });
});
