import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import * as ImagePicker from 'expo-image-picker'

import {
  checkModelFiles,
  DEFAULT_N_PREDICT,
  errorMessage,
  GPU_SUPPORTED,
  GPU_UNSUPPORTED_REASON,
  loadModel,
  N_PREDICT_OPTIONS,
  releaseEverything,
  runTextCompletion,
  runVisionCompletion,
  unloadModel,
  type ModelFilesStatus,
  type NPredictOption,
} from './src/lib/llamaSpike'
import {
  cleanupTempImages,
  ImageVerificationError,
  inspectOriginalImage,
  processImageForVision,
  verifyOriginalImage,
  verifyProcessedImage,
  type ProcessedImage,
  type SelectedImage,
} from './src/lib/imageProcessing'
import {
  createEmptyDiagnostics,
  type Backend,
  type Diagnostics,
} from './src/types/diagnostics'

const DEFAULT_TEXT_PROMPT =
  'Explain why the sky appears blue in exactly three concise sentences.'
const DEFAULT_VISION_PROMPT =
  'Describe this image accurately. Mention the main objects, relevant visual details, and any readable text. Do not invent details that are not visible.'

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

function fmtNum(n: number | null, digits = 1): string {
  return n == null ? '—' : n.toFixed(digits)
}

function fmtInt(n: number | null): string {
  return n == null ? '—' : String(n)
}

