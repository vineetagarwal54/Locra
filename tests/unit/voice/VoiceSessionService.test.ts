import { SingleFlightResourcePolicy } from '../../../src/inference/DeviceResourcePolicy';
import type { VoiceSession, VoiceSessionRuntime } from '../../../src/voice/VoiceSession';
import { VoiceSessionService } from '../../../src/voice/VoiceSessionService';

function fakeSession(overrides: Partial<VoiceSession> = {}): VoiceSession & {
  emit: (text: string) => void;
  release: jest.Mock;
} {
  let listener: ((text: string) => void) | null = null;
  const release = jest.fn();
  const session = {
    onPartial: (l: (text: string) => void): void => {
      listener = l;
    },
    stop: jest.fn(async () => ' final transcript '),
    cancel: jest.fn(),
    release,
    emit: (text: string): void => listener?.(text),
    ...overrides,
  } as unknown as VoiceSession & { emit: (text: string) => void; release: jest.Mock };
  return session;
}

function fakeRuntime(session: VoiceSession): VoiceSessionRuntime {
  return { isAvailable: () => true, start: jest.fn(async () => session) };
}

describe('VoiceSessionService', () => {
  it('holds one exclusive voice-input lease across the whole session', async () => {
    const policy = new SingleFlightResourcePolicy();
    const service = new VoiceSessionService(fakeRuntime(fakeSession()), policy);

    await service.start(() => undefined);
    expect(policy.current()).toBe('voice-input');
    // The gate stays held through recording AND finalization until stop resolves.
    await service.stop();
    expect(policy.current()).toBeNull();
  });

  it('fails fast when another protected operation already holds the gate', async () => {
    const policy = new SingleFlightResourcePolicy();
    const held = await policy.acquire('qwen-answer');
    const service = new VoiceSessionService(fakeRuntime(fakeSession()), policy);

    await expect(service.start(() => undefined)).rejects.toThrow(/unavailable/i);
    expect(policy.current()).toBe('qwen-answer');
    held.release();
  });

  it('streams partials and returns the trimmed final transcript on stop', async () => {
    const session = fakeSession();
    const service = new VoiceSessionService(fakeRuntime(session), new SingleFlightResourcePolicy());
    const partials: string[] = [];

    await service.start((text) => partials.push(text));
    session.emit('hello');
    session.emit('hello world');
    const final = await service.stop();

    expect(partials).toEqual(['hello', 'hello world']);
    expect(final).toBe('final transcript');
  });

  it('releases the recognizer/recorder (deleting temp audio) on stop', async () => {
    const session = fakeSession();
    const service = new VoiceSessionService(fakeRuntime(session), new SingleFlightResourcePolicy());

    await service.start(() => undefined);
    await service.stop();
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it('cancels while recording: releases everything and frees the gate', async () => {
    const session = fakeSession();
    const policy = new SingleFlightResourcePolicy();
    const service = new VoiceSessionService(fakeRuntime(session), policy);

    await service.start(() => undefined);
    await service.cancel();

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(policy.current()).toBeNull();
  });

  it('cancels while finalizing without leaving the gate held', async () => {
    // stop() is in-flight (finalizing) when cancel arrives.
    const session = fakeSession({ stop: jest.fn(() => new Promise<string>(() => undefined)) });
    const policy = new SingleFlightResourcePolicy();
    const service = new VoiceSessionService(fakeRuntime(session), policy);

    await service.start(() => undefined);
    void service.stop();
    await service.cancel();

    expect(policy.current()).toBeNull();
  });

  it('releases the lease and recognizer when a stop failure occurs', async () => {
    const session = fakeSession({ stop: jest.fn(async () => { throw new Error('decode failed'); }) });
    const policy = new SingleFlightResourcePolicy();
    const service = new VoiceSessionService(fakeRuntime(session), policy);

    await service.start(() => undefined);
    await expect(service.stop()).rejects.toThrow(/decode failed/i);
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(policy.current()).toBeNull();
  });

  it('frees the gate if the runtime fails to start', async () => {
    const policy = new SingleFlightResourcePolicy();
    const runtime: VoiceSessionRuntime = {
      isAvailable: () => true,
      start: jest.fn(async () => { throw new Error('mic busy'); }),
    };
    const service = new VoiceSessionService(runtime, policy);

    await expect(service.start(() => undefined)).rejects.toThrow(/mic busy/i);
    expect(policy.current()).toBeNull();
  });
});
