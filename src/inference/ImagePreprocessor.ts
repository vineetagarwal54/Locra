import { loadImage } from 'react-native-nitro-image';

// Constitution Principle IV: constrained hardware cannot be trusted with an
// arbitrarily large tensor. 512x512 is a HARD CEILING on the longest edge —
// every image handed to the model passes through here first, and nothing above
// this size is ever loaded. This is not a suggestion or a default.
export const MAX_IMAGE_DIMENSION = 512;

// Re-encode quality when a resize happens. JPEG keeps the on-disk temp small
// without a meaningful quality loss at <=512px.
const RESIZE_QUALITY = 85;

export interface PreprocessedImage {
  /** Filesystem path to the image the model should consume (no `file://` prefix). */
  path: string;
  width: number;
  height: number;
}

/**
 * Loads the captured image, and if either edge exceeds {@link MAX_IMAGE_DIMENSION}
 * scales it down (preserving aspect ratio) so the longest edge sits exactly on
 * the ceiling. Images already within the ceiling pass through untouched — no
 * re-encode, original path returned. Anything that is not a readable image
 * rejects with a clear error rather than reaching model/tensor code.
 */
export async function preprocessImage(imagePath: string): Promise<PreprocessedImage> {
  if (typeof imagePath !== 'string' || imagePath.trim() === '') {
    throw new Error('ImagePreprocessor: a non-empty image path is required.');
  }

  let image;
  try {
    image = await loadImage({ filePath: imagePath });
  } catch (cause) {
    throw new Error(
      `ImagePreprocessor: "${imagePath}" could not be loaded as an image (${describe(cause)}).`,
    );
  }

  const { width, height } = image;

  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    // Already within the ceiling — pass through unchanged.
    return { path: imagePath, width, height };
  }

  const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const resized = await image.resizeAsync(targetWidth, targetHeight);
  const path = await resized.saveToTemporaryFileAsync('jpg', RESIZE_QUALITY);

  return { path, width: resized.width, height: resized.height };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
