$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ParentRoot = Split-Path -Parent $ProjectRoot
if ($env:NODAL_EXTRACTED_ROOT) {
    $ExtractedRoot = $env:NODAL_EXTRACTED_ROOT
} else {
    $ExtractedRoot = Join-Path $ParentRoot 'medal-extracted'
}
$HtmlPath = Join-Path $ExtractedRoot 'renderer.min.html'
$PreloadPath = Join-Path $ExtractedRoot 'preload.min.js'
$BuildDir = Join-Path $ProjectRoot 'build\nodal'
$RuntimeSource = Join-Path $BuildDir 'bootstrap.js'
$RuntimeTargetDir = Join-Path $ExtractedRoot 'nodal'
$LegacyRuntimeTargetDir = Join-Path $ExtractedRoot 'medalmod'
$RuntimeTarget = Join-Path $RuntimeTargetDir 'bootstrap.js'
if ($env:NODAL_BACKUP_DIR) {
    $BackupDir = $env:NODAL_BACKUP_DIR
} else {
    $BackupDir = Join-Path $ProjectRoot 'backups'
}
$BackupPath = Join-Path $BackupDir 'renderer.min.html.original'
$ManifestPath = Join-Path $BackupDir 'install-manifest.json'
$LogDir = Join-Path $ProjectRoot 'logs'
$LogPath = Join-Path $LogDir 'install.log'
$ExpectedPreloadHash = '7B0DBB8EB5E3B4D0A56D89CFC01D0E6E20B78B1DA00CB22725254C13720C1069'
$BootstrapTag = '<script nonce="NONCE_PLACEHOLDER" src="./nodal/bootstrap.js"></script>'
$LegacyBootstrapTag = '<script nonce="NONCE_PLACEHOLDER" src="./medalmod/bootstrap.js"></script>'
$RendererPattern = '(?m)^(?<indent>[ \t]*)(?<tag><script\s+type="module"[^>]*src="\./renderer\.min\.js"[^>]*>\s*</script>)'
$ExtractedParent = Split-Path -Parent $ExtractedRoot
$DevRuntime = Join-Path $ExtractedParent 'medal-dev-runtime'
$DevAsar = Join-Path $DevRuntime 'resources\app.asar'
$InstalledAsar = Join-Path $env:LOCALAPPDATA 'Medal\current\resources\app.asar'
if ($env:NODAL_INSTALLED_ASAR) { $InstalledAsar = $env:NODAL_INSTALLED_ASAR }
if ($env:NODAL_MEDAL_ROOT) { $MedalRoot = $env:NODAL_MEDAL_ROOT }
else { $MedalRoot = Split-Path (Split-Path (Split-Path $InstalledAsar)) }
$AsarBackupPath = if ($env:NODAL_ASAR_BACKUP) { $env:NODAL_ASAR_BACKUP } else { Join-Path $BackupDir 'app.asar.original' }
$SkipDevAsar = $env:NODAL_SKIP_DEV_ASAR -eq '1'

function Write-NodalLog([string]$message) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $line = "$(Get-Date -Format o) $message"
    Write-Host $line
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Assert-NodalPreload {
    if (-not (Test-Path -LiteralPath $PreloadPath -PathType Leaf)) {
        throw "Preload missing: $PreloadPath"
    }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PreloadPath).Hash
    if ($hash -ne $ExpectedPreloadHash) {
        throw "Preload hash mismatch. Refusing to continue. Actual: $hash"
    }
    return $hash
}

