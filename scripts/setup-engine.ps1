# Setup script (Windows): downloads llama-server from llama.cpp releases and renames to iimagine-engine
# Reads version and URLs from engine/version.json (single source of truth).
# Run this once during development setup or as part of the build pipeline.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BinDir = Join-Path $ProjectDir "bin"
$VersionFile = Join-Path $ProjectDir "engine" "version.json"
$EngineName = "iimagine-engine.exe"

# Check version.json exists
if (-not (Test-Path $VersionFile)) {
    Write-Error "engine/version.json not found at: $VersionFile"
    exit 1
}

# Parse version.json
$config = Get-Content $VersionFile | ConvertFrom-Json
$version = $config.version
$platformKey = "win32-x64"
$downloadUrl = $config.binaries.$platformKey
$expectedSha = $config.sha256.$platformKey

Write-Host "Setting up IIMAGINE Engine (llama.cpp $version)" -ForegroundColor Cyan
Write-Host "   Platform: $platformKey"
Write-Host "   Source: $downloadUrl"

# Check if already installed at correct version
$versionMarker = Join-Path $BinDir ".engine-version"
if ((Test-Path $versionMarker) -and ((Get-Content $versionMarker) -eq $version) -and (Test-Path (Join-Path $BinDir $EngineName))) {
    Write-Host "Already installed at version $version - skipping download." -ForegroundColor Green
    Write-Host "   To force reinstall, delete $(Join-Path $BinDir $EngineName)"
    exit 0
}

# Create bin directory
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir | Out-Null
}

# Download
$tempDir = Join-Path $env:TEMP "iimagine-engine-setup"
if (Test-Path $tempDir) { Remove-Item -Recurse -Force $tempDir }
New-Item -ItemType Directory -Path $tempDir | Out-Null

$archivePath = Join-Path $tempDir "llama-cpp.zip"

Write-Host "Downloading llama.cpp $version..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing

# Verify SHA256 if provided
if ($expectedSha) {
    Write-Host "Verifying SHA256..."
    $actualSha = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLower()
    if ($actualSha -ne $expectedSha) {
        Write-Error "SHA256 mismatch! Expected: $expectedSha Got: $actualSha"
        Remove-Item -Recurse -Force $tempDir
        exit 1
    }
    Write-Host "   SHA256 verified" -ForegroundColor Green
} else {
    Write-Host "   No SHA256 in version.json - skipping verification" -ForegroundColor Yellow
}

# Extract
Write-Host "Extracting..."
$extractDir = Join-Path $tempDir "extracted"
Expand-Archive -Path $archivePath -DestinationPath $extractDir

# Find llama-server.exe
$foundBinary = Get-ChildItem -Path $extractDir -Recurse -Filter "llama-server.exe" | Select-Object -First 1

if (-not $foundBinary) {
    $foundBinary = Get-ChildItem -Path $extractDir -Recurse -Filter "server.exe" | Select-Object -First 1
}

if (-not $foundBinary) {
    Write-Error "Could not find llama-server.exe in archive"
    Get-ChildItem -Path $extractDir -Recurse | Select-Object -First 20 | ForEach-Object { Write-Host $_.FullName }
    Remove-Item -Recurse -Force $tempDir
    exit 1
}

Write-Host "Found binary: $($foundBinary.FullName)" -ForegroundColor Green

# Copy and rename
Copy-Item -Path $foundBinary.FullName -Destination (Join-Path $BinDir $EngineName) -Force

# Copy DLLs
$binaryDir = $foundBinary.DirectoryName
Get-ChildItem -Path $extractDir -Recurse -Filter "*.dll" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $BinDir -Force
}
Write-Host "   Copied DLL dependencies"

# Write version marker
Set-Content -Path $versionMarker -Value $version

# Clean up
Remove-Item -Recurse -Force $tempDir

$enginePath = Join-Path $BinDir $EngineName
$size = [math]::Round((Get-Item $enginePath).Length / 1MB, 1)

Write-Host ""
Write-Host "IIMAGINE Engine installed at: $enginePath" -ForegroundColor Green
Write-Host "   Version: $version"
Write-Host "   Size: ${size}MB"
Write-Host "   Task Manager name: $EngineName"
