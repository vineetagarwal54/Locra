// Pure audio math for the voice-input path (FR-033). `useAudioStream` delivers
// Float32 PCM buffers (samples in [-1, 1]) at whatever rate the hardware gives;
// `useSpeechToText` needs a single 16 kHz mono Float32Array. These helpers do
// the concatenation + resampling with zero native or React dependency, so they
// are fully unit-testable off-device.

/** Whisper's required input sample rate. */
export const TARGET_SAMPLE_RATE = 16000;

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Views a raw little-endian PCM float32 ArrayBuffer as a Float32Array (copy). */
export function float32FromArrayBuffer(buffer: ArrayBuffer): Float32Array {
  return new Float32Array(buffer.slice(0));
}

/**
 * Linear-interpolation resampler. Cheap and good enough for speech at these
 * rates (Whisper is robust to mild resampling artifacts). Returns the input
 * unchanged when the rates already match.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) {
    return input;
  }

  const ratio = fromRate / toRate;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const frac = position - lower;
    out[i] = input[lower] * (1 - frac) + input[upper] * frac;
  }

  return out;
}

/**
 * The full capture→waveform pipeline: concatenate the streamed chunks and
 * resample to {@link TARGET_SAMPLE_RATE} for Whisper.
 */
export function prepareWaveformForTranscription(
  chunks: Float32Array[],
  sampleRate: number,
): Float32Array {
  return resampleLinear(concatFloat32(chunks), sampleRate, TARGET_SAMPLE_RATE);
}