function Stop-NodalDevApp {
    if (-not (Test-Path -LiteralPath $DevRuntime -PathType Container)) { return }
    $prefix = $DevRuntime.TrimEnd('\') + '\'
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    }
    foreach ($process in $processes) {
        Write-NodalLog "Stopping dev app process $($process.ProcessId) so the change takes effect."
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($processes) { Start-Sleep -Milliseconds 800 }
}

function Restore-NodalDevAsar {
    if ($SkipDevAsar) { return }
    if (-not (Test-Path -LiteralPath $DevAsar -PathType Leaf)) { return }
    if (-not (Test-Path -LiteralPath $InstalledAsar -PathType Leaf)) {
        Write-NodalLog 'Installed app.asar not found; dev runtime archive left unchanged.'
        return
    }
    Copy-Item -LiteralPath $InstalledAsar -Destination $DevAsar -Force
    Write-NodalLog 'Restored pristine app.asar in the isolated dev runtime.'
}

function Stop-NodalInstalledApp {
    if (-not (Test-Path -LiteralPath $MedalRoot -PathType Container)) { return }
    $prefix = $MedalRoot.TrimEnd('\') + '\'
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
    }
    foreach ($process in $processes) {
        Write-NodalLog "Stopping Medal process $($process.ProcessId) so the installed app can be changed."
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($processes) { Start-Sleep -Milliseconds 800 }
}

function Restore-NodalInstalledAsar {
    if (-not (Test-Path -LiteralPath $AsarBackupPath -PathType Leaf)) { return }
    if (-not (Test-Path -LiteralPath $InstalledAsar -PathType Leaf)) {
        Write-NodalLog 'Installed app.asar not found; pristine backup left in place.'
        return
    }
    Stop-NodalInstalledApp
    Copy-Item -LiteralPath $AsarBackupPath -Destination $InstalledAsar -Force
    Write-NodalLog 'Restored the original installed app.asar.'
}

function Update-NodalDevAsar {
    if ($SkipDevAsar) { return }
    if (-not (Test-Path -LiteralPath $DevRuntime -PathType Container)) { return }
    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        throw 'npx is required to refresh the dev app archive. Install Node.js or use build\launch-dev.ps1.'
    }
    Write-NodalLog 'Refreshing the isolated dev app archive.'
    & npx --yes @electron/asar pack --unpack '*.node' $ExtractedRoot $DevAsar
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "asar pack failed with exit code $LASTEXITCODE" }
    Write-NodalLog 'Dev app archive refreshed.'
}

function Invoke-NodalBuild {
    if (-not (Test-Path -LiteralPath $RuntimeSource -PathType Leaf)) {
        Write-NodalLog 'Build output missing; building runtime.'
        & (Join-Path $ProjectRoot 'build\build.ps1')
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE" }
    }
    if (-not (Test-Path -LiteralPath $RuntimeSource -PathType Leaf)) {
        throw "Runtime bundle missing after build: $RuntimeSource"
    }
}

function Install-Nodal {
    Stop-NodalDevApp
    if (-not (Test-Path -LiteralPath $ExtractedRoot -PathType Container)) { throw "Extracted app directory missing: $ExtractedRoot" }
    if (-not (Test-Path -LiteralPath $HtmlPath -PathType Leaf)) { throw "Renderer HTML missing: $HtmlPath" }

    $preloadHash = Assert-NodalPreload
    Write-NodalLog "Preload hash verified: $preloadHash"
    Invoke-NodalBuild

    $html = Get-Content -Raw -LiteralPath $HtmlPath
    if (-not ($html -match '<div\s+id="app"\s*></div>')) { throw 'Root <div id="app"></div> not found in renderer HTML.' }

    $rendererMatches = [regex]::Matches($html, $RendererPattern)
    if ($rendererMatches.Count -ne 1) { throw "Expected exactly one renderer module script, found $($rendererMatches.Count)." }

    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) {
        if ($html -match [regex]::Escape($BootstrapTag) -or $html -match [regex]::Escape($LegacyBootstrapTag)) {
            throw 'Backup is missing and the renderer is already injected. Refusing to back up an injected file.'
        }
        [System.IO.File]::WriteAllText($BackupPath, $html, (New-Object System.Text.UTF8Encoding($false)))
        Write-NodalLog "Backed up original renderer HTML to $BackupPath"
    } else {
        Write-NodalLog 'Existing backup preserved.'
    }

    $originalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupPath).Hash
    $manifest = @{
        installedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
        extractedRoot = $ExtractedRoot
        originalRendererHash = $originalHash
        preloadHash = $preloadHash
        bootstrapTag = $BootstrapTag
        installedAsar = $InstalledAsar
        asarBackup = $AsarBackupPath
        version = '0.1.0'
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ManifestPath -Encoding UTF8

    New-Item -ItemType Directory -Force -Path $RuntimeTargetDir | Out-Null
    Copy-Item -LiteralPath $RuntimeSource -Destination $RuntimeTarget -Force
    Copy-Item -LiteralPath (Join-Path $BuildDir 'manager.css') -Destination (Join-Path $RuntimeTargetDir 'manager.css') -Force
    Copy-Item -LiteralPath (Join-Path $BuildDir 'default-theme.css') -Destination (Join-Path $RuntimeTargetDir 'default-theme.css') -Force
    Write-NodalLog "Runtime copied to $RuntimeTargetDir"

    $tagCount = ([regex]::Matches($html, [regex]::Escape($BootstrapTag))).Count
    if ($tagCount -eq 0) {
        $newline = if ($html.Contains("`r`n")) { "`r`n" } else { "`n" }
        $match = $rendererMatches[0]
        $indent = $match.Groups['indent'].Value
        $html = $html.Insert($match.Index, $indent + $BootstrapTag + $newline)
        [System.IO.File]::WriteAllText($HtmlPath, $html, (New-Object System.Text.UTF8Encoding($false)))
        Write-NodalLog 'Bootstrap tag injected before the renderer module script.'
    } elseif ($tagCount -eq 1) {
        Write-NodalLog 'Bootstrap tag already present; injection skipped (idempotent).'
    } else {
        throw "Bootstrap tag appears $tagCount times. Refusing to continue."
    }

    $result = Get-Content -Raw -LiteralPath $HtmlPath
    $finalTagCount = ([regex]::Matches($result, [regex]::Escape($BootstrapTag))).Count
    $finalRendererCount = [regex]::Matches($result, $RendererPattern).Count
    $finalPreloadHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $PreloadPath).Hash

    if ($finalTagCount -ne 1) { throw "Validation failed: bootstrap tag count is $finalTagCount." }
    if ($finalRendererCount -ne 1) { throw "Validation failed: renderer module script count is $finalRendererCount." }
    if ($finalPreloadHash -ne $ExpectedPreloadHash) { throw 'Validation failed: preload was modified.' }
    if (-not (Test-Path -LiteralPath $RuntimeTarget -PathType Leaf)) { throw 'Validation failed: runtime bundle missing.' }
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw 'Validation failed: backup missing.' }

    Update-NodalDevAsar
    Write-NodalLog 'INSTALL OK: injection validated, original renderer preserved, preload unchanged.'
}

