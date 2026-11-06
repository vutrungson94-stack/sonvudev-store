# SonVuDev Store - Windows Server deployment.
#
# Linux (deploy/deploy.sh + systemd) is the primary, battle-tested target.
# This script is the equivalent for a Windows Server host: it deploys the built
# artifact (not the working tree), starts the shop as a Windows service through
# NSSM (https://nssm.cc), and refuses to report success when the health check
# does not answer.
#
# It does NOT improvise infrastructure: it requires Node 22+ on PATH, NSSM, and
# an existing service named "sonvudev-store". If the service is missing, register
# it once with:  nssm install sonvudev-store $env:ProgramFiles\nodejs\node.exe src\server.js
# (see deploy/README.md), then re-run deploy.ps1.
#
# Usage (from an elevated PowerShell):
#   npm run build
#   .\deploy\deploy.ps1
# Optional: .\deploy\deploy.ps1 -HealthPort 3000 -ServiceName sonvudev-store
param(
  [string]$ArtifactDir = "$PSScriptRoot\..\publish-output\node",
  [string]$InstallRoot = "",
  [string]$ServiceName = "sonvudev-store",
  [int]$HealthPort = 3000
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
  $InstallRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "sonvudev-store"
}

Write-Host "[deploy] Checking prerequisites..."

try { node --version | Out-Null } catch {
  Write-Error "Node.js is not on PATH. Install Node 22+ first."
  exit 1
}
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
  Write-Error "NSSM not found. Install it (choco install nssm) or register the service manually; see deploy/README.md."
  exit 1
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  Write-Error "Windows service '$ServiceName' does not exist. Register it once with: nssm install $ServiceName $env:ProgramFiles\nodejs\node.exe 'src\server.js'; then re-run deploy.ps1."
  exit 1
}

if (-not (Test-Path (Join-Path $ArtifactDir "package.json"))) {
  Write-Error "$ArtifactDir is not a deployable artifact (no package.json). Run 'npm run build' first."
  exit 1
}

foreach ($forbidden in @(".env", ".git", "data", "logs", "publish-output", ".wrangler", ".gbuildcache")) {
  $bad = Join-Path $ArtifactDir $forbidden
  if (Test-Path $bad) {
    Write-Error "Artifact contains $forbidden - refusing to deploy."
    exit 1
  }
}

$releaseId = (Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")
$releaseDir = Join-Path $InstallRoot "releases\$releaseId"
New-Item -ItemType Directory -Force -Path $InstallRoot, (Join-Path $InstallRoot "releases"), $releaseDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $ArtifactDir "*") $releaseDir

Write-Host "[deploy] Installing dependencies..."
push-location $releaseDir
try {
  npm ci --omit=dev --ignore-scripts
  if ($LASTEXITCODE -ne 0) { Write-Error "npm ci failed - release not activated."; exit 1 }
} finally {
  pop-location
}

$currentLink = Join-Path $InstallRoot "current"
if (Test-Path $currentLink) { Remove-Item $currentLink -Force }
# A junction is the reliable NTFS equivalent of a symlink for directories.
cmd /c mklink /J "$currentLink" "$releaseDir" | Out-Null

Write-Host "[deploy] Restarting service $ServiceName..."
Restart-Service -Name $ServiceName -Force

$healthUrl = "http://127.0.0.1:$HealthPort/api/health"
Write-Host "[deploy] Waiting for $healthUrl ..."
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $resp = Invoke-WebRequest -Uri $healthUrl -TimeoutSec 5 -UseBasicParsing
    if ($resp.StatusCode -eq 200) { $ok = $true; break }
  } catch {
    # keep waiting - a restart takes a few seconds
  }
}
if (-not $ok) {
  Write-Error "/api/health did not answer 200 within 60s. Investigate before serving traffic: Get-WinEvent -LogName Application -MaxEvents 20"
  exit 1
}

Write-Host "[deploy] Release activated: $releaseId"
