import { requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { useEffect, useRef } from 'react';
import { WHISPER_TINY_EN, useSpeechToText } from 'react-native-executorch';

import {
  TARGET_SAMPLE_RATE,
  float32FromArrayBuffer,
  prepareWaveformForTranscription,
} from './AudioWaveform';
import { inferenceActivityLock } from './InferenceActivityLock';

// ─────────────────────────────────────────────────────────────────────────────
// The ONE sanctioned call site for `useSpeechToText` and `useAudioStream`
// (constitution Principle X, mirroring useInferenceEngine.ts). No other module
// imports either hook. It isolates their hook-shaped state behind a plain
// imperative handle the voice store drives from outside React.
//
// API-reality note (Principle IX): react-native-executorch 0.9.2 has NO
// `useWhisper`. The real hook is `useSpeechToText`, which only transcribes a
// supplied 16 kHz Float32Array — microphone capture is expo-audio's
// `useAudioStream` (real-time Float32 PCM). Whisper is a SEPARATE model that
// auto-downloads when this hook mounts, which is why the host is mounted lazily
// (only after the user first asks for voice) rather than at app start.
// ─────────────────────────────────────────────────────────────────────────────

export interface VoiceTranscriptionHandle {
  /** Acquires the shared voice⇄VLM lock and begins capturing microphone audio. */
  startRecording(): Promise<void>;
  /** Stops capture, transcribes the buffered audio, releases the lock, returns text. */
  stopAndTranscribe(): Promise<string>;
  /** Aborts an in-progress recording, discards audio, releases the lock. */
  cancelRecording(): void;
  /** Whether the Whisper model is downloaded and ready. */
  isReady(): boolean;
  /** Whether the model is still downloading/preparing (no error yet). */
  isModelLoading(): boolean;
  /** Model download progress, 0–1. */
  downloadProgress(): number;
  isRecording(): boolean;
  isTranscribing(): boolean;
  getError(): string | null;
  subscribe(listener: () => void): () => void;
}

export function useVoiceTranscription(): VoiceTranscriptionHandle {
  const stt = useSpeechToText({ model: WHISPER_TINY_EN });

  const capturedChunks = useRef<Float32Array[]>([]);
  const capturedSampleRate = useRef<number>(TARGET_SAMPLE_RATE);

  // The stream is created but idle until start() — no mic access until then.
  const { stream } = useAudioStream({
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    encoding: 'float32',
    onBuffer: (buffer) => {
      capturedChunks.current.push(float32FromArrayBuffer(buffer.data));
      capturedSampleRate.current = buffer.sampleRate;
    },
  });

  const sttRef = useRef(stt);
  const streamRef = useRef(stream);
  const recordingRef = useRef(false);
  const transcribingRef = useRef(false);
  const listenersRef = useRef<Set<() => void>>(new Set());

  const notify = (): void => {
    for (const listener of listenersRef.current) {
      listener();
    }
  };

  useEffect(() => {
    sttRef.current = stt;
    notify();
  }, [stt, stt.isReady, stt.isGenerating, stt.downloadProgress, stt.error]);

  useEffect(() => {
    streamRef.current = stream;
  }, [stream]);

  const handleRef = useRef<VoiceTranscriptionHandle | null>(null);
  if (handleRef.current === null) {
    const listeners = listenersRef.current;
    handleRef.current = {
      startRecording: async (): Promise<void> => {
        // FR-033: never record while a VLM inference holds the shared lock.
        if (!inferenceActivityLock.tryAcquire('voice')) {
          throw new Error('Locra is answering right now. Try again in a moment.');
        }
        try {
          const permission = await requestRecordingPermissionsAsync();
          if (!permission.granted) {
            throw new Error('Microphone access is needed to talk to Locra.');
          }
          if (!sttRef.current.isReady) {
            throw new Error('The voice model is still getting ready.');
          }
          capturedChunks.current = [];
          capturedSampleRate.current = TARGET_SAMPLE_RATE;
          recordingRef.current = true;
          notify();
          await streamRef.current.start();
        } catch (error) {
          recordingRef.current = false;
          inferenceActivityLock.release('voice');
          notify();
          throw error;
        }
      },

      stopAndTranscribe: async (): Promise<string> => {
        if (!recordingRef.current) {
          return '';
        }
        safeStopStream(streamRef.current);
        recordingRef.current = false;
        transcribingRef.current = true;
        notify();
        try {
          const waveform = prepareWaveformForTranscription(
            capturedChunks.current,
            capturedSampleRate.current,
          );
          capturedChunks.current = [];
          if (waveform.length === 0) {
            return '';
          }
          const result = await sttRef.current.transcribe(waveform);
          return result.text.trim();
        } finally {
          transcribingRef.current = false;
          inferenceActivityLock.release('voice');
          notify();
        }
      },

      cancelRecording: (): void => {
        if (recordingRef.current) {
          safeStopStream(streamRef.current);
        }
        capturedChunks.current = [];
        recordingRef.current = false;
        transcribingRef.current = false;
        inferenceActivityLock.release('voice');
        notify();
      },

      isReady: (): boolean => sttRef.current.isReady,
      isModelLoading: (): boolean => !sttRef.current.isReady && sttRef.current.error === null,
      downloadProgress: (): number => sttRef.current.downloadProgress,
      isRecording: (): boolean => recordingRef.current,
      isTranscribing: (): boolean => transcribingRef.current,
      getError: (): string | null =>
        sttRef.current.error ? sttRef.current.error.message : null,
      subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  return handleRef.current;
}

function safeStopStream(stream: { stop: () => void }): void {
  try {
    stream.stop();
  } catch {
    // Recording cleanup must always release the shared voice/VLM lock.
  }
}