export default function App() {
  const [backend, setBackend] = useState<Backend>('cpu')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState('idle')
  const [loadProgress, setLoadProgress] = useState<number | null>(null)

  const [files, setFiles] = useState<ModelFilesStatus | null>(null)
  const [diag, setDiag] = useState<Diagnostics>(createEmptyDiagnostics())

  // Shared output-token budget for both text and vision, so reasoning quality
  // vs. latency can be compared at 256 / 512 / 1024.
  const [maxTokens, setMaxTokens] = useState<NPredictOption>(DEFAULT_N_PREDICT)

  const [textPrompt, setTextPrompt] = useState(DEFAULT_TEXT_PROMPT)
  const [textOutput, setTextOutput] = useState('')

  const [visionPrompt, setVisionPrompt] = useState(DEFAULT_VISION_PROMPT)
  const [selectedImage, setSelectedImage] = useState<SelectedImage | null>(null)
  const [processedImage, setProcessedImage] = useState<ProcessedImage | null>(
    null,
  )
  const [imageErrors, setImageErrors] = useState<string[]>([])
  const [visionOutput, setVisionOutput] = useState('')

  // Keep the latest loaded state available to the unmount cleanup.
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded

  useEffect(() => {
    return () => {
      // Best-effort cleanup when the component unmounts.
      if (loadedRef.current) void releaseEverything()
      cleanupTempImages()
    }
  }, [])

  function patchDiag(patch: Partial<Diagnostics>) {
    setDiag((prev) => {
      const next = { ...prev, ...patch }
      console.log('[SPIKE][diagnostics]', JSON.stringify(next))
      return next
    })
  }

  function setError(err: unknown) {
    const message = errorMessage(err)
    console.log('[SPIKE][error]', message)
    patchDiag({ lastError: message, currentOperation: 'idle' })
  }

  async function guarded(op: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setOperation(op)
    patchDiag({ currentOperation: op, lastError: null })
    try {
      await fn()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
      setOperation('idle')
      setDiag((prev) => ({ ...prev, currentOperation: 'idle' }))
    }
  }

  function onCheckFiles() {
    const status = checkModelFiles()
    setFiles(status)
    console.log('[SPIKE][modelFiles]', JSON.stringify(status))
  }

  async function onLoad() {
    await guarded('loading model', async () => {
      setLoadProgress(0)
      const result = await loadModel(backend, (p) => setLoadProgress(p))
      setLoadProgress(null)
      setLoaded(true)
      patchDiag({
        selectedBackend: backend,
        gpuRequested: backend === 'gpu',
        gpuActive: result.gpuActive,
        gpuDevices: result.gpuDevices,
        reasonNoGPU: result.reasonNoGPU || null,
        gpuSupported: result.gpuSupported,
        gpuForcedOff: result.gpuForcedOff,
        gpuUnsupportedReason: result.gpuUnsupportedReason,
        androidLib: result.androidLib,
        systemInfo: result.systemInfo || null,
        modelDescription: result.modelDescription || null,
        modelSizeBytes: result.modelSizeBytes || null,
        modelParams: result.modelParams || null,
        multimodalEnabled: result.multimodalEnabled,
        multimodalVision: result.multimodalVision,
        multimodalAudio: result.multimodalAudio,
        loadMs: result.loadMs,
      })
    })
  }

  async function onUnload() {
    await guarded('unloading model', async () => {
      await unloadModel()
      setLoaded(false)
      setLoadProgress(null)
    })
  }

  async function onRunText() {
    await guarded('text inference', async () => {
      setTextOutput('')
      const outcome = await runTextCompletion(textPrompt, maxTokens)
      setTextOutput(outcome.text)
      const t = outcome.result.timings
      patchDiag({
        textInferenceMs: outcome.inferenceMs,
        textPromptPerSecond: t?.prompt_per_second ?? null,
        textPredictedPerSecond: t?.predicted_per_second ?? null,
        textTokensPredicted: outcome.result.tokens_predicted ?? null,
      })
    })
  }

  async function onPickImage() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) {
        patchDiag({ lastError: 'Photo library permission was denied.' })
        return
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      })
      if (result.canceled || result.assets.length === 0) return

      // Selecting a new image invalidates the previous processed image AND the
      // previous response, so stale image context can never be reused. The old
      // temp file is removed before we make a new one.
      setProcessedImage(null)
      setVisionOutput('')
      setImageErrors([])
      cleanupTempImages()
      patchDiag({
        processedImagePath: null,
        processedImageWidth: null,
        processedImageHeight: null,
        processedImageSizeBytes: null,
        imageResized: null,
        imageVerification: null,
        visionInferenceMs: null,
        visionPromptPerSecond: null,
        visionPredictedPerSecond: null,
        visionTokensPredicted: null,
      })

      const asset = result.assets[0]
      const selected: SelectedImage = {
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        sizeBytes: asset.fileSize ?? null,
        mimeType: asset.mimeType ?? null,
        type: asset.type ?? null,
        fileName: asset.fileName ?? null,
      }
      setSelectedImage(selected)
      await prepareImage(selected)
    } catch (err) {
      setError(err)
    }
  }

  /**
   * Verify the selected source and produce the resized image that will actually
   * be sent to llama.rn. Populates diagnostics for both the original and the
   * processed image, and records any validation failures.
   */
  async function prepareImage(selected: SelectedImage) {
    const info = inspectOriginalImage(selected)
    patchDiag({
      originalImagePath: info.uri,
      originalImageWidth: info.width > 0 ? info.width : null,
      originalImageHeight: info.height > 0 ? info.height : null,
      originalImageSizeBytes: info.sizeBytes,
      originalImageMime: info.mimeType ?? info.type ?? null,
    })

    const errors = verifyOriginalImage(info)
    if (errors.length > 0) {
      setImageErrors(errors)
      setProcessedImage(null)
      patchDiag({ imageVerification: errors.join(' ') })
      return
    }

    try {
      const processed = await processImageForVision(info)
      console.log('[SPIKE][image] processed', JSON.stringify(processed))
      setProcessedImage(processed)
      setImageErrors([])
      patchDiag({
        processedImagePath: processed.uri,
        processedImageWidth: processed.width,
        processedImageHeight: processed.height,
        processedImageSizeBytes: processed.sizeBytes,
        imageResized: processed.resized,
        imageVerification: 'ok',
      })
    } catch (err) {
      const errs =
        err instanceof ImageVerificationError
          ? err.errors
          : [errorMessage(err)]
      setImageErrors(errs)
      setProcessedImage(null)
      patchDiag({ imageVerification: errs.join(' '), lastError: errs.join(' ') })
    }
  }

  async function onRunVision() {
    if (!selectedImage) {
      const msg = 'Select an image first.'
      setImageErrors([msg])
      patchDiag({ lastError: msg })
      return
    }
    if (!processedImage) {
      // Verification failed (or is still running) — never run inference on an
      // unverified image.
      const msg =
        imageErrors.length > 0
          ? 'Image failed verification. Fix the issues above or pick another image.'
          : 'Image is still being processed. Try again in a moment.'
      patchDiag({ lastError: msg })
      return
    }

    // Re-verify the temp file right before inference in case the OS evicted it.
    const stale = verifyProcessedImage(processedImage)
    if (stale.length > 0) {
      setImageErrors(stale)
      setProcessedImage(null)
      patchDiag({ imageVerification: stale.join(' '), lastError: stale.join(' ') })
      return
    }

    await guarded('vision inference', async () => {
      setVisionOutput('')
      // Send the PROCESSED image, not the original source.
      const outcome = await runVisionCompletion(
        visionPrompt,
        processedImage.uri,
        maxTokens,
      )
      setVisionOutput(outcome.text)
      const t = outcome.result.timings
      patchDiag({
        visionInferenceMs: outcome.inferenceMs,
        visionPromptPerSecond: t?.prompt_per_second ?? null,
        visionPredictedPerSecond: t?.predicted_per_second ?? null,
        visionTokensPredicted: outcome.result.tokens_predicted ?? null,
      })
    })
  }

  const backendLocked = loaded || busy

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Qwen3-VL-2B-Thinking · llama.rn spike</Text>

        {busy && (
          <View style={styles.busyBar}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.busyText}>
              {operation}
              {loadProgress != null ? ` · ${loadProgress}%` : ''}
            </Text>
          </View>
        )}

        {/* Backend selection */}
        <Section title="1 · Backend">
          {!GPU_SUPPORTED && (
            <View style={styles.warnBox}>
              <Text style={styles.warnText}>⚠ {GPU_UNSUPPORTED_REASON}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Segment
              label="CPU"
              active={backend === 'cpu'}
              disabled={backendLocked}
              onPress={() => setBackend('cpu')}
            />
            <Segment
              label="GPU / OpenCL (unsupported)"
              active={backend === 'gpu'}
              disabled={backendLocked}
              onPress={() => setBackend('gpu')}
            />
          </View>
          <Text style={styles.hint}>
            {backendLocked
              ? 'Backend is locked while a model is loaded. Unload to switch.'
              : 'GPU is force-disabled for this model — selecting it still runs CPU-only.'}
          </Text>
        </Section>

        {/* Model controls */}
        <Section title="2 · Model">
          <View style={styles.row}>
            <Button label="Check model files" onPress={onCheckFiles} />
            <Button
              label="Load model"
              onPress={onLoad}
              disabled={busy || loaded || (files ? !files.allPresent : false)}
            />
            <Button
              label="Unload model"
              onPress={onUnload}
              disabled={busy || !loaded}
            />
          </View>
          {files && (
            <View style={styles.fileBox}>
              <FileLine label="LLM" file={files.model} />
              <FileLine label="mmproj" file={files.mmproj} />
              <Text
                style={[
                  styles.mono,
                  files.allPresent ? styles.ok : styles.bad,
                ]}
              >
                {files.allPresent
                  ? 'Both files present.'
                  : 'Missing file(s). Push models before loading.'}
              </Text>
            </View>
          )}
        </Section>

        {/* Text test */}
        <Section title="3 · Text test">
          <Text style={styles.label}>Output limit (tokens) · applies to text & vision</Text>
          <View style={styles.row}>
            {N_PREDICT_OPTIONS.map((opt) => (
              <Segment
                key={opt}
                label={String(opt)}
                active={maxTokens === opt}
                disabled={busy}
                onPress={() => setMaxTokens(opt)}
              />
            ))}
          </View>
          <Text style={styles.hint}>
            Higher limits give the Thinking model more room to reason (better
            quality, slower). The full raw response — including any
            {' <think>'} tags — is shown verbatim below.
          </Text>
          <TextInput
            style={[styles.input, styles.inputSpacer]}
            value={textPrompt}
            onChangeText={setTextPrompt}
            multiline
            editable={!busy}
            placeholder="Text prompt"
          />
          <View style={styles.row}>
            <Button
              label="Run Text Test"
              onPress={onRunText}
              disabled={busy || !loaded}
            />
            <Button label="Clear Output" onPress={() => setTextOutput('')} />
          </View>
          <OutputBox text={textOutput} placeholder="Text output appears here." />
        </Section>

        {/* Vision test */}
        <Section title="4 · Vision test">
          <View style={styles.row}>
            <Button label="Select Image" onPress={onPickImage} disabled={busy} />
          </View>

          {/* Preview the PROCESSED image that is actually sent to the model.
              Fall back to the original only while processing/failed. */}
          {(processedImage || selectedImage) && (
            <>
              <Image
                source={{ uri: (processedImage ?? selectedImage!).uri }}
                style={styles.preview}
                resizeMode="contain"
              />
              <Text style={styles.previewCaption}>
                {processedImage
                  ? `Processed (sent to model) · ${processedImage.width}×${processedImage.height} · ${formatBytes(processedImage.sizeBytes)}${processedImage.resized ? ' · resized' : ' · unchanged'}`
                  : 'Original image (not yet verified)'}
              </Text>
            </>
          )}

          {selectedImage && (
            <View style={styles.imageInfoBox}>
              <Text style={styles.imageInfoText} selectable>
                Original: {selectedImage.width || '?'}×{selectedImage.height || '?'} ·{' '}
                {formatBytes(diag.originalImageSizeBytes)} ·{' '}
                {selectedImage.mimeType ?? selectedImage.type ?? 'unknown type'}
              </Text>
              <Text style={styles.pathText} selectable>
                {selectedImage.uri}
              </Text>
              {processedImage && (
                <Text style={styles.pathText} selectable>
                  → {processedImage.uri}
                </Text>
              )}
            </View>
          )}

          {imageErrors.length > 0 && (
            <View style={styles.errorBox}>
              {imageErrors.map((e, i) => (
                <Text key={i} style={styles.errorText}>
                  • {e}
                </Text>
              ))}
            </View>
          )}

          <TextInput
            style={styles.input}
            value={visionPrompt}
            onChangeText={setVisionPrompt}
            multiline
            editable={!busy}
            placeholder="Vision prompt"
          />
          <View style={styles.row}>
            <Button
              label="Run Vision Test"
              onPress={onRunVision}
              disabled={busy || !loaded || !processedImage}
            />
            <Button label="Clear Output" onPress={() => setVisionOutput('')} />
          </View>
          <OutputBox
            text={visionOutput}
            placeholder="Vision output appears here."
          />
        </Section>

        {/* Diagnostics */}
        <Section title="5 · Diagnostics">
          <View style={styles.diagBox}>
            <Diag k="Selected backend" v={diag.selectedBackend} />
            <Diag k="GPU requested" v={String(diag.gpuRequested)} />
            <Diag
              k="GPU active"
              v={diag.gpuActive == null ? '—' : String(diag.gpuActive)}
            />
            <Diag
              k="GPU devices"
              v={diag.gpuDevices?.length ? diag.gpuDevices.join(', ') : '—'}
            />
            <Diag k="Reason no GPU" v={diag.reasonNoGPU ?? '—'} />
            <Diag k="GPU supported" v={String(diag.gpuSupported)} />
            <Diag k="GPU forced off" v={String(diag.gpuForcedOff)} />
            <Diag k="GPU unsupported reason" v={diag.gpuUnsupportedReason ?? '—'} />
            <Diag k="Android lib" v={diag.androidLib ?? '—'} />
            <Diag k="Model" v={diag.modelDescription ?? '—'} />
            <Diag k="Model size" v={formatBytes(diag.modelSizeBytes)} />
            <Diag k="Params" v={fmtInt(diag.modelParams)} />
            <Diag
              k="Multimodal (vision/audio)"
              v={`${diag.multimodalVision ?? '—'} / ${diag.multimodalAudio ?? '—'}`}
            />
            <Diag
              k="Multimodal enabled"
              v={
                diag.multimodalEnabled == null
                  ? '—'
                  : String(diag.multimodalEnabled)
              }
            />
            <Diag k="Load time (ms)" v={fmtInt(diag.loadMs)} />
            <Diag k="Text time (ms)" v={fmtInt(diag.textInferenceMs)} />
            <Diag k="Text prompt tok/s" v={fmtNum(diag.textPromptPerSecond)} />
            <Diag k="Text gen tok/s" v={fmtNum(diag.textPredictedPerSecond)} />
            <Diag k="Text tokens" v={fmtInt(diag.textTokensPredicted)} />
            <Diag k="Vision time (ms)" v={fmtInt(diag.visionInferenceMs)} />
            <Diag
              k="Vision prompt tok/s"
              v={fmtNum(diag.visionPromptPerSecond)}
            />
            <Diag
              k="Vision gen tok/s"
              v={fmtNum(diag.visionPredictedPerSecond)}
            />
            <Diag k="Vision tokens" v={fmtInt(diag.visionTokensPredicted)} />
            <Diag k="Image verification" v={diag.imageVerification ?? '—'} />
            <Diag k="Original image path" v={diag.originalImagePath ?? '—'} />
            <Diag
              k="Original dimensions"
              v={
                diag.originalImageWidth && diag.originalImageHeight
                  ? `${diag.originalImageWidth}×${diag.originalImageHeight}`
                  : '—'
              }
            />
            <Diag k="Original size" v={formatBytes(diag.originalImageSizeBytes)} />
            <Diag k="Original MIME/type" v={diag.originalImageMime ?? '—'} />
            <Diag k="Processed image path" v={diag.processedImagePath ?? '—'} />
            <Diag
              k="Processed dimensions"
              v={
                diag.processedImageWidth && diag.processedImageHeight
                  ? `${diag.processedImageWidth}×${diag.processedImageHeight}`
                  : '—'
              }
            />
            <Diag
              k="Processed size"
              v={formatBytes(diag.processedImageSizeBytes)}
            />
            <Diag
              k="Image resized"
              v={diag.imageResized == null ? '—' : String(diag.imageResized)}
            />
            <Diag k="Current operation" v={diag.currentOperation} />
            <Diag k="Last error" v={diag.lastError ?? '—'} />
          </View>
          {diag.systemInfo && <OutputBox text={diag.systemInfo} placeholder="" />}
        </Section>

        <View style={{ height: 48 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ---- small presentational helpers ----

function Section(props: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.children}
    </View>
  )
}

function Button(props: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      style={[styles.button, props.disabled && styles.buttonDisabled]}
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <Text style={styles.buttonText}>{props.label}</Text>
    </Pressable>
  )
}

function Segment(props: {
  label: string
  active: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      style={[
        styles.segment,
        props.active && styles.segmentActive,
        props.disabled && styles.segmentDisabled,
      ]}
      onPress={props.onPress}
      disabled={props.disabled}
    >
      <Text
        style={[styles.segmentText, props.active && styles.segmentTextActive]}
      >
        {props.label}
      </Text>
    </Pressable>
  )
}

function FileLine(props: {
  label: string
  file: { name: string; uri: string; exists: boolean; sizeBytes: number | null }
}) {
  return (
    <View style={styles.fileLine}>
      <Text style={[styles.mono, props.file.exists ? styles.ok : styles.bad]}>
        {props.file.exists ? '✓' : '✗'} {props.label}: {props.file.name}
        {props.file.exists ? ` (${formatBytes(props.file.sizeBytes)})` : ''}
      </Text>
      <Text style={styles.pathText} selectable>
        {props.file.uri}
      </Text>
    </View>
  )
}

function OutputBox(props: { text: string; placeholder: string }) {
  return (
    <View style={styles.outputBox}>
      <Text style={styles.outputText} selectable>
        {props.text || props.placeholder}
      </Text>
    </View>
  )
}

function Diag(props: { k: string; v: string }) {
  return (
    <View style={styles.diagRow}>
      <Text style={styles.diagKey}>{props.k}</Text>
      <Text style={styles.diagVal} selectable>
        {props.v}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f4f5f7' },
  content: { padding: 16, paddingTop: 56 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12, color: '#111' },
  busyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    gap: 10,
  },
  busyText: { color: '#fff', fontWeight: '600' },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
    color: '#111',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontSize: 12, color: '#374151', fontWeight: '600', marginBottom: 8 },
  hint: { fontSize: 12, color: '#6b7280', marginTop: 8 },
  inputSpacer: { marginTop: 10 },
  button: {
    backgroundColor: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  buttonDisabled: { backgroundColor: '#9ca3af' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  segment: {
    flex: 1,
    minWidth: 120,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  segmentActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  segmentDisabled: { opacity: 0.6 },
  segmentText: { fontWeight: '600', color: '#374151', fontSize: 13 },
  segmentTextActive: { color: '#fff' },
  fileBox: { marginTop: 12, gap: 8 },
  fileLine: { gap: 2 },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
  },
  pathText: { fontSize: 11, color: '#6b7280' },
  ok: { color: '#059669' },
  bad: { color: '#dc2626' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 10,
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 10,
    color: '#111',
    backgroundColor: '#fafafa',
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    marginBottom: 4,
  },
  previewCaption: {
    fontSize: 11,
    color: '#6b7280',
    marginBottom: 10,
    fontWeight: '600',
  },
  warnBox: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  warnText: { color: '#92400e', fontSize: 12, fontWeight: '600' },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    gap: 2,
  },
  errorText: { color: '#b91c1c', fontSize: 12 },
  imageInfoBox: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    gap: 2,
  },
  imageInfoText: { fontSize: 12, color: '#374151', fontWeight: '600' },
  outputBox: {
    marginTop: 10,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 12,
    minHeight: 60,
  },
  outputText: {
    color: '#e2e8f0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  diagBox: { gap: 4 },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 2,
  },
  diagKey: { fontSize: 12, color: '#6b7280', flexShrink: 1 },
  diagVal: {
    fontSize: 12,
    color: '#111',
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
})
