import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';

import { preprocessImage, type PreprocessedImage } from './ImagePreprocessor';

// FR-049: enhance the captured image BEFORE the 512x512 ceiling resize in
// ImagePreprocessor — auto-orient (EXIF bake), crop to a subject region or a
// sensible centered default, and downscale to an intermediate ceiling so the
// final resize starts from a clean, upright frame. Contrast normalization is
// NOT implemented: expo-image-manipulator exposes only resize/rotate/flip/crop
// (verified in research.md's Phase 3 API Verification addendum) — there is no
// contrast/brightness action at the RN layer without a new native module.

/** Longest-edge ceiling for the enhancement stage (2x the model's 512 ceiling). */
export const ENHANCE_MAX_DIMENSION = 1024;

/**
 * Aspect-ratio ceiling. Wider/taller than this (panoramas, screenshots of
 * chats) gets a centered crop of the long axis, since the final 512 resize
 * would otherwise waste most of its pixels on empty margins.
 */
export const MAX_ASPECT_RATIO = 16 / 9;

const SAVE_QUALITY = 0.9;
const MIN_CROP_EDGE = 64;

export interface EnhancedImage {
  /** Filesystem path (no `file://` prefix) for the next pipeline stage. */
  path: string;
  width: number;
  height: number;
}

export interface SubjectRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

type ManipulateAction =
  | { resize: { width?: number; height?: number } }
  | { crop: CropRect };

export type ManipulateFn = (
  uri: string,
  actions: ManipulateAction[],
  saveOptions: { compress: number; format: SaveFormat }
) => Promise<{ uri: string; width: number; height: number }>;

export interface EnhanceOptions {
  subjectRegion?: SubjectRegion;
  manipulate?: ManipulateFn;
}

/**
 * Two-pass enhancement: pass 1 decodes and re-encodes with no actions, which
 * bakes EXIF orientation in and yields trustworthy upright dimensions; pass 2
 * (only when needed) crops and/or downscales using those dimensions.
 */
export async function enhanceImage(
  imagePath: string,
  options: EnhanceOptions = {}
): Promise<EnhancedImage> {
  if (typeof imagePath !== 'string' || imagePath.trim() === '') {
    throw new Error('ImageEnhancer: a non-empty image path is required.');
  }

  const manipulate = options.manipulate ?? defaultManipulate;
  const saveOptions = { compress: SAVE_QUALITY, format: SaveFormat.JPEG };

  const oriented = await manipulate(toUri(imagePath), [], saveOptions);

  const crop = resolveCropRegion(oriented.width, oriented.height, options.subjectRegion);
  const actions: ManipulateAction[] = [];
  if (crop !== null) {
    actions.push({ crop });
  }

  const croppedWidth = crop?.width ?? oriented.width;
  const croppedHeight = crop?.height ?? oriented.height;
  if (Math.max(croppedWidth, croppedHeight) > ENHANCE_MAX_DIMENSION) {
    actions.push(
      croppedWidth >= croppedHeight
        ? { resize: { width: ENHANCE_MAX_DIMENSION } }
        : { resize: { height: ENHANCE_MAX_DIMENSION } }
    );
  }

  if (actions.length === 0) {
    return { path: toFilePath(oriented.uri), width: oriented.width, height: oriented.height };
  }

  const enhanced = await manipulate(oriented.uri, actions, saveOptions);
  return { path: toFilePath(enhanced.uri), width: enhanced.width, height: enhanced.height };
}

/**
 * Picks the crop rectangle: a provided subject region wins (clamped to the
 * frame); otherwise extreme aspect ratios get a centered crop of the long
 * axis; otherwise no crop — for a normal frame the sensible centered default
 * is the full frame, since guessing a tighter crop risks cutting off exactly
 * what the user is asking about.
 */
export function resolveCropRegion(
  width: number,
  height: number,
  subjectRegion?: SubjectRegion
): CropRect | null {
  if (subjectRegion !== undefined) {
    return clampRegion(width, height, subjectRegion);
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge / shortEdge <= MAX_ASPECT_RATIO) {
    return null;
  }

  const croppedLongEdge = Math.round(shortEdge * MAX_ASPECT_RATIO);
  const offset = Math.round((longEdge - croppedLongEdge) / 2);
  return width >= height
    ? { originX: offset, originY: 0, width: croppedLongEdge, height }
    : { originX: 0, originY: offset, width, height: croppedLongEdge };
}

export interface PrepareImageDeps {
  enhance: (imagePath: string) => Promise<EnhancedImage>;
  preprocess: (imagePath: string) => Promise<PreprocessedImage>;
}

/**
 * The full input pipeline: enhance (FR-049) then the hard 512x512 ceiling
 * (Principle IV). Enhancement failing is never fatal — the original capture
 * falls through to the preprocessor, whose ceiling and clear errors still
 * apply (Principle III).
 */
export async function prepareImageForInference(
  imagePath: string,
  deps: PrepareImageDeps = { enhance: enhanceImage, preprocess: preprocessImage }
): Promise<PreprocessedImage> {
  let pathForPreprocess = imagePath;
  try {
    const enhanced = await deps.enhance(imagePath);
    pathForPreprocess = enhanced.path;
  } catch {
    pathForPreprocess = imagePath;
  }
  return deps.preprocess(pathForPreprocess);
}

function clampRegion(width: number, height: number, region: SubjectRegion): CropRect | null {
  const originX = Math.min(Math.max(0, Math.round(region.x)), Math.max(0, width - MIN_CROP_EDGE));
  const originY = Math.min(Math.max(0, Math.round(region.y)), Math.max(0, height - MIN_CROP_EDGE));
  const cropWidth = Math.min(Math.round(region.width), width - originX);
  const cropHeight = Math.min(Math.round(region.height), height - originY);

  if (cropWidth < MIN_CROP_EDGE || cropHeight < MIN_CROP_EDGE) {
    return null;
  }
  return { originX, originY, width: cropWidth, height: cropHeight };
}

function toUri(path: string): string {
  if (path.startsWith('file://') || path.startsWith('content://')) {
    return path;
  }
  return `file://${path}`;
}

function toFilePath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

function defaultManipulate(
  uri: string,
  actions: ManipulateAction[],
  saveOptions: { compress: number; format: SaveFormat }
): Promise<{ uri: string; width: number; height: number }> {
  return manipulateAsync(uri, actions, saveOptions);
}
