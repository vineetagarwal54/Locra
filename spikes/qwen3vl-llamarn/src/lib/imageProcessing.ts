import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

/**
 * Vision pre-processing + verification for the spike.
 *
 * The Qwen3-VL projector is expensive on-device, so every image is downscaled
 * to a maximum edge before it reaches llama.rn. Just as important, we refuse to
 * run inference on an image we could not fully verify: a missing/unreadable
 * source, a zero-dimension asset, or a resized temp file that never landed on
 * disk are all common ways the native multimodal path silently hangs or crashes.
 */

/** Longest edge (px) allowed into the vision encoder. Larger images downscale. */
export const MAX_IMAGE_EDGE = 512

/** Guard against absurd source files (an unreadable/corrupt pick reports huge sizes). */
const MAX_SOURCE_BYTES = 64 * 1024 * 1024 // 64 MB

/** All processed temp images live here so cleanup only ever touches our files. */
const VISION_TEMP_DIR = 'vision-temp'

/** The subset of an ImagePicker asset we care about. */
export type SelectedImage = {
  uri: string
  width: number
  height: number
  sizeBytes: number | null
  mimeType: string | null
  type: string | null
  fileName: string | null
}

/** A verified, resized image ready to hand to llama.rn. */
export type ProcessedImage = {
  uri: string
  width: number
  height: number
  sizeBytes: number
  resized: boolean
}

/** Metadata about the original source file, resolved from disk (not just the asset). */
export type OriginalImageInfo = {
  uri: string
  exists: boolean
  readable: boolean
  width: number
  height: number
  sizeBytes: number | null
  mimeType: string | null
  type: string | null
  fileName: string | null
}

/** Thrown when verification fails. `errors` lists every problem found. */
export class ImageVerificationError extends Error {
  readonly errors: string[]
  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'ImageVerificationError'
    this.errors = errors
  }
}

function tempDir(): Directory {
  return new Directory(Paths.cache, VISION_TEMP_DIR)
}

function ensureTempDir(): Directory {
  const dir = tempDir()
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  return dir
}

/**
 * Resolve on-disk facts about the selected source image. Never throws — a
 * missing or unreadable file simply comes back with `exists`/`readable` false
 * and a null size so the caller can report a precise validation error.
 */
export function inspectOriginalImage(image: SelectedImage): OriginalImageInfo {
  let exists = false
  let readable = false
  let sizeBytes: number | null = null
  try {
    const file = new File(image.uri)
    exists = file.exists
    if (exists) {
      // `size` is 0 when the file exists but cannot be read; treat >0 as readable.
      const size = file.size
      sizeBytes = size
      readable = size > 0
    }
  } catch {
    // Malformed/unsupported URI (e.g. a content:// we cannot open) → unreadable.
    exists = false
    readable = false
    sizeBytes = null
  }
  // Prefer the picker-reported size when the fs could not read one.
  if (sizeBytes == null && image.sizeBytes != null) sizeBytes = image.sizeBytes

  return {
    uri: image.uri,
    exists,
    readable,
    width: image.width,
    height: image.height,
    sizeBytes,
    mimeType: image.mimeType ?? null,
    type: image.type ?? null,
    fileName: image.fileName ?? null,
  }
}

/**
 * Validate the original image before we spend time resizing or running the
 * projector. Returns every problem so the UI can show all of them at once.
 */
export function verifyOriginalImage(info: OriginalImageInfo): string[] {
  const errors: string[] = []

  if (!info.uri) {
    errors.push('No image URI was provided.')
    return errors
  }
  if (!info.exists) {
    errors.push(`Selected image does not exist on disk: ${info.uri}`)
  } else if (!info.readable) {
    errors.push(`Selected image exists but is not readable: ${info.uri}`)
  }

  // Size validation.
  if (info.sizeBytes == null) {
    errors.push('Could not determine image file size.')
  } else if (info.sizeBytes <= 0) {
    errors.push('Image file size is zero bytes.')
  } else if (info.sizeBytes > MAX_SOURCE_BYTES) {
    errors.push(
      `Image is too large (${(info.sizeBytes / (1024 * 1024)).toFixed(1)} MB, max ${MAX_SOURCE_BYTES / (1024 * 1024)} MB).`,
    )
  }

  // MIME / asset-type validation.
  if (info.type != null && info.type !== 'image') {
    errors.push(`Selected asset is not an image (type: ${info.type}).`)
  }
  if (info.mimeType != null && !info.mimeType.startsWith('image/')) {
    errors.push(`Unsupported MIME type: ${info.mimeType}.`)
  }
  if (info.type == null && info.mimeType == null) {
    errors.push('Could not determine the image MIME type or asset type.')
  }

  // Dimension validation.
  if (!Number.isFinite(info.width) || info.width <= 0) {
    errors.push(`Invalid image width: ${info.width}.`)
  }
  if (!Number.isFinite(info.height) || info.height <= 0) {
    errors.push(`Invalid image height: ${info.height}.`)
  }

  return errors
}

