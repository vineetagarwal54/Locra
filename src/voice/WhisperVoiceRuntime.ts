// Real fully-offline voice runtime: captures 16 kHz mono Float32 PCM with
// `@siteed/audio-studio`, then transcribes the COMPLETED utterance with
// `whisper.rn` (whisper.cpp) into a single final transcript. There is deliberately
// no live/partial transcription — audio is only turned into text after the user
// stops. This is the ONLY module that touches those native packages.
//
// Why raw Float32 PCM (via `transcribeData`) instead of a WAV file: whisper.cpp
// wants 16 kHz mono float samples in [-1, 1], which is EXACTLY what audio-studio
// streams. Feeding the PCM straight through removes any WAV-container/sample-rate
// ambiguity (a WAV whose header whisper can't parse decodes as silence), which is
// the reliable path for on-device dictation.
//
// The packages are loaded LAZILY via `require()` and typed against their own
// published types — no `declare module` shim, so an absent package never looks
// installed and `isAvailable()` degrades to false in Jest / Expo Go / an unbuilt
// app.
//
// Fully offline: the model file is read from local storage and audio is processed
// on-device. No network APIs are used (the offline architecture guard covers this
// directory). Temp audio is deleted on success, failure, cancel, and release —
// raw audio is never persisted.

import { File } from 'expo-file-system';
import { LegacyEventEmitter } from 'expo-modules-core';

import type { VoiceModelDescriptor } from './VoiceModelDescriptor';
import { voiceModelFiles } from './VoiceModelDescriptor';
import type { VoiceSession, VoiceSessionRuntime } from './VoiceSession';

// ── Types drawn from the packages' own declarations (compile-time only) ──────

type InitWhisper = typeof import('whisper.rn').initWhisper;
type WhisperContext = Awaited<ReturnType<InitWhisper>>;

/** The audio-studio native module, narrowed to the recorder methods we use. */
interface AudioRecorderModule {
  startRecording(
    config: import('@siteed/audio-studio').RecordingConfig,
  ): Promise<import('@siteed/audio-studio').StartRecordingResult>;
  stopRecording(): Promise<import('@siteed/audio-studio').AudioRecording | null>;
}

/** The native `AudioData` event payload (audio-studio's internal `events.ts`). */
interface AudioDataNativeEvent {
  readonly pcmFloat32?: Float32Array | number[];
  readonly fileUri?: string;
  readonly deltaSize?: number;
}

interface EventSub {
  remove(): void;
}

const SAMPLE_RATE = 16_000;

export interface WhisperVoiceRuntimeConfig {
  readonly descriptor: VoiceModelDescriptor;
  /** Absolute directory (may be a `file://` URI) holding the descriptor's model file. */
  readonly modelDirectory: string;
}

/** True only when BOTH native packages resolve at runtime (real build, not Jest). */
export function isVoiceRuntimeAvailable(): boolean {
  return loadInitWhisper() !== null && loadAudioRecorder() !== null;
}

/** Builds the real record-then-transcribe session runtime bound to the local model. */
export function createWhisperVoiceRuntime(config: WhisperVoiceRuntimeConfig): VoiceSessionRuntime {
  return {
    isAvailable: isVoiceRuntimeAvailable,
    start: () => startSession(config),
  };
}

