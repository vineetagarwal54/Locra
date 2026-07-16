// Real offline streaming-ASR runtime: wires `@siteed/sherpa-onnx.rn` (online
// Zipformer recognizer) to `@siteed/audio-studio` (16 kHz mono Float32 PCM mic
// stream). This is the ONLY module that touches those native packages.
//
// The packages are required LAZILY and cast to LOCAL interfaces (the llama.rn
// pattern) — there is deliberately no `declare module` shim, so an absent package
// never looks installed to the type system and `isAvailable()` degrades to false
// in Jest / Expo Go / an unbuilt app. The exact native method names below are the
// documented Sherpa/AudioStudio APIs but are UNVERIFIED against a device build;
// they are the single reconciliation point to confirm during the Android build.
//
// Fully offline: model files are read from local storage and PCM is processed
// on-device. No network APIs are used (offline architecture guard covers this dir).

import { File } from 'expo-file-system';

import type { VoiceModelDescriptor } from './VoiceModelDescriptor';
import { voiceModelFiles } from './VoiceModelDescriptor';
import type { VoiceSession, VoiceSessionRuntime } from './VoiceSession';

// ── Local views of the native APIs (cast targets for the lazy requires) ──────

interface SherpaOnlineStream {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
}

interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream;
  isReady(stream: SherpaOnlineStream): boolean;
  decode(stream: SherpaOnlineStream): void;
  getResult(stream: SherpaOnlineStream): { text: string };
  isEndpoint(stream: SherpaOnlineStream): boolean;
  reset(stream: SherpaOnlineStream): void;
  free(): void;
}

interface SherpaModule {
  createOnlineRecognizer(config: SherpaRecognizerConfig): SherpaOnlineRecognizer;
}

interface SherpaRecognizerConfig {
  readonly transducer: {
    readonly encoder: string;
    readonly decoder: string;
    readonly joiner: string;
  };
  readonly tokens: string;
  readonly sampleRate: number;
  readonly featureDim: number;
  readonly enableEndpoint: boolean;
}

interface AudioRecording {
  stop(): Promise<void> | void;
  /** Temp file the recorder may have written; deleted on release when present. */
  readonly uri?: string;
}

interface AudioStudioModule {
  startRecording(options: {
    sampleRate: number;
    channels: number;
    onAudioData: (samples: Float32Array) => void;
  }): Promise<AudioRecording>;
}

export interface SherpaVoiceRuntimeConfig {
  readonly descriptor: VoiceModelDescriptor;
  /** Absolute directory holding the descriptor's model files. */
  readonly modelDirectory: string;
}

/** True only when BOTH native packages resolve at runtime (real build, not Jest). */
export function isVoiceRuntimeAvailable(): boolean {
  return loadSherpa() !== null && loadAudioStudio() !== null;
}

/** Builds the real streaming session runtime bound to the given local model. */
export function createSherpaVoiceRuntime(config: SherpaVoiceRuntimeConfig): VoiceSessionRuntime {
  return {
    isAvailable: isVoiceRuntimeAvailable,
    start: () => startSession(config),
  };
}

async function startSession(config: SherpaVoiceRuntimeConfig): Promise<VoiceSession> {
  const sherpa = loadSherpa();
  const audioStudio = loadAudioStudio();
  if (sherpa === null || audioStudio === null) {
    throw new Error('The offline voice runtime is not installed in this build.');
  }

  const recognizer = sherpa.createOnlineRecognizer(buildConfig(config));
  const stream = recognizer.createStream();
  const listeners = new Set<(partialText: string) => void>();
  let lastPartial = '';
  let released = false;

  const pump = (samples: Float32Array): void => {
    if (released) {
      return;
    }
    stream.acceptWaveform(config.descriptor.sampleRate, samples);
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    const text = recognizer.getResult(stream).text;
    if (text !== lastPartial) {
      lastPartial = text;
      for (const listener of listeners) {
        listener(text);
      }
    }
    // Endpoint = a natural pause; keep the recognized text but reset the decoder
    // so the next utterance is not re-decoded from the start of the whole session.
    if (recognizer.isEndpoint(stream)) {
      recognizer.reset(stream);
    }
  };

  let recording: AudioRecording;
  try {
    recording = await audioStudio.startRecording({
      sampleRate: config.descriptor.sampleRate,
      channels: 1,
      onAudioData: pump,
    });
  } catch (error) {
    recognizer.free();
    throw error;
  }

  let recorderStopped = false;
  const stopRecorder = async (): Promise<void> => {
    if (recorderStopped) {
      return;
    }
    recorderStopped = true;
    try {
      await recording.stop();
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
    try {
      recognizer.free();
    } catch {
      // Best-effort.
    }
    await deleteTemporaryAudio(recording.uri);
  };

  return {
    onPartial: (listener): void => {
      listeners.add(listener);
    },
    stop: async (): Promise<string> => {
      await stopRecorder();
      while (recognizer.isReady(stream)) {
        recognizer.decode(stream);
      }
      const finalText = recognizer.getResult(stream).text;
      await release();
      return finalText;
    },
    cancel: release,
    release,
  };
}

function buildConfig(config: SherpaVoiceRuntimeConfig): SherpaRecognizerConfig {
  const path = (fileName: string): string => `${config.modelDirectory}/${fileName}`;
  return {
    transducer: {
      encoder: path(config.descriptor.encoderFile),
      decoder: path(config.descriptor.decoderFile),
      joiner: path(config.descriptor.joinerFile),
    },
    tokens: path(config.descriptor.tokensFile),
    sampleRate: config.descriptor.sampleRate,
    featureDim: config.descriptor.featureDim,
    enableEndpoint: true,
  };
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

// Literal require strings (not a variable) so Metro can statically resolve the
// native packages once installed; the try/catch degrades to null when they are
// absent (Jest / Expo Go / unbuilt app).
function loadSherpa(): SherpaModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@siteed/sherpa-onnx.rn') as SherpaModule;
  } catch {
    return null;
  }
}

function loadAudioStudio(): AudioStudioModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@siteed/audio-studio') as AudioStudioModule;
  } catch {
    return null;
  }
}
