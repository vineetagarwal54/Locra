import {
  TARGET_SAMPLE_RATE,
  concatFloat32,
  float32FromArrayBuffer,
  prepareWaveformForTranscription,
  resampleLinear,
} from '../../../src/inference/AudioWaveform';

describe('AudioWaveform helpers (FR-033 voice capture math)', () => {
  it('concatenates Float32 chunks in order', () => {
    const out = concatFloat32([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array([4, 5]),
    ]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('concat of nothing is an empty waveform', () => {
    expect(concatFloat32([]).length).toBe(0);
  });

  it('reads a Float32Array out of a raw little-endian ArrayBuffer', () => {
    const source = new Float32Array([0.25, -0.5, 1]);
    const copy = float32FromArrayBuffer(source.buffer.slice(0));
    expect(Array.from(copy)).toEqual([0.25, -0.5, 1]);
  });

  it('resampleLinear returns the input unchanged when the rate already matches', () => {
    const input = new Float32Array([0, 0.5, 1]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it('downsamples 48kHz to 16kHz by a 3:1 ratio (length ~ 1/3)', () => {
    const input = new Float32Array(48000).fill(0.1);
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(16000);
    // A constant signal stays constant through linear interpolation.
    expect(out[0]).toBeCloseTo(0.1, 5);
    expect(out[out.length - 1]).toBeCloseTo(0.1, 5);
  });

  it('linearly interpolates between samples when downsampling a ramp', () => {
    // 0,1,2,3 at 2 Hz → resample to 1 Hz picks indices 0 and 2 → [0, 2].
    const out = resampleLinear(new Float32Array([0, 1, 2, 3]), 2, 1);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(2, 5);
  });

  it('prepareWaveformForTranscription concatenates then resamples to 16kHz', () => {
    const chunks = [new Float32Array(24000).fill(0.2), new Float32Array(24000).fill(0.2)];
    const out = prepareWaveformForTranscription(chunks, 48000);
    expect(out.length).toBe(TARGET_SAMPLE_RATE);
    expect(out[100]).toBeCloseTo(0.2, 5);
  });

  it('prepareWaveformForTranscription leaves an already-16kHz stream untouched in length', () => {
    const out = prepareWaveformForTranscription([new Float32Array(16000).fill(0)], 16000);
    expect(out.length).toBe(16000);
  });
});