/**
 * Downscale (never upscale) the verified source to a max 512 px edge, write it
 * into our managed temp dir as JPEG, and verify the result has nonzero
 * dimensions and size. Throws {@link ImageVerificationError} if the output is
 * not a valid, readable image.
 */
export async function processImageForVision(
  info: OriginalImageInfo,
): Promise<ProcessedImage> {
  const preErrors = verifyOriginalImage(info)
  if (preErrors.length > 0) throw new ImageVerificationError(preErrors)

  const longest = Math.max(info.width, info.height)
  const needsResize = longest > MAX_IMAGE_EDGE

  const context = ImageManipulator.manipulate(info.uri)
  if (needsResize) {
    // Constrain the longer edge; the other edge is derived to keep the ratio.
    context.resize(
      info.width >= info.height
        ? { width: MAX_IMAGE_EDGE }
        : { height: MAX_IMAGE_EDGE },
    )
  }
  const ref = await context.renderAsync()
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })

  // Move the manipulator output into our managed temp dir with a unique name so
  // cleanup only ever deletes files we created.
  const dir = ensureTempDir()
  const destFile = new File(dir, `vision-${Date.now()}.jpg`)
  if (destFile.exists) destFile.delete()
  new File(saved.uri).moveSync(destFile)

  // Verify the resized temp image actually exists with valid, nonzero size/dims.
  const out = new File(destFile.uri)
  const errors: string[] = []
  if (!out.exists) {
    errors.push(`Processed image was not written to disk: ${destFile.uri}`)
  } else if (out.size <= 0) {
    errors.push('Processed image is zero bytes.')
  }
  const outWidth = saved.width
  const outHeight = saved.height
  if (!Number.isFinite(outWidth) || outWidth <= 0) {
    errors.push(`Processed image has invalid width: ${outWidth}.`)
  }
  if (!Number.isFinite(outHeight) || outHeight <= 0) {
    errors.push(`Processed image has invalid height: ${outHeight}.`)
  }
  if (errors.length > 0) {
    // Best-effort remove the bad artifact before surfacing the failure.
    try {
      if (out.exists) out.delete()
    } catch {
      // ignore
    }
    throw new ImageVerificationError(errors)
  }

  return {
    uri: destFile.uri,
    width: outWidth,
    height: outHeight,
    sizeBytes: out.size,
    resized: needsResize,
  }
}

/**
 * Re-check a previously processed image right before inference. The OS can
 * evict cache files at any time, so we confirm the temp file still exists with
 * a nonzero size and valid dimensions. Returns every problem found (empty = ok).
 */
export function verifyProcessedImage(processed: ProcessedImage): string[] {
  const errors: string[] = []
  try {
    const file = new File(processed.uri)
    if (!file.exists) {
      errors.push(`Processed image no longer exists: ${processed.uri}`)
    } else if (file.size <= 0) {
      errors.push('Processed image is zero bytes.')
    }
  } catch {
    errors.push(`Processed image is unreadable: ${processed.uri}`)
  }
  if (!Number.isFinite(processed.width) || processed.width <= 0) {
    errors.push(`Processed image has invalid width: ${processed.width}.`)
  }
  if (!Number.isFinite(processed.height) || processed.height <= 0) {
    errors.push(`Processed image has invalid height: ${processed.height}.`)
  }
  return errors
}

/**
 * Delete every processed temp image except an optional one to keep (the image
 * currently selected). Safe to call anytime: it only touches files inside our
 * dedicated temp dir and swallows per-file errors.
 */
export function cleanupTempImages(keepUri?: string): void {
  const dir = tempDir()
  if (!dir.exists) return
  let entries: (Directory | File)[]
  try {
    entries = dir.list()
  } catch {
    return
  }
  for (const entry of entries) {
    if (!(entry instanceof File)) continue
    if (keepUri && entry.uri === keepUri) continue
    try {
      entry.delete()
    } catch {
      // A locked/already-gone file must not abort cleanup of the rest.
    }
  }
}