function Uninstall-Nodal([bool]$PreserveDevAsar = $false) {
    Stop-NodalDevApp
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf)) { throw "Cannot uninstall: backup missing at $BackupPath" }
    if (-not (Test-Path -LiteralPath $HtmlPath -PathType Leaf)) { throw "Renderer HTML missing: $HtmlPath" }

    if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) {
        $manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
        $expectedHtmlHash = $manifest.originalRendererHash
        $backupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupPath).Hash
        if ($expectedHtmlHash -and $backupHash -ne $expectedHtmlHash) {
            throw "Backup hash does not match the install manifest. Expected $expectedHtmlHash, got $backupHash"
        }
    }

    $original = Get-Content -Raw -LiteralPath $BackupPath
    if ($original -match [regex]::Escape($BootstrapTag) -or $original -match [regex]::Escape($LegacyBootstrapTag)) {
        throw 'Backup itself contains a Nodal bootstrap tag. Refusing to restore.'
    }

    [System.IO.File]::WriteAllText($HtmlPath, $original, (New-Object System.Text.UTF8Encoding($false)))
    Write-NodalLog 'Original renderer HTML restored from backup.'

    foreach ($dir in @($RuntimeTargetDir, $LegacyRuntimeTargetDir)) {
        if (Test-Path -LiteralPath $dir -PathType Container) {
            Remove-Item -LiteralPath $dir -Recurse -Force
            Write-NodalLog "Removed development assets: $dir"
        }
    }
    if (Test-Path -LiteralPath $ManifestPath -PathType Leaf) { Remove-Item -LiteralPath $ManifestPath -Force }
    if (Test-Path -LiteralPath $AsarBackupPath -PathType Leaf) {
        Restore-NodalInstalledAsar
    } elseif (-not $PreserveDevAsar) {
        Restore-NodalDevAsar
    }

    $result = Get-Content -Raw -LiteralPath $HtmlPath
    if (([regex]::Matches($result, [regex]::Escape($BootstrapTag))).Count -ne 0) { throw 'Validation failed: bootstrap tag still present.' }
    if (([regex]::Matches($result, [regex]::Escape($LegacyBootstrapTag))).Count -ne 0) { throw 'Validation failed: legacy bootstrap tag still present.' }
    if ($result -notmatch '<script\s+type="module"[^>]*src="\./renderer\.min\.js"') { throw 'Validation failed: renderer module script missing after restore.' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $HtmlPath).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupPath).Hash) { throw 'Validation failed: restored HTML differs from backup.' }
    Assert-NodalPreload | Out-Null

    Write-NodalLog 'UNINSTALL OK: extracted app restored, Nodal assets removed.'
}

function Repair-Nodal {
    $html = if (Test-Path -LiteralPath $HtmlPath) { Get-Content -Raw -LiteralPath $HtmlPath } else { '' }
    $installed = ($html -match [regex]::Escape($BootstrapTag)) -or (Test-Path -LiteralPath $RuntimeTargetDir -PathType Container)
    if ($installed) {
        Write-NodalLog 'Repair: removing the existing Nodal installation.'
        Uninstall-Nodal -PreserveDevAsar $true
    }
    Install-Nodal
    Write-NodalLog 'REPAIR OK: Nodal reinstalled and validated.'
}
