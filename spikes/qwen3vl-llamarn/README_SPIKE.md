# Qwen3-VL-2B-Thinking · llama.rn Android spike

A minimal, standalone Android spike that proves whether **`Qwen3-VL-2B-Thinking`**
runs locally on a physical Android phone via **`llama.rn`** — text inference,
image+text (vision) inference, repeated-inference stability, and load/unload
lifecycle, with a diagnostics panel. Inference is **CPU-only** for this model
config (see the GPU note below).

This project is intentionally separate from the Locra app and references no
Locra code.

- **Model repo:** `Qwen/Qwen3-VL-2B-Thinking-GGUF`
- **LLM weights:** `Qwen3VL-2B-Thinking-Q4_K_M.gguf`
- **Projector:** `mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf`
- **Android package:** `com.locra.qwen3vlspike`
- **Output limit:** selectable **256 / 512 / 1024** tokens (default 512), shared
  by the text and vision tests. The **complete raw response is shown verbatim,
  including any `<think>…</think>` reasoning tags** — nothing is stripped.
- Model files live in the app's writable dir: `/data/data/com.locra.qwen3vlspike/files/models`
  and are **never** bundled in the APK.

> Expo Go cannot run this — `llama.rn` is a native module and requires a native
> development build. `llama.rn` v0.12 also requires React Native's **New
> Architecture** (already enabled here).

---

## Key facts before you start

- **GPU is force-disabled for this model config.** The Qwen3-VL Q4_K_M weights +
  Q8_0 projector hang the device on the OpenCL vision path, so the app always
  loads with `n_gpu_layers: 0` and `initMultimodal({ use_gpu: false })`.
  Selecting **GPU / OpenCL** in the UI still runs CPU-only; the Diagnostics panel
  reports `GPU supported`, `GPU forced off`, and `GPU unsupported reason`.
- **INTERNET permission** is present because Expo dev/Metro builds require it to
  connect to the bundler. **Model inference itself is fully local** — no network
  is used for loading or running the model. `CAMERA` and `RECORD_AUDIO` are
  explicitly blocked; only image-library read access is requested.
- The prebuilt `llama.rn` native libraries ship for `arm64-v8a` (phones) and
  `x86_64` (emulator). Use a real arm64 phone for meaningful GPU/thermal data.

---

## Prerequisites

- Node + npm, and the Expo toolchain (`npx expo`).
- Android SDK + platform-tools (`adb`) on `PATH`.
- Android Studio / NDK for the native build (`expo run:android` drives Gradle).
- Python with the Hugging Face CLI for model download:
  `pip install -U "huggingface_hub[cli]"`
- A physical Android phone with **USB debugging** enabled.

> **Windows note:** `llama.rn`'s postinstall extracts native artifacts with
> `tar`. If you reinstall `node_modules` from **Git Bash**, its GNU `tar`
> misparses the `C:` temp path and the download fails. Run installs from
> **PowerShell** (where `tar` is the Windows `tar.exe`), or after a Git-Bash
> install run:
> ```powershell
> node .\node_modules\llama.rn\install\download-native-artifacts.js
> ```

---

## End-to-end (Windows PowerShell)

Run every command from the project root:
`D:\Projects\Locra\Locra\spikes\qwen3vl-llamarn`

### 1. Install dependencies

```powershell
npm install
```

If the `llama.rn` native-artifact step failed (Git Bash), fix it from PowerShell:

```powershell
node .\node_modules\llama.rn\install\download-native-artifacts.js
```

### 2. Generate the native Android project (optional — `run:android` does this)

```powershell
npx expo prebuild --platform android
```

### 3. Connect a physical Android phone with USB debugging

Plug in the phone and accept the "Allow USB debugging" prompt on the device.

### 4. Confirm the phone is visible

```powershell
adb devices
```

You should see exactly one entry ending in `device` (not `unauthorized`).

### 5. Build and install the app once (native debug build)

```powershell
npx expo run:android --device
```

This compiles the native app, installs it, and starts Metro. Leave Metro
running. (First build is slow.)

### 6. Download the model files

```powershell
.\scripts\download-models.ps1
```

Downloads the two GGUF files into `.\models`. Use `-Force` to re-download.

### 7. Push the model files into the app's writable directory

```powershell
.\scripts\push-models-android.ps1
# or, if multiple devices are attached:
.\scripts\push-models-android.ps1 -Serial <serial-from-adb-devices>
```

Copies both files to `/data/data/com.locra.qwen3vlspike/files/models` using the
`adb push` → `run-as` pattern and verifies sizes. Requires the **debug** app to
be installed (step 5).

### 8. Restart the app

Fully close and reopen the app on the phone (or press `r` in Metro).

### 9. Run the CPU baseline

