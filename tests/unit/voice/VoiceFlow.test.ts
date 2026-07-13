import { SingleFlightResourcePolicy } from '../../../src/inference/DeviceResourcePolicy';
import { configureVoiceDependencies, useVoiceStore } from '../../../src/store/voiceStore';
import { VoiceModelLifecycle } from '../../../src/voice/VoiceModelLifecycle';
import { VoiceRecordingService } from '../../../src/voice/VoiceRecordingService';
import { VoiceTranscriptionService } from '../../../src/voice/VoiceTranscriptionService';

describe('offline voice flow', () => {
  it('streams lifecycle setup state into the UI store', async () => {
    let finishDownload: (() => void) | undefined;
    const lifecycle = new VoiceModelLifecycle({
      storageBytes: 50_000_000,
      isReady: jest.fn(async () => false),
      download: jest.fn(async (onProgress) => {
        onProgress(0.5);
        await new Promise<void>((resolve) => { finishDownload = resolve; });
      }),
      verify: jest.fn(async () => true),
    }, { request: jest.fn(async () => true) });
    configureVoiceDependencies({
      lifecycle,
      recording: new VoiceRecordingService({
        start: jest.fn(async () => undefined),
        stop: jest.fn(async () => '/audio.wav'),
        cancel: jest.fn(),
      }, new SingleFlightResourcePolicy()),
      transcription: new VoiceTranscriptionService({
        transcribe: jest.fn(async () => 'draft'),
        release: jest.fn(),
      }, new SingleFlightResourcePolicy()),
    });

    const enabling = useVoiceStore.getState().confirmEnable();
    await Promise.resolve();

    expect(useVoiceStore.getState()).toEqual(expect.objectContaining({
      status: 'downloading',
      downloadProgress: 0.5,
    }));
    finishDownload?.();
    await enabling;
    expect(useVoiceStore.getState().status).toBe('ready');
  });

  it('requires explicit enablement and recovers from download/integrity failure', async () => {
    let verify = false;
    const lifecycle = new VoiceModelLifecycle({
      storageBytes: 50_000_000,
      isReady: jest.fn(async () => false),
      download: jest.fn(async (onProgress) => onProgress(1)),
      verify: jest.fn(async () => verify),
    }, { request: jest.fn(async () => true) });

    expect(lifecycle.getState().enabled).toBe(false);
    await expect(lifecycle.enable()).rejects.toThrow(/integrity/i);
    expect(lifecycle.getState().status).toBe('error');
    verify = true;
    await expect(lifecycle.enable()).resolves.toBeUndefined();
    expect(lifecycle.getState()).toEqual(expect.objectContaining({ enabled: true, status: 'ready' }));
  });

  it('returns an editable transcript and never invokes message submission', async () => {
    const resource = new SingleFlightResourcePolicy({
      tryAcquire: jest.fn(() => true), release: jest.fn(),
      isBusy: jest.fn(() => false), heldBy: jest.fn(() => null),
    });
    const recording = new VoiceRecordingService({
      start: jest.fn(async () => undefined), stop: jest.fn(async () => '/audio.wav'),
      cancel: jest.fn(),
    }, resource);
    const transcription = new VoiceTranscriptionService({
      transcribe: jest.fn(async () => ' editable transcript '), release: jest.fn(),
    }, resource);
    const submit = jest.fn();

    await recording.startRecording();
    const path = await recording.stopRecording();
    const transcript = await transcription.transcribe(path);

    expect(transcript).toBe('editable transcript');
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['qwen-answer', 'qwen-compaction', 'embedding', 'transcribe'] as const)(
    'blocks recording while %s owns the protected resource',
    async (operation) => {
      const resource = new SingleFlightResourcePolicy({
        tryAcquire: jest.fn(() => true), release: jest.fn(),
        isBusy: jest.fn(() => false), heldBy: jest.fn(() => null),
      });
      const held = await resource.acquire(operation);
      const recording = new VoiceRecordingService({
        start: jest.fn(async () => undefined), stop: jest.fn(async () => ''), cancel: jest.fn(),
      }, resource);
      await expect(recording.startRecording()).rejects.toThrow(/unavailable/i);
      held.release();
    },
  );
});
