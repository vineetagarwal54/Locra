// Offline speech model descriptor for the Sherpa-ONNX streaming recognizer.
//
// The descriptor is intentionally data-only and CONFIGURABLE: the initial model
// is a small streaming English Zipformer, but a more accurate English model can
// replace it by swapping this descriptor without touching the runtime/store. The
// model is stored in its OWN directory, entirely separate from the Qwen language
// model and vision projector artifacts, so voice setup/removal never affects Qwen.

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
  /** Sherpa online-transducer model files (relative to the model directory). */
  readonly encoderFile: string;
  readonly decoderFile: string;
  readonly joinerFile: string;
  readonly tokensFile: string;
  /** PCM the recognizer expects: 16 kHz mono. */
  readonly sampleRate: 16_000;
  readonly featureDim: number;
  /**
   * Base URL each model file name is resolved against for download. This is a
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
 * Initial model: streaming English Zipformer (20M, int8). Small enough for a
 * 6–8 GB device and produces repeated partial results as PCM is fed in.
 * Replaceable via {@link VoiceModelDescriptor} with a larger, more accurate
 * English model later.
 *
 * Source: k2-fsa sherpa-onnx model zoo, mirrored on Hugging Face. The SHA-256
 * checksums below are the real per-file digests (Git-LFS OIDs for the ONNX
 * files, computed digest for the plain-text tokens), verified on-device after
 * download by the native integrity hasher.
 */
export const DEFAULT_VOICE_MODEL: VoiceModelDescriptor = {
  id: 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-int8',
  displayName: 'English streaming (Zipformer 20M, int8)',
  // Sum of the four files below: 42,845,182 + 2,092,272 + 259,572 + 5,048.
  approxSizeBytes: 45_202_074,
  encoderFile: 'encoder-epoch-99-avg-1.int8.onnx',
  decoderFile: 'decoder-epoch-99-avg-1.onnx',
  joinerFile: 'joiner-epoch-99-avg-1.int8.onnx',
  tokensFile: 'tokens.txt',
  sampleRate: 16_000,
  featureDim: 80,
  downloadBaseUrl:
    'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/resolve/main',
  checksums: {
    'encoder-epoch-99-avg-1.int8.onnx': {
      sha256: '3810755ce7c3ab26b42a8bcf39d191308fa27fb0f53358823ba46141d03b7eb3',
      sizeBytes: 42_845_182,
    },
    'decoder-epoch-99-avg-1.onnx': {
      sha256: '45a7f940ecfb53d89fa270ad11b88b961e53a317203eb24b1c8e95ed208b0f30',
      sizeBytes: 2_092_272,
    },
    'joiner-epoch-99-avg-1.int8.onnx': {
      sha256: 'e085d73b593cf9b0707f370dbd656d58327d3fe36d80d849202ef81df02cb01e',
      sizeBytes: 259_572,
    },
    'tokens.txt': {
      sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb',
      sizeBytes: 5_048,
    },
  },
};

/** The model files that must all exist for the model to be considered installed. */
export function voiceModelFiles(descriptor: VoiceModelDescriptor): readonly string[] {
  return [
    descriptor.encoderFile,
    descriptor.decoderFile,
    descriptor.joinerFile,
    descriptor.tokensFile,
  ];
}
