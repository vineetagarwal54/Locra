import {
  initLlama,
  releaseAllLlama,
  type LlamaContext,
  type NativeCompletionResult,
} from 'llama.rn'

import { getMmprojFile, getModelFile } from '../constants/modelPaths'
import type { Backend } from '../types/diagnostics'

/**
 * Owns the single native llama.rn context for the whole spike. Keeping the
 * lifecycle here (instead of in the UI component) guarantees we never hold two
 * contexts at once and that CPU/GPU contexts are never loaded simultaneously.
 */

// The GPU vision path hangs the device with the current model config
// (Qwen3-VL-2B Q4_K_M weights + Q8_0 projector): OpenCL offload of the vision
// encoder never returns. Until that is fixed upstream we hard-disable GPU for
// this build — both language-model layer offload and the multimodal projector
// stay on CPU regardless of what the user requests.
export const GPU_SUPPORTED = false
export const GPU_UNSUPPORTED_REASON =
  'GPU disabled: the Qwen3-VL Q4_K_M + Q8_0 projector hangs on the OpenCL vision path. Running CPU-only.'

// Conservative mobile context configuration (see spike requirements).
const N_CTX = 4096

// Output-length budget. The Thinking model spends tokens reasoning before it
// answers, so the default is generous (512) and the UI lets you pick a limit to
// trade reasoning depth against latency.
export const DEFAULT_N_PREDICT = 512
export const N_PREDICT_OPTIONS = [256, 512, 1024] as const
export type NPredictOption = (typeof N_PREDICT_OPTIONS)[number]

const TEMPERATURE = 0

let context: LlamaContext | null = null
let loadedBackend: Backend | null = null
// Single in-flight guard: prevents overlapping load/inference/unload calls.
let busy = false

export type FileStatus = {
  name: string
  uri: string
  exists: boolean
  sizeBytes: number | null
}

export type ModelFilesStatus = {
  model: FileStatus
  mmproj: FileStatus
  allPresent: boolean
}

export function checkModelFiles(): ModelFilesStatus {
  const modelFile = getModelFile()
  const mmprojFile = getMmprojFile()

  const model: FileStatus = {
    name: modelFile.name,
    uri: modelFile.uri,
    exists: modelFile.exists,
    sizeBytes: modelFile.exists ? modelFile.size : null,
  }
  const mmproj: FileStatus = {
    name: mmprojFile.name,
    uri: mmprojFile.uri,
    exists: mmprojFile.exists,
    sizeBytes: mmprojFile.exists ? mmprojFile.size : null,
  }

  return { model, mmproj, allPresent: model.exists && mmproj.exists }
}

export function isLoaded(): boolean {
  return context !== null
}

export function getLoadedBackend(): Backend | null {
  return loadedBackend
}

export type LoadResult = {
  loadMs: number
  gpuActive: boolean
  gpuDevices: string[]
  reasonNoGPU: string
  gpuSupported: boolean
  gpuForcedOff: boolean
  gpuUnsupportedReason: string | null
  androidLib: string | null
  systemInfo: string
  modelDescription: string
  modelSizeBytes: number
  modelParams: number
  multimodalEnabled: boolean
  multimodalVision: boolean
  multimodalAudio: boolean
}

export async function loadModel(
  backend: Backend,
  onProgress?: (percent: number) => void,
): Promise<LoadResult> {
  if (context) throw new Error('A model is already loaded. Unload it first.')
  if (busy) throw new Error('Another operation is in progress.')

  const files = checkModelFiles()
  if (!files.model.exists)
    throw new Error(`Model file not found: ${files.model.uri}`)
  if (!files.mmproj.exists)
    throw new Error(`Projector file not found: ${files.mmproj.uri}`)

  busy = true
  const startedAt = Date.now()
  try {
    // GPU is unsupported for this model config; force CPU regardless of request.
    const gpuRequested = backend === 'gpu'
    const gpuForcedOff = gpuRequested && !GPU_SUPPORTED
    if (gpuForcedOff) console.log('[SPIKE][gpu]', GPU_UNSUPPORTED_REASON)

    const ctx = await initLlama(
      {
        model: files.model.uri,
        n_ctx: N_CTX,
        n_gpu_layers: 0,
        ctx_shift: false,
        use_mlock: false,
      },
      onProgress,
    )

    // Initialize the multimodal projector before we hand the context back.
    let multimodalEnabled = false
    let multimodalVision = false
    let multimodalAudio = false
    try {
      await ctx.initMultimodal({
        path: getMmprojFile().uri,
        use_gpu: false,
      })
      multimodalEnabled = await ctx.isMultimodalEnabled()
      const support = await ctx.getMultimodalSupport()
      multimodalVision = support.vision
      multimodalAudio = support.audio
    } catch (err) {
      // A projector failure should not abort text-only usage; surface it but
      // keep the loaded context. Release the half-initialized mmproj if any.
      try {
        await ctx.releaseMultimodal()
      } catch {
        // ignore
      }
      throw new Error(
        `Model loaded but multimodal init failed: ${errorMessage(err)}`,
      )
    }

    context = ctx
    loadedBackend = backend
    const loadMs = Date.now() - startedAt

    return {
      loadMs,
      gpuActive: ctx.gpu,
      gpuDevices: ctx.devices ?? [],
      reasonNoGPU: ctx.reasonNoGPU ?? '',
      gpuSupported: GPU_SUPPORTED,
      gpuForcedOff,
      gpuUnsupportedReason: GPU_SUPPORTED ? null : GPU_UNSUPPORTED_REASON,
      androidLib: ctx.androidLib ?? null,
      systemInfo: ctx.systemInfo ?? '',
      modelDescription: ctx.model?.desc ?? '',
      modelSizeBytes: ctx.model?.size ?? 0,
      modelParams: ctx.model?.nParams ?? 0,
      multimodalEnabled,
      multimodalVision,
      multimodalAudio,
    }
  } finally {
    busy = false
  }
}

