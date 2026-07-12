/**
 * Backend the user requested before loading. GPU here means "OpenCL requested";
 * whether the GPU actually initialized is reported separately by the native
 * layer (see `gpuActive`).
 */
export type Backend = 'cpu' | 'gpu'

/**
 * A single, flat diagnostics snapshot rendered in the UI and logged to console
 * so it can be inspected through `adb logcat`. Every timing/optional field is
 * nullable because the native API does not always populate them.
 */
export type Diagnostics = {
  // --- backend ---
  selectedBackend: Backend
  gpuRequested: boolean
  gpuActive: boolean | null
  gpuDevices: string[] | null
  reasonNoGPU: string | null
  androidLib: string | null

  // --- gpu policy ---
  // This model config (Qwen3-VL Q4_K_M + Q8_0 projector) hangs on the GPU
  // vision path, so GPU is force-disabled. These fields explain that to the UI.
  gpuSupported: boolean
  gpuForcedOff: boolean
  gpuUnsupportedReason: string | null

  // --- model ---
  modelDescription: string | null
  modelSizeBytes: number | null
  modelParams: number | null
  multimodalVision: boolean | null
  multimodalAudio: boolean | null
  multimodalEnabled: boolean | null

  // --- timings (ms) ---
  loadMs: number | null
  textInferenceMs: number | null
  visionInferenceMs: number | null

  // --- speeds / counts (from the last completion of each kind) ---
  textPromptPerSecond: number | null
  textPredictedPerSecond: number | null
  textTokensPredicted: number | null
  visionPromptPerSecond: number | null
  visionPredictedPerSecond: number | null
  visionTokensPredicted: number | null

  // --- image (original source vs. processed image sent to llama.rn) ---
  originalImagePath: string | null
  originalImageWidth: number | null
  originalImageHeight: number | null
  originalImageSizeBytes: number | null
  originalImageMime: string | null
  processedImagePath: string | null
  processedImageWidth: number | null
  processedImageHeight: number | null
  processedImageSizeBytes: number | null
  imageResized: boolean | null
  imageVerification: string | null

  // --- status ---
  systemInfo: string | null
  currentOperation: string
  lastError: string | null
}

export function createEmptyDiagnostics(): Diagnostics {
  return {
    selectedBackend: 'cpu',
    gpuRequested: false,
    gpuActive: null,
    gpuDevices: null,
    reasonNoGPU: null,
    androidLib: null,
    gpuSupported: false,
    gpuForcedOff: false,
    gpuUnsupportedReason: null,
    modelDescription: null,
    modelSizeBytes: null,
    modelParams: null,
    multimodalVision: null,
    multimodalAudio: null,
    multimodalEnabled: null,
    loadMs: null,
    textInferenceMs: null,
    visionInferenceMs: null,
    textPromptPerSecond: null,
    textPredictedPerSecond: null,
    textTokensPredicted: null,
    visionPromptPerSecond: null,
    visionPredictedPerSecond: null,
    visionTokensPredicted: null,
    originalImagePath: null,
    originalImageWidth: null,
    originalImageHeight: null,
    originalImageSizeBytes: null,
    originalImageMime: null,
    processedImagePath: null,
    processedImageWidth: null,
    processedImageHeight: null,
    processedImageSizeBytes: null,
    imageResized: null,
    imageVerification: null,
    systemInfo: null,
    currentOperation: 'idle',
    lastError: null,
  }
}
