// Real offline streaming-ASR runtime: wires `@siteed/sherpa-onnx.rn` (online
// Zipformer recognizer, the `ASR` singleton) to `@siteed/audio-studio` (16 kHz
// mono Float32 PCM mic stream). This is the ONLY module that touches those
// native packages.
//
// The packages are loaded LAZILY via `require()` (the llama.rn pattern) and typed
// against the packages' OWN published types (`typeof import(...)` / root type
// exports) — there is deliberately no `declare module` shim, so an absent package
// never looks installed and `isAvailable()` degrades to false in Jest / Expo Go /
// an unbuilt app. Because both native modules resolve their bindings at import
// time (`requireNativeModule`), a static `import` would throw under Jest; the
// try/caught lazy require is what keeps the JS-only test + Expo Go paths alive.
//
// Fully offline: model files are read from local storage and PCM is processed
// on-device. No network APIs are used (the offline architecture guard covers this
// directory).
//
// Streaming flow (exact package APIs):
//   ASR.initialize({ modelDir, modelType: 'zipformer', streaming: true, modelFiles })
//   ASR.createOnlineStream()
//   per PCM chunk: ASR.acceptWaveform(16000, samples) → ASR.getResult()
//                  → ASR.isEndpoint() → commit + ASR.resetStream() at a pause
//   on stop:       ASR.finishInput() → ASR.getResult() → ASR.release()
//
// Committed-segment accumulation: Sherpa's online stream only reports the CURRENT
// utterance, and `resetStream()` (needed after every endpoint so the next
// utterance is not re-decoded from scratch) clears that text. We therefore append
// each finalized utterance to `committedText` BEFORE resetting, and always emit
// `committedText + currentSegment` so a natural pause never erases earlier speech.

import { File } from 'expo-file-system';
import { LegacyEventEmitter } from 'expo-modules-core';

import type { VoiceModelDescriptor } from './VoiceModelDescriptor';
import { voiceModelFiles } from './VoiceModelDescriptor';
import type { VoiceSession, VoiceSessionRuntime } from './VoiceSession';

// ── Types drawn from the packages' own declarations (compile-time only) ──────

/** The exact `AsrService` instance type exported as `ASR`. */
type SherpaAsr = typeof import('@siteed/sherpa-onnx.rn').ASR;

/**
 * The audio-studio native module is published as `any`; we bind only the two
 * imperative recorder methods we use, typed with the package's real config and
 * result types so a signature change surfaces at compile time.
 */
interface AudioRecorderModule {
  startRecording(
    config: import('@siteed/audio-studio').RecordingConfig,
  ): Promise<import('@siteed/audio-studio').StartRecordingResult>;
  stopRecording(): Promise<import('@siteed/audio-studio').AudioRecording | null>;
}

/**
 * The native `AudioData` event payload (from audio-studio's internal
 * `events.ts`). Only the Float32 PCM + temp-file fields are read here.
 */
interface AudioDataNativeEvent {
  readonly pcmFloat32?: Float32Array | number[];
  readonly fileUri?: string;
  readonly deltaSize?: number;
}

interface EventSub {
  remove(): void;
}

export interface SherpaVoiceRuntimeConfig {
  readonly descriptor: VoiceModelDescriptor;
  /** Absolute directory holding the descriptor's model files. */
  readonly modelDirectory: string;
}

/** True only when BOTH native packages resolve at runtime (real build, not Jest). */
export function isVoiceRuntimeAvailable(): boolean {
  return loadSherpaAsr() !== null && loadAudioRecorder() !== null;
}

/** Builds the real streaming session runtime bound to the given local model. */
export function createSherpaVoiceRuntime(config: SherpaVoiceRuntimeConfig): VoiceSessionRuntime {
  return {
    isAvailable: isVoiceRuntimeAvailable,
    start: () => startSession(config),
  };
}

