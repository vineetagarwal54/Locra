<#
.SYNOPSIS
  Download the two Qwen3-VL-2B-Thinking GGUF files needed by the spike into a
  local top-level `models` directory.

.DESCRIPTION
  Pulls ONLY the Thinking files from the official repo
  `Qwen/Qwen3-VL-2B-Thinking-GGUF` using the Python `hf_hub_download()` API from
  an isolated local virtual environment (`.hf-venv`).

  Why not the `hf` / `huggingface-cli` CLI? On Windows, `pip install -U` while
  `hf.exe` is running fails because the running executable is file-locked. This
  script therefore:
    * uses a dedicated venv so it never touches system / global packages,
    * NEVER upgrades or reinstalls `huggingface_hub` (installs only if missing,
      and without `-U`),
    * NEVER launches `hf.exe` -- it calls the Python download API directly.

  Files already present in `models\` are skipped; the script resumes by
  downloading only the missing files (partial downloads resume automatically).
  Previously downloaded Instruct GGUF files are left untouched (different
  filenames). GGUF files are git-ignored and must NOT be committed.

.EXAMPLE
  .\scripts\download-models.ps1
  .\scripts\download-models.ps1 -Force
#>

[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$Repo = 'Qwen/Qwen3-VL-2B-Thinking-GGUF'
$Files = @(
  'Qwen3VL-2B-Thinking-Q4_K_M.gguf',
  'mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf'
)

# Resolve <projectRoot>/models regardless of where the script is invoked from.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ModelsDir = Join-Path $ProjectRoot 'models'
$VenvDir = Join-Path $ProjectRoot '.hf-venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'

Write-Host "Project root : $ProjectRoot"
Write-Host "Models dir   : $ModelsDir"
Write-Host "Venv         : $VenvDir"
Write-Host "HF repo      : $Repo"
Write-Host ''

if (-not (Test-Path $ModelsDir)) {
  New-Item -ItemType Directory -Path $ModelsDir | Out-Null
  Write-Host "Created $ModelsDir"
}

# --- ensure the isolated venv exists (bootstrapped from any base Python) ---
if (-not (Test-Path $VenvPython)) {
  $BasePython = $null
  foreach ($candidate in @('python', 'python3', 'py')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { $BasePython = $cmd.Source; break }
  }
  if (-not $BasePython) {
    Write-Error @'
No base Python interpreter found on PATH to create the virtual environment.

Install Python 3 (https://www.python.org/downloads/) and re-run this script.
'@
    exit 1
  }
  Write-Host "Creating isolated virtual environment at $VenvDir ..."
  & $BasePython -m venv $VenvDir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) {
    Write-Error 'Failed to create the virtual environment.'
    exit 1
  }
}

# --- ensure huggingface_hub is importable WITHOUT upgrading / reinstalling ---
# `find_spec` produces no stderr and just sets the exit code, so this is safe
# under `$ErrorActionPreference = 'Stop'`.
& $VenvPython -c "import importlib.util, sys; sys.exit(0 if importlib.util.find_spec('huggingface_hub') else 1)"
if ($LASTEXITCODE -ne 0) {
  Write-Host 'huggingface_hub not found in venv -- installing (no upgrade, no CLI) ...'
  # Deliberately NOT `-U`: never overwrite an in-use hf.exe. We also skip the
  # [cli] extra because we call the Python API directly, never the CLI.
  & $VenvPython -m pip install --disable-pip-version-check huggingface_hub
  if ($LASTEXITCODE -ne 0) {
    Write-Error 'Failed to install huggingface_hub into the venv.'
    exit 1
  }
} else {
  Write-Host 'huggingface_hub already present in venv (left as-is, no upgrade).'
}
Write-Host ''

# --- decide which files still need downloading (resume = only the missing) ---
$Missing = @()
foreach ($file in $Files) {
  $dest = Join-Path $ModelsDir $file
  if ((Test-Path $dest) -and (-not $Force)) {
    $sizeMb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host "SKIP  $file already exists ($sizeMb MB). Use -Force to re-download."
  } else {
    $Missing += $file
  }
}

if ($Missing.Count -eq 0) {
  Write-Host ''
  Write-Host 'All files already present. Nothing to download.'
} else {
  Write-Host ''
  Write-Host ("Downloading {0} missing file(s) via hf_hub_download() ..." -f $Missing.Count)

  # Python downloader. Uses hf_hub_download() which writes directly into models\
  # and automatically resumes interrupted downloads. Single-quoted here-string so
  # PowerShell does not expand anything; closing '@ at column 0.
  #
  # NOTE: this is written to a temp .py file and run as a script rather than
  # passed via `python -c`. On Windows, `-c` with a multi-line program is mangled
  # by the C-runtime argument parser (embedded double quotes are stripped), which
  # corrupted the f-strings. A real script file avoids all command-line quoting.
  $pyDownloader = @'
import os, sys
from huggingface_hub import hf_hub_download

repo = sys.argv[1]
local_dir = sys.argv[2]
files = sys.argv[3:]
force = os.environ.get("HF_FORCE_DOWNLOAD") == "1"

for fn in files:
    print("GET   " + fn + " ...", flush=True)
    path = hf_hub_download(
        repo_id=repo,
        filename=fn,
        local_dir=local_dir,
        force_download=force,
    )
    print("DONE  " + path, flush=True)
'@

  $pyFile = Join-Path ([System.IO.Path]::GetTempPath()) ("hf_download_{0}.py" -f ([guid]::NewGuid().ToString('N')))
  # ASCII (no BOM) — the downloader is pure ASCII; all dynamic values are passed
  # as argv, never embedded in the file.
  Set-Content -LiteralPath $pyFile -Value $pyDownloader -Encoding ASCII

  if ($Force) { $env:HF_FORCE_DOWNLOAD = '1' } else { $env:HF_FORCE_DOWNLOAD = '0' }
  try {
    & $VenvPython $pyFile $Repo $ModelsDir @Missing
    $downloadExit = $LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $pyFile -ErrorAction SilentlyContinue
    Remove-Item Env:\HF_FORCE_DOWNLOAD -ErrorAction SilentlyContinue
  }
  if ($downloadExit -ne 0) {
    Write-Error "Download failed (exit $downloadExit)."
    exit 1
  }
}

Write-Host ''
Write-Host 'Model files:'
$allOk = $true
foreach ($file in $Files) {
  $dest = Join-Path $ModelsDir $file
  if (Test-Path $dest) {
    $sizeMb = [math]::Round((Get-Item $dest).Length / 1MB, 1)
    Write-Host ("  {0,-42} {1,8} MB   {2}" -f $file, $sizeMb, $dest)
  } else {
    $allOk = $false
    Write-Warning "  $file is missing after download."
  }
}

Write-Host ''
if ($allOk) {
  Write-Host 'Done. Next: push the files to the device with scripts\push-models-android.ps1'
} else {
  Write-Error 'One or more files are missing. Re-run this script to resume.'
  exit 1
}
