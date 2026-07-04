<div align="center">

# ⬡ Locra

### Ask your camera anything. No wifi. No cloud. No account.

**On-device vision AI for Android — your images never leave your phone.**

[![Platform](https://img.shields.io/badge/platform-Android-3DDC84?style=flat-square&logo=android&logoColor=white)](https://www.android.com)
[![React Native](https://img.shields.io/badge/React_Native-0.76+-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactnative.dev)
[![ExecuTorch](https://img.shields.io/badge/ExecuTorch-LFM2--VL--1.6B-EE4B2B?style=flat-square)](https://pytorch.org/executorch)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Phase](https://img.shields.io/badge/phase-1%20%2F%204-orange?style=flat-square)]()

```
Point camera → Ask a question → Get an answer
         ↑
  100% on-device. Zero network calls.
```

</div>

---

## What is Locra?

Locra runs a quantized vision-language model entirely on your Android device. Point your camera at anything — a label, a document, a product, a scene — type a question, and get an answer. No internet connection, no API key, no data ever sent anywhere.

| Capability | Detail |
|---|---|
| Model | LFM2-VL-1.6B (quantized, on-device) |
| Runtime | React Native ExecuTorch v0.8+ |
| Inference | Image + text → streamed answer |
| Network calls | **Zero** (verified by airplane-mode test suite) |
| Storage | MMKV — local history, settings, benchmarks |
| Min Android | API 33 (Android 12) |
| Target Android | API 35 (Android 15) |

---

## Architecture

### Phase 1 — HLD

> Full offline pipeline. Every box runs on the device.

<img width="1672" height="941" alt="Locra_HLD" src="https://github.com/user-attachments/assets/61874699-4816-486a-82a5-cd2c89c3b126" />


### Inference Lifecycle

> Single-flight lock, streamed tokens, graceful OOM handling.

<img width="1672" height="941" alt="Locra_LLD" src="https://github.com/user-attachments/assets/8441fce6-079c-4fdc-8078-8ec5810566c2" />


---

## Why on-device?

Most "AI camera" apps send your image to a server. Locra does not — not because of a privacy checkbox, but because the architecture makes a server structurally impossible. The inference engine has no network permission. The model is loaded from local storage. There is no API key, no auth token, no endpoint to call.

This is the constraint the app is built around, not a feature added on top.

---

## Engineering highlights

These are the non-trivial problems Phase 1 solves, and where to find them in the code.

**Memory-safe inference on constrained hardware**
A quantized 1.6B VLM plus image tensors plus the RN/JS runtime is tight on 6–8GB devices. The device compatibility gate checks available memory before model load, and the image preprocessor enforces ≤512×512 resolution to control tensor size. See `src/inference/DeviceGate.ts` and `src/inference/ImagePreprocessor.ts`.

**Single-flight inference queue**
Only one inference runs at a time. A lock is acquired before preprocessing begins and released only after the result is persisted or an error/cancel is handled — including mid-stream cancel. This prevents OOM cascades on back-to-back requests. See `src/inference/InferenceQueue.ts`.

**Resumable model download**
The quantized model is ~1.2GB. The download manager supports pause/resume with SHA-256 integrity verification on completion. A failed download leaves no partial state. See `src/model/ModelDownloadManager.ts`.

**Model cold/warm start distinction**
Cold start (first inference after launch) includes model load time, which can be several seconds. The UI shows a loading state within 500ms of submit and tracks first-token latency separately from total latency. See `src/inference/InferenceMetrics.ts`.

**Benchmark screen**
Every inference records model load time, image preprocessing time, first-token latency, tokens/sec, and total wall time. The benchmark screen visualizes these across sessions so users can see real performance on their device. See `src/screens/BenchmarkScreen.tsx`.

---

## Performance targets (Phase 1)

| Metric | Target | Measured on |
|---|---|---|
| App cold start | < 3s | Pixel 7 |
| Model load (cold) | < 8s | Pixel 7 |
| First token latency | < 5s | Pixel 7 |
| Tokens/sec | ≥ 5 | Pixel 7 |
| Image capture → answer start | < 500ms (excl. model load) | Pixel 7 |
| Crash rate | < 1% | 50-session benchmark |

> Benchmarks run on a real device, not an emulator. Emulators do not reflect inference latency or memory pressure.

---

## Tech stack

```
React Native 0.81+          Cross-platform mobile (Android target)
TypeScript                  Strict mode throughout
Expo Dev Client             Custom dev build (required for ExecuTorch)
React Native ExecuTorch     On-device ML inference (New Architecture only)
  └── LFM2-VL-1.6B         Primary vision-language model (quantized)
React Native Vision Camera  Camera capture + frame processing
Zustand                     State management (inference, model, history)
MMKV                        Local key-value storage
React Navigation            Screen routing
```

**Why these choices:**
- ExecuTorch over ONNX Runtime: native RN integration, VLM multimodal support, active development
- Zustand over Redux Toolkit: smaller stores, no boilerplate, easier to audit
- MMKV over AsyncStorage: synchronous reads, 10x faster for settings/metrics lookups
- Expo Dev Client over bare RN: faster iteration while keeping full native module access

---

## Project structure

```
locra/
├── src/
│   ├── screens/
│   │   ├── CaptureScreen.tsx        # Camera + prompt input
│   │   ├── AnswerScreen.tsx         # Streamed answer + metrics
│   │   ├── HistoryScreen.tsx        # Local Q&A history
│   │   ├── ModelSetupScreen.tsx     # Download + integrity check
│   │   └── BenchmarkScreen.tsx      # Performance visualization
│   ├── inference/
│   │   ├── InferenceQueue.ts        # Single-flight lock
│   │   ├── InferenceMetrics.ts      # Latency tracking
│   │   ├── ImagePreprocessor.ts     # Resize, compress, tile
│   │   └── DeviceGate.ts           # Memory + compatibility check
│   ├── model/
│   │   ├── ModelDownloadManager.ts  # Resumable download + SHA-256
│   │   └── ModelRegistry.ts        # Supported model constants
│   ├── store/
│   │   ├── inferenceStore.ts        # Zustand: inference state
│   │   ├── modelStore.ts            # Zustand: model status
│   │   └── historyStore.ts          # Zustand: Q&A history
│   └── components/
│       ├── OfflineIndicator.tsx     # Always-visible offline badge
│       └── ReportButton.tsx         # In-app flagging (Play policy)
├── specs/                           # Spec Kit specs, plan, tasks
├── docs/                            # Architecture diagrams
├── AGENTS.md                        # Shared agent conventions
├── CLAUDE.md                        # Claude Code config
└── .specify/                        # Spec Kit config + constitution
```

---

## Getting started

### Prerequisites

- Node.js 20+
- Android Studio + Android SDK (API 35)
- A physical Android device (API 26+, 6GB RAM minimum recommended)
- Expo CLI: `npm install -g expo-cli`

> **Emulators will not work** for inference testing. ExecuTorch requires real device hardware for meaningful latency and memory results.

### Setup

```bash
git clone https://github.com/yourusername/locra.git
cd locra
npm install
```

### Run dev build

```bash
# Build the custom Expo Dev Client (first time only, ~5 min)
npx expo run:android

# Start the dev server
npx expo start --dev-client
```

### First launch

On first launch, Locra detects no model is present and routes to the **Model Setup screen**. Download the quantized LFM2-VL-1.6B model (~1.2GB). The download is resumable — you can background the app and return. Integrity is verified via SHA-256 before the model is made available for inference.

---

## Roadmap

| Phase | Status | What it adds |
|---|---|---|
| **Phase 1** | 🔨 In progress | Core camera Q&A, model lifecycle, benchmarks |
| **Phase 2** | Planned | Text-only fallback model, OCR-first mode, chat history |
| **Phase 3** | Planned | Multi-image sessions, result sharing, accessibility |
| **Phase 4** | Planned | Live viewfinder mode (real-time frame processing) |

---

## Contributing

This is a portfolio project in active development. Issues and PRs are welcome after Phase 1 ships. See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

Built by [Vineet Agarwal](https://vineet-agarwal54.vercel.app) · MS Software Engineering, University of Maryland

</div>
