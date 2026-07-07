jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));
jest.mock('react-native-nitro-image', () => ({
  loadImage: jest.fn(() =>
    Promise.resolve({
      width: 512,
      height: 384,
    })
  ),
}));

import {
  ENHANCE_MAX_DIMENSION,
  MAX_ASPECT_RATIO,
  enhanceImage,
  prepareImageForInference,
  resolveCropRegion,
  type ManipulateFn,
} from '../../../src/inference/ImageEnhancer';
import type { PreprocessedImage } from '../../../src/inference/ImagePreprocessor';

interface RecordedCall {
  uri: string;
  actions: Array<Record<string, unknown>>;
}

/**
 * Builds an injectable manipulate mock that simulates EXIF auto-orientation on
 * the first (bare) pass and applies crop/resize arithmetic on later passes,
 * recording every call for assertions.
 */
function makeManipulator(orientedWidth: number, orientedHeight: number) {
  const calls: RecordedCall[] = [];
  let width = orientedWidth;
  let height = orientedHeight;

  const manipulate: ManipulateFn = (uri, actions) => {
    calls.push({ uri, actions: actions as Array<Record<string, unknown>> });
    for (const action of actions) {
      const crop = (action as { crop?: { width: number; height: number } }).crop;
      if (crop !== undefined) {
        width = crop.width;
        height = crop.height;
      }
      const resize = (action as { resize?: { width?: number; height?: number } }).resize;
      if (resize !== undefined) {
        const scale =
          resize.width !== undefined ? resize.width / width : (resize.height ?? height) / height;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
    }
    return Promise.resolve({ uri: `${uri}.pass${calls.length}.jpg`, width, height });
  };

  return { manipulate, calls };
}

describe('ImageEnhancer (FR-049)', () => {
  it('always runs an orientation-bake pass first, with no actions', async () => {
    const { manipulate, calls } = makeManipulator(800, 600);

    await enhanceImage('/camera/photo.jpg', { manipulate });

    expect(calls[0].uri).toBe('file:///camera/photo.jpg');
    expect(calls[0].actions).toEqual([]);
  });

  it('returns the oriented image untouched when it is small and has a normal aspect ratio', async () => {
    const { manipulate, calls } = makeManipulator(800, 600);

    const result = await enhanceImage('/camera/photo.jpg', { manipulate });

    expect(calls).toHaveLength(1);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.path).not.toContain('file://');
  });

  it('downscales the longest edge to the enhancement ceiling when the image is large', async () => {
    const { manipulate, calls } = makeManipulator(4032, 3024);

    const result = await enhanceImage('/camera/large.jpg', { manipulate });

    expect(calls).toHaveLength(2);
    expect(calls[1].actions).toEqual([
      { resize: { width: ENHANCE_MAX_DIMENSION } },
    ]);
    expect(result.width).toBe(ENHANCE_MAX_DIMENSION);
  });

  it('downscales portrait images along the height axis', async () => {
    const { manipulate, calls } = makeManipulator(3024, 4032);

    const result = await enhanceImage('/camera/portrait.jpg', { manipulate });

    expect(calls[1].actions).toEqual([
      { resize: { height: ENHANCE_MAX_DIMENSION } },
    ]);
    expect(result.height).toBe(ENHANCE_MAX_DIMENSION);
  });

  it('center-crops extreme aspect ratios to the aspect ceiling before downscaling', async () => {
    // 4000x1000 is 4:1 — far beyond the 16:9 ceiling.
    const { manipulate, calls } = makeManipulator(4000, 1000);

    await enhanceImage('/camera/pano.jpg', { manipulate });

    const expectedCropWidth = Math.round(1000 * MAX_ASPECT_RATIO);
    expect(calls[1].actions[0]).toEqual({
      crop: {
        originX: Math.round((4000 - expectedCropWidth) / 2),
        originY: 0,
        width: expectedCropWidth,
        height: 1000,
      },
    });
  });

  it('crops to a provided subject region, clamped to the image bounds', async () => {
    const { manipulate, calls } = makeManipulator(2000, 1500);

    await enhanceImage('/camera/subject.jpg', {
      manipulate,
      subjectRegion: { x: 1800, y: -50, width: 600, height: 800 },
    });

    const crop = (calls[1].actions[0] as { crop: Record<string, number> }).crop;
    expect(crop.originX + crop.width).toBeLessThanOrEqual(2000);
    expect(crop.originY).toBeGreaterThanOrEqual(0);
    expect(crop.originY + crop.height).toBeLessThanOrEqual(1500);
  });

  it('keeps a normal-aspect image uncropped (the sensible centered default is the full frame)', () => {
    expect(resolveCropRegion(1600, 1200)).toBeNull();
    expect(resolveCropRegion(1200, 1600)).toBeNull();
  });

  it('prepareImageForInference chains enhance → preprocess, feeding the enhanced path onward', async () => {
    const preprocessed: PreprocessedImage = { path: '/tmp/final.jpg', width: 512, height: 384 };
    const enhance = jest.fn(() =>
      Promise.resolve({ path: '/tmp/enhanced.jpg', width: 1024, height: 768 })
    );
    const preprocess = jest.fn(() => Promise.resolve(preprocessed));

    const result = await prepareImageForInference('/camera/photo.jpg', { enhance, preprocess });

    expect(enhance).toHaveBeenCalledWith('/camera/photo.jpg');
    expect(preprocess).toHaveBeenCalledWith('/tmp/enhanced.jpg');
    expect(result).toBe(preprocessed);
  });

  it('prepareImageForInference falls back to the original path when enhancement fails', async () => {
    const preprocessed: PreprocessedImage = { path: '/tmp/final.jpg', width: 512, height: 384 };
    const enhance = jest.fn(() => Promise.reject(new Error('decode failed')));
    const preprocess = jest.fn(() => Promise.resolve(preprocessed));

    const result = await prepareImageForInference('/camera/photo.jpg', { enhance, preprocess });

    expect(preprocess).toHaveBeenCalledWith('/camera/photo.jpg');
    expect(result).toBe(preprocessed);
  });

  it('rejects an empty image path with a clear error', async () => {
    const { manipulate } = makeManipulator(800, 600);

    await expect(enhanceImage('  ', { manipulate })).rejects.toThrow(/image path/i);
  });
});
