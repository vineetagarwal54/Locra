
import { loadImage } from 'react-native-nitro-image';

import { MAX_IMAGE_DIMENSION, preprocessImage } from '../../../src/inference/ImagePreprocessor';

// The native image backend (react-native-nitro-image) is unavailable under Jest,
// so we mock loadImage. The preprocessor is the only place that touches it.
jest.mock('react-native-nitro-image', () => ({
  loadImage: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires


const mockLoadImage = loadImage as jest.Mock;

interface FakeImage {
  width: number;
  height: number;
  resizeAsync: jest.Mock;
  saveToTemporaryFileAsync: jest.Mock;
}

function fakeImage(width: number, height: number): FakeImage {
  const image: FakeImage = {
    width,
    height,
    resizeAsync: jest.fn(async (w: number, h: number) => fakeImage(w, h)),
    saveToTemporaryFileAsync: jest.fn(async () => '/tmp/locra-resized.jpg'),
  };
  return image;
}

describe('preprocessImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resizes input above 512x512 down to the 512 ceiling', async () => {
    const source = fakeImage(1024, 1024);
    mockLoadImage.mockReturnValue(source);

    const result = await preprocessImage('/tmp/capture.jpg');

    // Constitution Principle IV: 512x512 is a hard ceiling, not a suggestion.
    expect(source.resizeAsync).toHaveBeenCalledWith(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION);
    expect(result.width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    expect(result.height).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    expect(Math.max(result.width, result.height)).toBe(MAX_IMAGE_DIMENSION);
    expect(result.path).toBe('/tmp/locra-resized.jpg');
  });

  it('preserves aspect ratio when clamping the longest edge to the ceiling', async () => {
    const source = fakeImage(1024, 512);
    mockLoadImage.mockReturnValue(source);

    const result = await preprocessImage('/tmp/wide.jpg');

    expect(source.resizeAsync).toHaveBeenCalledWith(512, 256);
    expect(result.width).toBe(512);
    expect(result.height).toBe(256);
  });

  it.each([
    { label: 'wide', width: 8000, height: 1000, targetWidth: 512, targetHeight: 64 },
    { label: 'tall', width: 1000, height: 8000, targetWidth: 64, targetHeight: 512 },
  ])(
    'fits the complete $label image within the 512 ceiling without changing its aspect ratio',
    async ({ width, height, targetWidth, targetHeight }) => {
      const source = fakeImage(width, height);
      mockLoadImage.mockReturnValue(source);

      const result = await preprocessImage(`/tmp/${width}x${height}.jpg`);

      expect(source.resizeAsync).toHaveBeenCalledWith(targetWidth, targetHeight);
      expect(result).toMatchObject({ width: targetWidth, height: targetHeight });
      expect(result.width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
      expect(result.height).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    }
  );

  it('passes through input already <= 512x512 unchanged', async () => {
    const source = fakeImage(400, 300);
    mockLoadImage.mockReturnValue(source);

    const result = await preprocessImage('/tmp/small.jpg');

    expect(source.resizeAsync).not.toHaveBeenCalled();
    expect(source.saveToTemporaryFileAsync).not.toHaveBeenCalled();
    expect(result.path).toBe('/tmp/small.jpg');
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  it('passes through input exactly at the 512x512 boundary unchanged', async () => {
    const source = fakeImage(512, 512);
    mockLoadImage.mockReturnValue(source);

    const result = await preprocessImage('/tmp/exact.jpg');

    expect(source.resizeAsync).not.toHaveBeenCalled();
    expect(result.path).toBe('/tmp/exact.jpg');
  });

  it('rejects non-image input with a clear error', async () => {
    mockLoadImage.mockImplementation(() => {
      throw new Error('unsupported file format');
    });

    await expect(preprocessImage('/tmp/notes.txt')).rejects.toThrow(/image/i);
  });

  it('rejects an empty path with a clear error before touching the native backend', async () => {
    await expect(preprocessImage('')).rejects.toThrow(/path/i);
    expect(mockLoadImage).not.toHaveBeenCalled();
  });
});