async function startSession(config: WhisperVoiceRuntimeConfig): Promise<VoiceSession> {
  const initWhisper = loadInitWhisper();
  const recorder = loadAudioRecorder();
  if (initWhisper === null || recorder === null) {
    throw new Error('The offline voice runtime is not installed in this build.');
  }

  let tempFileUri: string | undefined;
  let context: WhisperContext | null = null;
  let transcription: { stop: () => Promise<void> } | null = null;
  let released = false;
  let finalized = false;

  // Accumulate every Float32 PCM chunk the recorder streams; on stop they are
  // concatenated into one buffer and handed to whisper.
  const chunks: Float32Array[] = [];
  let totalSamples = 0;

  const emitter = new LegacyEventEmitter(recorder as unknown as object);
  const subscription: EventSub = emitter.addListener('AudioData', (event: AudioDataNativeEvent) => {
    if (released) {
      return;
    }
    const samples = toFloat32(event.pcmFloat32);
    if (samples !== null) {
      chunks.push(samples);
      totalSamples += samples.length;
    }
    if (tempFileUri === undefined && event.fileUri !== undefined && event.fileUri !== '') {
      tempFileUri = event.fileUri;
    }
  });

  // 16 kHz mono, streamed as Float32 PCM (pcm_32bit + streamFormat 'float32').
  const startResult = await recorder.startRecording({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    encoding: 'pcm_32bit',
    streamFormat: 'float32',
    interval: 250,
  }).catch((error: unknown) => {
    subscription.remove();
    throw error;
  });
  if (tempFileUri === undefined && startResult.fileUri !== '') {
    tempFileUri = startResult.fileUri;
  }
  if (__DEV__) {
    // Sanitized dev-only diagnostic — no file path, no audio, no transcript.
    console.log('[Locra][voice] recording started');
  }

  let recorderStopped = false;
  const stopRecorder = async (): Promise<void> => {
    if (recorderStopped) {
      return;
    }
    recorderStopped = true;
    // Stop the recorder FIRST so its final buffered AudioData chunk is still
    // delivered to the live listener, THEN remove the listener. Removing it before
    // stopRecording() would truncate the tail of the recording.
    try {
      const recording = await recorder.stopRecording();
      if (recording?.fileUri !== undefined && recording.fileUri !== '') {
        tempFileUri = recording.fileUri;
      }
    } catch {
      // Best-effort; a lost/interrupted recorder must not throw on teardown.
    }
    subscription.remove();
  };

  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    released = true;
    try {
      await transcription?.stop();
    } catch {
      // Best-effort abort of an in-flight decode.
    }
    await stopRecorder();
    if (context !== null) {
      try {
        await context.release();
      } catch {
        // Best-effort.
      }
      context = null;
    }
    chunks.length = 0;
    await deleteTemporaryAudio(tempFileUri);
  };

  return {
    // Whisper produces no live partials; text appears only after stop. The store
    // never receives a partial, so the composer draft is untouched while recording.
    onPartial: (): void => undefined,
    stop: async (): Promise<string> => {
      // Idempotent: a second stop (e.g. manual tap racing the auto-stop) never
      // re-runs the recorder/transcription or appends duplicate samples.
      if (finalized) {
        return '';
      }
      finalized = true;
      await stopRecorder();
      try {
        const pcm = concatSamples(chunks, totalSamples);
        if (__DEV__) {
          // Sanitized: recording length only — no path, no audio, no transcript.
          console.log(`[Locra][voice] recorded ${(pcm.length / SAMPLE_RATE).toFixed(1)}s`);
        }
        if (pcm.length === 0) {
          return '';
        }
        // whisper.rn's `transcribeData` decodes the ArrayBuffer as 16-bit signed
        // PCM (native `decodePcm16`), NOT float32 — so convert the captured
        // float samples ([-1, 1]) to Int16 before handing them over.
        const int16 = floatToInt16(pcm);
        const modelPath = stripFileScheme(
          joinPath(config.modelDirectory, config.descriptor.modelFile),
        );
        context = await initWhisper({ filePath: modelPath, useGpu: false });
        // `int16` is freshly allocated, so its backing store is a plain
        // ArrayBuffer (never a SharedArrayBuffer).
        const handle = context.transcribeData(int16.buffer as ArrayBuffer, {
          language: 'en',
          maxThreads: 4,
        });
        transcription = handle;
        const result = await handle.promise;
        const text = result.isAborted ? '' : cleanTranscript(result.result);
        if (__DEV__) {
          // Sanitized: length + aborted flag only — never the transcript text.
          console.log(`[Locra][voice] transcript length=${text.length} aborted=${result.isAborted}`);
        }
        return text;
      } finally {
        // Always release the context and delete the temp audio — on success AND
        // on a decode failure.
        await release();
      }
    },
    cancel: release,
    release,
  };
}

/** Normalizes the native Float32 payload (Float32Array on Android, number[] on iOS). */
function toFloat32(pcm: Float32Array | number[] | undefined): Float32Array | null {
  if (pcm === undefined) {
    return null;
  }
  if (pcm instanceof Float32Array) {
    return pcm.length > 0 ? pcm : null;
  }
  return pcm.length > 0 ? Float32Array.from(pcm) : null;
}

/** Concatenates the streamed chunks into one contiguous Float32 PCM buffer. */
function concatSamples(chunks: readonly Float32Array[], totalSamples: number): Float32Array {
  const out = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Converts float samples in [-1, 1] to signed 16-bit PCM (what whisper.rn reads). */
function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

function joinPath(directory: string, fileName: string): string {
  return directory.endsWith('/') ? `${directory}${fileName}` : `${directory}/${fileName}`;
}

// whisper.cpp emits bracketed non-speech markers (e.g. "[BLANK_AUDIO]",
// "(silence)") for empty audio — strip them so they are treated as "no speech"
// rather than dictated text.
function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:silence|blank[^)]*|music|inaudible)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** whisper.rn / native file APIs want a bare absolute path, not a `file://` URI. */
function stripFileScheme(path: string): string {
  return path.startsWith('file://') ? path.slice('file://'.length) : path;
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

/** Confirms the model file exists locally before a session is attempted. */
export function voiceModelIsInstalled(config: WhisperVoiceRuntimeConfig): boolean {
  return voiceModelFiles(config.descriptor).every((fileName) => {
    try {
      return new File(joinPath(config.modelDirectory, fileName)).exists;
    } catch {
      return false;
    }
  });
}

// Literal require strings (not a variable) so Metro can statically resolve the
// native packages once installed; the try/catch degrades to null when they are
// absent (Jest / Expo Go / an unbuilt app).
function loadInitWhisper(): InitWhisper | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('whisper.rn') as { initWhisper?: InitWhisper };
    return typeof mod.initWhisper === 'function' ? mod.initWhisper : null;
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
