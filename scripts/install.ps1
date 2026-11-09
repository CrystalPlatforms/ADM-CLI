#Requires -Version 5.1
# ADM CLI installer for Windows (portable bundle, no Node required)
#
# Usage:
#   irm https://raw.githubusercontent.com/CrystalPlatforms/ADM-CLI/main/scripts/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-DryRun] [-BundlePath <file>] [-Version <v>]
#
# What it does:
#   1. detects OS arch (x64/arm64)
#   2. downloads the release bundle (adm/app + adm/runtime - private Node)
#      - or uses -BundlePath / $env:ADM_BUNDLE as a local source
#   3. verifies the sha256 checksum BEFORE writing anything
#   4. unpacks to %LOCALAPPDATA%\adm\{app,runtime}
#   5. installs the launcher adm.cmd into %LOCALAPPDATA%\Microsoft\WindowsApps
#      (already on the user PATH - no admin, no system changes)
#
# No sudo, no system Node. Env overrides: ADM_VERSION, ADM_BUNDLE,
# ADM_BUNDLE_SHA256, ADM_HOME (default %LOCALAPPDATA%\adm).
#
# NOTE: this file is intentionally pure ASCII. PowerShell 5.1 reads BOM-less
# .ps1 files as ANSI; multi-byte UTF-8 punctuation then corrupts parsing.
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$BundlePath = $env:ADM_BUNDLE,
  [string]$Version = $env:ADM_VERSION,
  [string]$BundleSha256 = $env:ADM_BUNDLE_SHA256
)

$ErrorActionPreference = "Stop"
$Repo = "CrystalPlatforms/ADM-CLI"
$AdmHome = if ($env:ADM_HOME) { $env:ADM_HOME } else { Join-Path $env:LOCALAPPDATA "adm" }
$LauncherDir = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps"

function Info([string]$m) { Write-Host "  [INFO] $m" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "  [ERROR] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  ADM installer - Windows" -ForegroundColor White
Write-Host ""

# ---- 1. arch detection ----
switch ($env:PROCESSOR_ARCHITECTURE) {
  "ARM64" { $Arch = "arm64" }
  default { $Arch = "x64" }
}
$Target = "win32-$Arch"
Info "Detected: $Target"

# ---- 2. source: local bundle or release download ----
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("adm-install-" + [Guid]::NewGuid().ToString("N"))
try {
  if ($BundlePath) {
    if (-not (Test-Path $BundlePath)) { Fail "Bundle not found: $BundlePath"; exit 1 }
    $bundle = $BundlePath
    Info "Using local bundle: $bundle"
    if (-not $BundleSha256 -and (Test-Path "$bundle.sha256")) {
      $BundleSha256 = (Get-Content "$bundle.sha256" -TotalCount 1).Split(" ")[0]
    }
    if ($DryRun) { Info "[PLAN] would verify sha256 and unpack to $AdmHome" }
  } else {
    if (-not $Version) {
      Info "Resolving the latest release version"
      try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "adm-installer" }
        $Version = ($rel.tag_name -replace "^v", "")
      } catch {
        Fail "Cannot resolve the latest release - pass -Version explicitly"
        exit 1
      }
    }
    $asset = "adm-v$Version-$Target.tar.gz"
    $url = "https://github.com/$Repo/releases/download/v$Version/$asset"
    Info "Downloading $url"
    if ($DryRun) {
      Info "[PLAN] would verify sha256 against $asset.sha256"
      Info "[PLAN] would unpack to $AdmHome (app + runtime)"
      Info "[PLAN] would install the launcher to $LauncherDir\adm.cmd"
      Write-Host ""
      Write-Host "  Dry run complete - nothing was written." -ForegroundColor White
      exit 0
    }
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $bundle = Join-Path $tmp $asset
    Invoke-WebRequest -Uri $url -OutFile $bundle -UseBasicParsing
    try {
      Invoke-WebRequest -Uri "$url.sha256" -OutFile "$bundle.sha256" -UseBasicParsing
      $BundleSha256 = (Get-Content "$bundle.sha256" -TotalCount 1).Split(" ")[0]
    } catch { Warn "No checksum published for this asset - skipping verification" }
  }

  # ---- 3. sha256 verification - BEFORE anything is written ----
  if ($BundleSha256) {
    Info "Verifying sha256"
    # .NET SHA256 directly - Get-FileHash can be missing in constrained
    # PSModulePath setups, and this works on every PowerShell 5.1.
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $stream = [System.IO.File]::OpenRead($bundle)
      try {
        $actual = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLower()
      } finally {
        $stream.Dispose()
      }
    } finally {
      $sha256.Dispose()
    }
    if ($actual -ne $BundleSha256.ToLower()) {
      Fail "Checksum mismatch - the bundle is corrupted or tampered with. Nothing was written."
      Fail "Expected: $BundleSha256"
      Fail "Actual:   $actual"
      exit 1
    }
    Ok "Checksum verified"
  }

  if ($DryRun) {
    Info "[PLAN] would unpack to $AdmHome (app + runtime)"
    Info "[PLAN] would install the launcher to $LauncherDir\adm.cmd"
    Write-Host ""
    Write-Host "  Dry run complete - nothing was written." -ForegroundColor White
    exit 0
  }

  # ---- 4. unpack to %LOCALAPPDATA%\adm ----
  Info "Unpacking to $AdmHome"
  $unpack = Join-Path $tmp "unpack"
  New-Item -ItemType Directory -Force -Path $unpack | Out-Null
  tar -xzf $bundle -C $unpack
  if (-not (Test-Path (Join-Path $unpack "adm\app"))) {
    Fail "Bundle layout unexpected (adm/app missing)"; exit 1
  }
  New-Item -ItemType Directory -Force -Path $AdmHome | Out-Null
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $AdmHome "app")
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $AdmHome "runtime")
  Move-Item (Join-Path $unpack "adm\app") (Join-Path $AdmHome "app")
  Move-Item (Join-Path $unpack "adm\runtime") (Join-Path $AdmHome "runtime")
  Ok "Installed app + runtime to $AdmHome"

  # ---- 5. launcher (WindowsApps is on the user PATH by default) ----
  Info "Installing launcher to $LauncherDir\adm.cmd"
  New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null
  $launcherBody = "@echo off`r`nREM ADM launcher - runs adm under the bundled private Node.`r`n`"$AdmHome\runtime\node.exe`" `"$AdmHome\app\bin\adm`" %*`r`n"
  Set-Content -Path (Join-Path $LauncherDir "adm.cmd") -Value $launcherBody -Encoding Ascii
  Ok "Launcher installed: $(Join-Path $LauncherDir 'adm.cmd')"

  # Ensure the launcher dir is on the USER PATH (usually already is).
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$LauncherDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$LauncherDir", "User")
    Ok "Added launcher dir to the user PATH"
  }

  Write-Host ""
  Write-Host "  ADM is installed. Open a NEW terminal, then run: adm help" -ForegroundColor White
  Write-Host ""
} finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}