export type CompletionOutcome = {
  text: string
  inferenceMs: number
  result: NativeCompletionResult
}

/**
 * Assemble the COMPLETE raw response for display. The Thinking model emits a
 * `<think>…</think>` reasoning block before its answer, so we ask the native
 * layer NOT to parse reasoning out (`reasoning_format: 'none'`), which leaves
 * the think tags inline in `content`. As a belt-and-suspenders guard, if a build
 * still splits reasoning into `reasoning_content`, we re-attach it so nothing is
 * ever silently dropped. Only surrounding whitespace is trimmed.
 */
function fullRawResponse(result: NativeCompletionResult): string {
  const body = (result.content || result.text || '').trim()
  const reasoning = (result.reasoning_content || '').trim()
  if (reasoning && !body.includes(reasoning)) {
    return `<think>\n${reasoning}\n</think>\n${body}`.trim()
  }
  return body
}

export async function runTextCompletion(
  prompt: string,
  nPredict: number = DEFAULT_N_PREDICT,
): Promise<CompletionOutcome> {
  const ctx = requireContext()
  if (busy) throw new Error('Another operation is in progress.')

  busy = true
  const startedAt = Date.now()
  try {
    const result = await ctx.completion({
      messages: [{ role: 'user', content: prompt }],
      n_predict: nPredict,
      temperature: TEMPERATURE,
      // Keep <think> tags inline; do not strip reasoning from the output.
      reasoning_format: 'none',
    })
    return {
      text: fullRawResponse(result),
      inferenceMs: Date.now() - startedAt,
      result,
    }
  } finally {
    busy = false
  }
}

export async function runVisionCompletion(
  prompt: string,
  imageUri: string,
  nPredict: number = DEFAULT_N_PREDICT,
): Promise<CompletionOutcome> {
  const ctx = requireContext()
  if (busy) throw new Error('Another operation is in progress.')

  busy = true
  const startedAt = Date.now()
  try {
    // The local file URI is passed straight through; llama.rn converts it to a
    // media path + media marker internally, so we never base64-encode in JS.
    // Log the exact URI handed to the multimodal message so the processed image
    // actually sent to the model can be confirmed in logcat.
    console.log('[SPIKE][vision] multimodal image_url =', imageUri)
    const result = await ctx.completion({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUri } },
          ],
        },
      ],
      n_predict: nPredict,
      temperature: TEMPERATURE,
      // Keep <think> tags inline; do not strip reasoning from the output.
      reasoning_format: 'none',
    })
    return {
      text: fullRawResponse(result),
      inferenceMs: Date.now() - startedAt,
      result,
    }
  } finally {
    busy = false
  }
}

export async function unloadModel(): Promise<void> {
  if (!context) return
  busy = true
  try {
    try {
      await context.releaseMultimodal()
    } catch {
      // projector may already be gone; ignore
    }
    await context.release()
  } finally {
    context = null
    loadedBackend = null
    busy = false
  }
}

/**
 * Best-effort cleanup for component unmount. Releases every native context so
 * we never leak the model when the app tears down.
 */
export async function releaseEverything(): Promise<void> {
  context = null
  loadedBackend = null
  busy = false
  try {
    await releaseAllLlama()
  } catch {
    // ignore
  }
}

function requireContext(): LlamaContext {
  if (!context) throw new Error('No model is loaded.')
  return context
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
