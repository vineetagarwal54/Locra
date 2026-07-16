// Offline speech model descriptor for the Sherpa-ONNX streaming recognizer.
//
// The descriptor is intentionally data-only and CONFIGURABLE: the initial model
// is a small streaming English Zipformer, but a more accurate English model can
// replace it by swapping this descriptor without touching the runtime/store. The
// model is stored in its OWN directory, entirely separate from the Qwen language
// model and vision projector artifacts, so voice setup/removal never affects Qwen.

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
}

/** On-disk root for voice models — kept separate from the Qwen artifacts directory. */
export const VOICE_MODEL_DIR_NAME = 'locra-voice-models';

/**
 * Initial model: streaming English Zipformer (int8). Small enough for a 6–8 GB
 * device and produces repeated partial results as PCM is fed in. Replaceable via
 * {@link VoiceModelDescriptor} with a larger, more accurate English model later.
 */
export const DEFAULT_VOICE_MODEL: VoiceModelDescriptor = {
  id: 'sherpa-onnx-streaming-zipformer-en-20M-2023-02-17-int8',
  displayName: 'English streaming (Zipformer 20M, int8)',
  approxSizeBytes: 70 * 1024 * 1024,
  encoderFile: 'encoder-epoch-99-avg-1.int8.onnx',
  decoderFile: 'decoder-epoch-99-avg-1.onnx',
  joinerFile: 'joiner-epoch-99-avg-1.int8.onnx',
  tokensFile: 'tokens.txt',
  sampleRate: 16_000,
  featureDim: 80,
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
