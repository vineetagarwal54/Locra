// Offline speech model descriptor for the whisper.rn (whisper.cpp) recognizer.
//
// The descriptor is intentionally data-only and CONFIGURABLE: the initial model
// is a small English Whisper (base, q5_1) suitable for a 6–8 GB device, but a
// larger/smaller English model can replace it by swapping this descriptor without
// touching the runtime/store. The model is stored in its OWN directory, entirely
// separate from the Qwen language model and vision projector, so voice setup and
// removal never affect Qwen.

/** A single downloadable model file with its integrity checksum. */
export interface VoiceModelFileSpec {
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface VoiceModelDescriptor {
  /** Stable id; also the on-disk sub-directory name under the voice models root. */
  readonly id: string;
  readonly displayName: string;
  /** Approximate on-disk size, disclosed to the user before any download. */
  readonly approxSizeBytes: number;
  /** whisper.cpp GGML model file (relative to the model directory). */
  readonly modelFile: string;
  /** PCM the recorder captures for whisper: 16 kHz mono. */
  readonly sampleRate: 16_000;
  /**
   * Base URL the model file name is resolved against for download. This is a
   * data-only string; the actual network transfer happens in the artifact
   * adapter OUTSIDE `src/voice` (the offline guard keeps this directory free of
   * networking CALLS, and a URL constant is not one).
   */
  readonly downloadBaseUrl: string;
  /** Per-file integrity checksums (SHA-256) + expected sizes, keyed by file name. */
  readonly checksums: Readonly<Record<string, VoiceModelFileSpec>>;
}

/** On-disk root for voice models — kept separate from the Qwen artifacts directory. */
export const VOICE_MODEL_DIR_NAME = 'locra-voice-models';

/**
 * Initial model: English Whisper base, q5_1 quantized (~57 MB). Small enough for
 * a 6–8 GB device, transcribes a completed recording into a single final result.
 * Replaceable via {@link VoiceModelDescriptor} (e.g. tiny.en-q5_1 for speed, or
 * small.en-q5_1 for accuracy) without touching the runtime.
 *
 * Source: ggerganov/whisper.cpp on Hugging Face. The SHA-256 below is the real
 * Git-LFS OID for the file, verified on-device after download by the native
 * integrity hasher.
 */
export const DEFAULT_VOICE_MODEL: VoiceModelDescriptor = {
  id: 'whisper-base-en-q5_1',
  displayName: 'English speech (Whisper base, q5_1)',
  approxSizeBytes: 59_721_011,
  modelFile: 'ggml-base.en-q5_1.bin',
  sampleRate: 16_000,
  downloadBaseUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main',
  checksums: {
    'ggml-base.en-q5_1.bin': {
      sha256: '4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f',
      sizeBytes: 59_721_011,
    },
  },
};

/** The model files that must all exist for the model to be considered installed. */
export function voiceModelFiles(descriptor: VoiceModelDescriptor): readonly string[] {
  return [descriptor.modelFile];
}