async function startSession(config: SherpaVoiceRuntimeConfig): Promise<VoiceSession> {
  const asr = loadSherpaAsr();
  const recorder = loadAudioRecorder();
  if (asr === null || recorder === null) {
    throw new Error('The offline voice runtime is not installed in this build.');
  }

  const { descriptor } = config;
  const initResult = await asr.initialize({
    modelDir: config.modelDirectory,
    modelType: 'zipformer',
    streaming: true,
    numThreads: 2,
    decodingMethod: 'greedy_search',
    provider: 'cpu',
    modelFiles: {
      encoder: descriptor.encoderFile,
      decoder: descriptor.decoderFile,
      joiner: descriptor.joinerFile,
      tokens: descriptor.tokensFile,
    },
  });
  if (!initResult.success) {
    await safeRelease(asr);
    throw new Error('The offline voice recognizer failed to initialize.');
  }
  await asr.createOnlineStream();

  const listeners = new Set<(partialText: string) => void>();
  // Utterances finalized at earlier endpoints, preserved across resetStream() so
  // pauses never drop previously dictated text. `currentSegment` is the live,
  // still-decoding utterance from the online stream.
  let committedText = '';
  let currentSegment = '';
  let lastEmitted = '';
  let released = false;
  let finishing = false;
  // Serialize the async ASR calls: audio chunks arrive faster than a full
  // accept→decode→endpoint round-trip, and the native recognizer is not
  // re-entrant. Each chunk chains onto the previous so calls never overlap.
  let queue: Promise<void> = Promise.resolve();
  let tempFileUri: string | undefined;

  const emit = (): void => {
    const text = joinSegments(committedText, currentSegment);
    if (text === lastEmitted) {
      return;
    }
    lastEmitted = text;
    for (const listener of listeners) {
      listener(text);
    }
  };

  const processChunk = async (samples: number[]): Promise<void> => {
    if (released || finishing) {
      return;
    }
    await asr.acceptWaveform(descriptor.sampleRate, samples);
    currentSegment = (await asr.getResult()).text;
    emit();
    // Endpoint = a natural pause. Commit the utterance, then reset the decoder so
    // the next utterance is not re-decoded from the start of the whole session.
    const { isEndpoint } = await asr.isEndpoint();
    if (isEndpoint) {
      committedText = joinSegments(committedText, currentSegment);
      currentSegment = '';
      await asr.resetStream();
    }
  };

  const emitter = new LegacyEventEmitter(recorderNativeModule(recorder));
  const subscription: EventSub = emitter.addListener('AudioData', (event: AudioDataNativeEvent) => {
    if (released || finishing || event.deltaSize === 0) {
      return;
    }
    const samples = toSampleArray(event.pcmFloat32);
    if (samples === null) {
      return;
    }
    if (tempFileUri === undefined && event.fileUri !== undefined && event.fileUri !== '') {
      tempFileUri = event.fileUri;
    }
    queue = queue.then(() => processChunk(samples)).catch(() => undefined);
  });

  try {
    const startResult = await recorder.startRecording({
      sampleRate: descriptor.sampleRate,
      channels: 1,
      encoding: 'pcm_32bit',
      streamFormat: 'float32',
      interval: 100,
    });
    if (tempFileUri === undefined && startResult.fileUri !== '') {
      tempFileUri = startResult.fileUri;
    }
  } catch (error) {
    subscription.remove();
    await safeRelease(asr);
    throw error;
  }

  let recorderStopped = false;
  const stopRecorder = async (): Promise<void> => {
    if (recorderStopped) {
      return;
    }
    recorderStopped = true;
    subscription.remove();
    try {
      const recording = await recorder.stopRecording();
      if (recording?.fileUri !== undefined && recording.fileUri !== '') {
        tempFileUri = recording.fileUri;
      }
    } catch {
      // Best-effort; a lost/interrupted recorder must not throw on teardown.
    }
  };

  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    listeners.clear();
    await stopRecorder();
    await queue.catch(() => undefined);
    await safeRelease(asr);
    await deleteTemporaryAudio(tempFileUri);
  };

  return {
    onPartial: (listener): void => {
      listeners.add(listener);
    },
    stop: async (): Promise<string> => {
      finishing = true;
      await stopRecorder();
      // Drain any chunks that were mid-flight, then flush the recognizer.
      await queue.catch(() => undefined);
      try {
        await asr.finishInput();
        currentSegment = (await asr.getResult()).text;
      } catch {
        // Keep whatever was already committed if the final drain fails.
      }
      const finalText = joinSegments(committedText, currentSegment);
      await release();
      return finalText;
    },
    cancel: release,
    release,
  };
}

/** Joins committed speech with the live segment, collapsing to a single space. */
function joinSegments(committed: string, segment: string): string {
  const left = committed.trim();
  const right = segment.trim();
  if (left === '') {
    return right;
  }
  if (right === '') {
    return left;
  }
  return `${left} ${right}`;
}

/** Normalizes the native Float32 payload (Float32Array on Android, number[] on iOS). */
function toSampleArray(pcm: Float32Array | number[] | undefined): number[] | null {
  if (pcm === undefined) {
    return null;
  }
  if (pcm instanceof Float32Array) {
    return Array.from(pcm);
  }
  return pcm.length > 0 ? pcm : null;
}

async function safeRelease(asr: SherpaAsr): Promise<void> {
  try {
    await asr.release();
  } catch {
    // Best-effort teardown.
  }
}

async function deleteTemporaryAudio(uri: string | undefined): Promise<void> {
  if (uri === undefined || uri === '') {
    return;
  }
  try {
    const file = new File(uri.startsWith('file://') ? uri : `file://${uri}`);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Temp audio deletion is best-effort; a leftover is cleaned on next startup.
  }
}

/** Confirms all model files exist locally before a session is attempted. */
export function voiceModelIsInstalled(config: SherpaVoiceRuntimeConfig): boolean {
  return voiceModelFiles(config.descriptor).every((fileName) => {
    try {
      return new File(`${config.modelDirectory}/${fileName}`).exists;
    } catch {
      return false;
    }
  });
}

// The audio-studio module doubles as the native event source for the
// `LegacyEventEmitter`; `startRecording`/`stopRecording` live on the same object.
function recorderNativeModule(recorder: AudioRecorderModule): object {
  return recorder as unknown as object;
}

// Literal require strings (not a variable) so Metro can statically resolve the
// native packages once installed; the try/catch degrades to null when they are
// absent (Jest / Expo Go / an unbuilt app).
function loadSherpaAsr(): SherpaAsr | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@siteed/sherpa-onnx.rn') as { ASR?: SherpaAsr };
    return mod.ASR ?? null;
  } catch {
    return null;
  }
}

function loadAudioRecorder(): AudioRecorderModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@siteed/audio-studio') as { AudioStudioModule?: AudioRecorderModule };
    const recorder = mod.AudioStudioModule;
    return recorder != null && typeof recorder.startRecording === 'function' ? recorder : null;
  } catch {
    return null;
  }
}
