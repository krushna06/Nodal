$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$failures = New-Object System.Collections.Generic.List[string]
function Check([bool]$condition, [string]$description) {
    if ($condition) { Write-Host "PASS: $description" }
    else { Write-Host "FAIL: $description"; $failures.Add($description) }
}

$html = if (Test-Path -LiteralPath $HtmlPath) { Get-Content -Raw -LiteralPath $HtmlPath } else { '' }
$preloadHash = if (Test-Path -LiteralPath $PreloadPath) { (Get-FileHash -Algorithm SHA256 -LiteralPath $PreloadPath).Hash } else { '' }

Check (Test-Path -LiteralPath $ExtractedRoot -PathType Container) 'Extracted application directory exists'
Check ($html -ne '') 'Renderer HTML is readable'
Check (([regex]::Matches($html, [regex]::Escape($BootstrapTag))).Count -eq 1) 'Bootstrap tag exists exactly once'
Check (([regex]::Matches($html, $RendererPattern)).Count -eq 1) 'Original renderer module script exists exactly once'
Check ($html -match '<div\s+id="app"\s*></div>') 'Root <div id="app"></div> preserved'
Check ($html -match 'nonce="NONCE_PLACEHOLDER"') 'Nonce placeholder preserved for main-process substitution'
Check (Test-Path -LiteralPath (Join-Path $RuntimeTargetDir 'bootstrap.js') -PathType Leaf) 'Runtime bootstrap.js exists in extracted app'
Check (Test-Path -LiteralPath (Join-Path $RuntimeTargetDir 'manager.css') -PathType Leaf) 'Manager CSS reference exists'
Check (Test-Path -LiteralPath $BackupPath -PathType Leaf) 'Original HTML backup exists'
Check ($preloadHash -eq $ExpectedPreloadHash) 'Preload hash unchanged'

if ($failures.Count -gt 0) {
    Write-Host "VERIFY FAILED: $($failures.Count) check(s) failed."
    exit 1
}
Write-Host 'VERIFY OK: all checks passed.'
