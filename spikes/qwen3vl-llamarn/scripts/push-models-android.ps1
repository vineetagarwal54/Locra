<#
.SYNOPSIS
  Copy the two Qwen3-VL-2B-Thinking GGUF files into the debug app's internal
  writable model directory: /data/data/com.locra.qwen3vlspike/files/models

.DESCRIPTION
  The GGUF files are NOT bundled in the APK. This script pushes them onto a
  connected, debuggable device using the shell->run-as pattern:

      adb push   <local> /data/local/tmp/<name>
      adb shell  cat /data/local/tmp/<name> | run-as <pkg> sh -c 'cat > files/models/<name>'
      adb shell  rm /data/local/tmp/<name>

  The middle step works because the outer `cat` runs as the (readable) shell
  user and pipes into `run-as`, which writes as the app's uid. This requires the
  installed app to be debuggable (a `expo run:android` debug build is).

.PARAMETER Serial
  Target a specific device serial (from `adb devices`). Required only when more
  than one device/emulator is connected.

.EXAMPLE
  .\scripts\push-models-android.ps1
  .\scripts\push-models-android.ps1 -Serial ABCD1234
#>

[CmdletBinding()]
param(
  [string]$Serial
)

$ErrorActionPreference = 'Stop'

$Package = 'com.locra.qwen3vlspike'
# Only the Thinking files are pushed for this test. Any Instruct files already
# on the device are left in place (this script never deletes device files).
$Files = @(
  'Qwen3VL-2B-Thinking-Q4_K_M.gguf',
  'mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf'
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ModelsDir = Join-Path $ProjectRoot 'models'

# --- verify adb ---
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  Write-Error 'adb not found on PATH. Install the Android platform-tools and retry.'
  exit 1
}

# --- resolve target device ---
# Force the parsed results into an array with @(...). Without it, a single
# connected device collapses to a bare string, and `$deviceLines[0]` would then
# return the first CHARACTER of the serial (e.g. "R") instead of the full serial.
$deviceLines = @(
  (& adb devices) |
    Select-Object -Skip 1 |
    Where-Object { $_ -match '\tdevice$' } |
    ForEach-Object { ($_ -split '\t')[0].Trim() }
)

if ($deviceLines.Count -eq 0) {
  Write-Error 'No authorized Android devices connected. Run `adb devices` and enable USB debugging.'
  exit 1
}

if ($Serial) {
  if ($deviceLines -notcontains $Serial) {
    Write-Error "Requested serial '$Serial' is not in the connected device list: $($deviceLines -join ', ')"
    exit 1
  }
} elseif ($deviceLines.Count -gt 1) {
  Write-Error "Multiple devices connected ($($deviceLines -join ', ')). Re-run with -Serial <serial>."
  exit 1
} else {
  $Serial = $deviceLines[0]
}

# --- validate the resolved serial against `adb devices` before copying ---
# Guards against a truncated/empty serial ever reaching the adb copy commands.
if ([string]::IsNullOrWhiteSpace($Serial) -or ($deviceLines -notcontains $Serial)) {
  Write-Error "Resolved device serial '$Serial' is not a complete, connected serial. Connected: $($deviceLines -join ', ')"
  exit 1
}

# adb invoked against the chosen serial.
function Invoke-Adb {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$AdbArgs)
  & adb -s $Serial @AdbArgs
}

Write-Host "Device  : $Serial"
Write-Host "Package : $Package"
Write-Host "Source  : $ModelsDir"
Write-Host ''

# --- verify local files ---
foreach ($file in $Files) {
  $local = Join-Path $ModelsDir $file
  if (-not (Test-Path $local)) {
    Write-Error "Local model file missing: $local. Run scripts\download-models.ps1 first."
    exit 1
  }
}

# --- verify the app is installed and debuggable (run-as works) ---
$probe = (Invoke-Adb shell "run-as $Package id" 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $probe -match 'not debuggable|unknown package|is unknown|Package .* is not|run-as: ') {
  Write-Error @"
run-as failed for $Package.

Details: $probe

Make sure the debug app is installed on this device first:

    npx expo run:android --device

(Only debuggable builds can be written to with run-as. Release builds cannot.)
"@
  exit 1
}

# --- ensure destination directory exists ---
Invoke-Adb shell "run-as $Package mkdir -p files/models" | Out-Null

# --- push each file ---
foreach ($file in $Files) {
  $local = Join-Path $ModelsDir $file
  $tmp = "/data/local/tmp/$file"

  Write-Host "PUSH  $file -> device tmp ..."
  Invoke-Adb push "$local" "$tmp" | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error "adb push failed for $file."; exit 1 }

  Write-Host "COPY  $file -> files/models (run-as) ..."
  # Single-quoted inner sh command so the app-side redirect is evaluated by the
  # device shell, not PowerShell.
  Invoke-Adb shell "cat $tmp | run-as $Package sh -c 'cat > files/models/$file'"
  if ($LASTEXITCODE -ne 0) { Write-Error "run-as copy failed for $file."; exit 1 }

  Write-Host "CLEAN removing $tmp ..."
  Invoke-Adb shell "rm -f $tmp" | Out-Null
}

# --- verify final sizes on device vs local ---
Write-Host ''
Write-Host 'Verification (device vs local):'
$allOk = $true
foreach ($file in $Files) {
  $local = Join-Path $ModelsDir $file
  $localSize = (Get-Item $local).Length

  $deviceSizeRaw = (Invoke-Adb shell "run-as $Package sh -c 'wc -c < files/models/$file'" 2>&1) -join ''
  $deviceSize = ($deviceSizeRaw -replace '[^0-9]', '')

  if ($deviceSize -eq "$localSize") {
    Write-Host ("  OK   {0,-42} {1} bytes" -f $file, $deviceSize)
  } else {
    $allOk = $false
    Write-Warning ("  MISMATCH {0}: device='{1}' local='{2}'" -f $file, $deviceSize, $localSize)
  }
}

Write-Host ''
Invoke-Adb shell "run-as $Package ls -l files/models"

Write-Host ''
if ($allOk) {
  Write-Host "All files copied and verified into /data/data/$Package/files/models"
  Write-Host 'Next: restart the app and press "Check model files".'
} else {
  Write-Error 'One or more files did not verify. Re-run the script.'
  exit 1
}
