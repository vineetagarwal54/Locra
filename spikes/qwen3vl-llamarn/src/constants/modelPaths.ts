import { Directory, File, Paths } from 'expo-file-system'

/**
 * Both GGUF files are expected to live in `<documentDirectory>/models`.
 * They are NOT bundled in the APK -- push them with scripts/push-models-android.ps1.
 */
export const MODEL_DIR_NAME = 'models'

/** Language model (quantized weights). */
export const MODEL_FILE_NAME = 'Qwen3VL-2B-Thinking-Q4_K_M.gguf'

/** Multimodal projector (vision encoder). */
export const MMPROJ_FILE_NAME = 'mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf'

/** The writable models directory as an expo-file-system Directory. */
export function getModelsDirectory(): Directory {
  return new Directory(Paths.document, MODEL_DIR_NAME)
}

export function getModelFile(): File {
  return new File(getModelsDirectory(), MODEL_FILE_NAME)
}

export function getMmprojFile(): File {
  return new File(getModelsDirectory(), MMPROJ_FILE_NAME)
}
