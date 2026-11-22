$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$parentRoot = Split-Path -Parent $projectRoot
$installedRoot = Join-Path $env:LOCALAPPDATA 'Medal\current'
$devRuntime = Join-Path $parentRoot 'medal-dev-runtime'
$devUserData = Join-Path $parentRoot 'medal-dev-userdata'
$extractedRoot = if ($env:NODAL_EXTRACTED_ROOT) { $env:NODAL_EXTRACTED_ROOT } else { Join-Path $parentRoot 'medal-extracted' }
$devExe = Join-Path $devRuntime 'Medal.exe'
$devAsar = Join-Path $devRuntime 'resources\app.asar'
$logPath = Join-Path $projectRoot 'logs\launch.log'

function Log([string]$message) {
    $line = "$(Get-Date -Format o) $message"
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

if (-not (Test-Path -LiteralPath $installedRoot -PathType Container)) { throw "Installed Medal directory missing: $installedRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $extractedRoot 'renderer.min.html') -PathType Leaf)) { throw 'Extracted app is not ready.' }

if (-not (Test-Path -LiteralPath $devExe -PathType Leaf)) {
    Log "Creating isolated Electron runtime copy at $devRuntime (installed directory is read-only source)."
    New-Item -ItemType Directory -Force -Path $devRuntime | Out-Null
    foreach ($entry in (Get-ChildItem -LiteralPath $installedRoot -Force)) {
        if ($entry.Name -eq 'resources') {
            $destResources = Join-Path $devRuntime 'resources'
            New-Item -ItemType Directory -Force -Path $destResources | Out-Null
            foreach ($resource in (Get-ChildItem -LiteralPath $entry.FullName -Force)) {
                if ($resource.Name -eq 'app.asar') { continue }
                Copy-Item -LiteralPath $resource.FullName -Destination $destResources -Recurse -Force
            }
        } else {
            Copy-Item -LiteralPath $entry.FullName -Destination $devRuntime -Recurse -Force
        }
    }
    Log 'Electron runtime copy created.'
} else {
    Log "Reusing existing Electron runtime copy: $devRuntime"
}

Log 'Packing the extracted development app into the isolated app.asar.'
& npx --yes @electron/asar pack --unpack '*.node' $extractedRoot $devAsar
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "asar pack failed with exit code $LASTEXITCODE" }

New-Item -ItemType Directory -Force -Path $devUserData | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null

$arguments = @(
    '--remote-debugging-port=9223',
    "--user-data-dir=$devUserData",
    '--no-first-run'
)

Log "Launching $devExe with the injected development app archive."
Start-Process -FilePath $devExe -ArgumentList $arguments
Log 'NODAL_DEV_LAUNCHED'