In the app:
1. Section **1 · Backend** → select **CPU**.
2. Section **2 · Model** → **Check model files** (both should show ✓ with sizes).
3. **Load model** (watch the load progress / time).
4. Section **3 · Text test** → pick an **Output limit** (256 / 512 / 1024),
   then **Run Text Test**. The output box shows the full raw response, including
   the `<think>…</think>` reasoning block.
5. Section **4 · Vision test** → **Select Image**, then **Run Vision Test** (uses
   the same output limit).
6. Read timings/speeds in Section **5 · Diagnostics**. Re-run at different output
   limits to compare reasoning quality vs. latency.

### 10. Unload the model

Section **2 · Model** → **Unload model**. This releases the native context and
projector, and unlocks the backend selector.

### 11. Run the GPU/OpenCL test

1. Select **GPU / OpenCL requested**.
2. **Load model**.
3. In **Diagnostics**, check **GPU active**, **GPU devices**, **Reason no GPU**,
   and **Android lib** — this is the only proof GPU actually engaged.
4. Repeat the exact same text and vision prompts/images as CPU.

### 12. Compare results

Fill in the results table below from the Diagnostics panel for each backend.

### 13. Capture logs

Filtered (spike + native llama), but not so strict that native errors vanish:

```powershell
adb logcat -v time | Select-String -Pattern "SPIKE|RNLlama|llama|rnllama|ggml|OpenCL|libc|FATAL|AndroidRuntime|tombstone"
```

Full unfiltered log if you need everything:

```powershell
adb logcat
```

The app also emits structured objects you can grep for:
`[SPIKE][diagnostics]`, `[SPIKE][modelFiles]`, `[SPIKE][error]`.

### 14. Capture Android memory and thermal information

```powershell
adb shell dumpsys meminfo com.locra.qwen3vlspike
adb shell dumpsys thermalservice
adb shell dumpsys battery
```

Sample **before load**, **after load**, and **after several inferences** to see
memory growth and thermal drift.

---

## Manual test checklist

### CPU baseline
- [ ] Cold-start the app
- [ ] Select **CPU**
- [ ] Check model files (both ✓)
- [ ] Load model
- [ ] Run three text prompts
- [ ] Select an image
- [ ] Run two consecutive vision prompts
- [ ] Select a different image
- [ ] Run another vision prompt
- [ ] Run another text prompt after the vision tests
- [ ] Unload model
- [ ] Reload model
- [ ] Repeat one text and one vision prompt

### GPU/OpenCL test
- [ ] Unload CPU model
- [ ] Select **GPU / OpenCL requested**
- [ ] Load model
- [ ] Confirm whether GPU actually activated (Diagnostics: `GPU active` / `GPU devices` / `Reason no GPU`)
- [ ] Repeat exactly the same prompts and images used for CPU
- [ ] Compare load time, text speed, vision time, quality, UI responsiveness, temperature, and memory

### Stability test
- [ ] Run five text requests
- [ ] Run five vision requests
- [ ] Alternate text and vision
- [ ] Scroll while inference runs
- [ ] Open and close the keyboard while inference runs
- [ ] Background the app for 30 seconds, reopen it
- [ ] Run another request
- [ ] Unload and reload
- [ ] Confirm no native crash, ANR, corrupted context, or continuous memory growth

### Results table

```text
Backend | Load time | Text tok/s | Vision time | Memory before/after | Temperature before/after | UI lag | Quality | Error
--------|-----------|------------|-------------|---------------------|--------------------------|--------|---------|------
CPU     |           |            |             |                     |                          |        |         |
GPU     |           |            |             |                     |                          |        |         |
```

---

## Project layout

```text
App.tsx                     # single-screen UI (backend/model/text/vision/diagnostics)
src/
  constants/modelPaths.ts   # models dir + the two expected GGUF filenames
  lib/llamaSpike.ts         # native context lifecycle + text/vision inference
  types/diagnostics.ts      # Diagnostics shape
scripts/
  download-models.ps1       # pull the two GGUFs from Hugging Face into ./models
  push-models-android.ps1   # adb push + run-as into the app's files/models
README_SPIKE.md
```

`llama.rn` config lives in `app.json` under `plugins`
(`forceCxx20`, `enableOpenCLAndHexagon`) and the Android package /
blocked permissions under `expo.android`.

## Troubleshooting

- **"Model file not found" on Load** — you skipped step 7, or the app was a
  release build. Re-run `push-models-android.ps1` after a debug install.
- **`run-as` failed** — the installed app isn't debuggable. Reinstall with
  `npx expo run:android --device` (debug variant).
- **GPU active = false** — the device has no supported OpenCL GPU, or the
  OpenCL backend library didn't load. Check `Reason no GPU` and `logcat` for
  `OpenCL`. Fall back to CPU.
- **Metro can't connect** — ensure INTERNET permission survived and the phone
  and PC are reachable; try `adb reverse tcp:8081 tcp:8081`.
```
