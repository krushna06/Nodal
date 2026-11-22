$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $projectRoot 'build\nodal'
$userPluginsRoot = Join-Path $projectRoot 'src\userplugins'

if (Test-Path -LiteralPath $outDir) { Remove-Item -LiteralPath $outDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$order = @(
    'src\core\logger.js',
    'src\core\events.js',
    'src\core\storage.js',
    'src\core\plugin-manager.js',
    'src\core\plugin-importer.js',
    'src\core\theme-manager.js',
    'src\core\quick-css.js',
    'src\ui\manager.js',
    'src\plugins\janitor-plugin.js',
    'src\plugins\adblocker-plugin.js',
    'src\plugins\devtools-plugin.js',
    'src\core\runtime.js',
    'src\bootstrap.js'
)

$parts = New-Object System.Collections.Generic.List[string]
$parts.Add('/* Nodal 0.1.0 - generated single-file renderer bundle. Do not edit by hand. */')
$parts.Add('(function () { "use strict"; window.__NodalInternal = window.__NodalInternal || {}; })();')

function ConvertTo-JsString([string]$text) {
    $escaped = $text.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n').Replace("`t", '\t')
    return '"' + $escaped + '"'
}

function Get-SafePath([string]$root, [string]$value, [string]$label) {
    if ([string]::IsNullOrWhiteSpace($value)) { throw "$label is required" }
    $normalized = $value.Replace('\', '/')
    if ($normalized.StartsWith('/') -or $normalized -match '(^|/)\.\.(/|$)') {
        throw "$label cannot leave the plugin folder: $value"
    }
    $path = Join-Path $root ($normalized.Replace('/', '\'))
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$label not found: $value" }
    return $path
}

$managerCss = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src\ui\manager.css')
$themeCss = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src\themes\default.css')
$parts.Add('(function (i) { i.css = { manager: ' + (ConvertTo-JsString $managerCss) + ', defaultTheme: ' + (ConvertTo-JsString $themeCss) + ' }; })(window.__NodalInternal);')

$userPlugins = New-Object System.Collections.Generic.List[object]
if (Test-Path -LiteralPath $userPluginsRoot -PathType Container) {
    foreach ($directory in (Get-ChildItem -LiteralPath $userPluginsRoot -Directory)) {
        $manifestPath = Join-Path $directory.FullName 'manifest.json'
        if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { continue }

        try {
            $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        } catch {
            throw "Invalid manifest.json in $($directory.FullName): $($_.Exception.Message)"
        }

        $id = if ($manifest.id) { [string]$manifest.id } else { '' }
        if ($id -notmatch '^[a-z0-9][a-z0-9._-]{1,63}$') {
            throw "Invalid plugin id '$id' in $($directory.FullName)"
        }

        $entryValue = if ($manifest.entry) { [string]$manifest.entry } elseif ($manifest.main) { [string]$manifest.main } else { 'index.js' }
        $entryPath = Get-SafePath $directory.FullName $entryValue 'Plugin entry'

        $styleValue = if ($manifest.style) { [string]$manifest.style } else { '' }
        if (-not $styleValue -and (Test-Path -LiteralPath (Join-Path $directory.FullName 'style.css') -PathType Leaf)) {
            $styleValue = 'style.css'
        }
        $css = ''
        if ($styleValue) {
            $stylePath = Get-SafePath $directory.FullName $styleValue 'Plugin stylesheet'
            $css = Get-Content -Raw -LiteralPath $stylePath
        }

        $userPlugins.Add([ordered]@{
            id          = $id
            name        = if ($manifest.name) { [string]$manifest.name } else { $id }
            description = if ($manifest.description) { [string]$manifest.description } else { '' }
            version     = if ($manifest.version) { [string]$manifest.version } else { '1.0.0' }
            author      = if ($manifest.author) { [string]$manifest.author } else { 'local' }
            entry       = $entryValue.Replace('\', '/')
            style       = $styleValue.Replace('\', '/')
            script      = Get-Content -Raw -LiteralPath $entryPath
            css         = $css
            fileName    = $directory.Name
            source      = 'userplugin'
        })
        Write-Host "USER PLUGIN: $id ($($directory.Name))"
    }
}

$jsonItems = New-Object System.Collections.Generic.List[string]
foreach ($plugin in $userPlugins) {
    $jsonItems.Add('{' +
        '"id":' + (ConvertTo-JsString ([string]$plugin.id)) + ',' +
        '"name":' + (ConvertTo-JsString ([string]$plugin.name)) + ',' +
        '"description":' + (ConvertTo-JsString ([string]$plugin.description)) + ',' +
        '"version":' + (ConvertTo-JsString ([string]$plugin.version)) + ',' +
        '"author":' + (ConvertTo-JsString ([string]$plugin.author)) + ',' +
        '"entry":' + (ConvertTo-JsString ([string]$plugin.entry)) + ',' +
        '"style":' + (ConvertTo-JsString ([string]$plugin.style)) + ',' +
        '"script":' + (ConvertTo-JsString ([string]$plugin.script)) + ',' +
        '"css":' + (ConvertTo-JsString ([string]$plugin.css)) + ',' +
        '"fileName":' + (ConvertTo-JsString ([string]$plugin.fileName)) + ',' +
        '"source":' + (ConvertTo-JsString ([string]$plugin.source)) +
        '}')
}
if ($jsonItems.Count -gt 0) { $userPluginsJson = '[' + [string]::Join(',', $jsonItems) + ']' }
else { $userPluginsJson = '[]' }
$parts.Add('(function (i) { i.userPlugins = ' + $userPluginsJson + '; })(window.__NodalInternal);')

foreach ($relative in $order) {
    $path = Join-Path $projectRoot $relative
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing source file: $path" }
    $parts.Add((Get-Content -Raw -LiteralPath $path))
}

$bundle = [string]::Join("`r`n`r`n", $parts)
$outputPath = Join-Path $outDir 'bootstrap.js'
$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outputPath, $bundle, $encoding)

Copy-Item -LiteralPath (Join-Path $projectRoot 'src\ui\manager.css') -Destination (Join-Path $outDir 'manager.css') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'src\themes\default.css') -Destination (Join-Path $outDir 'default-theme.css') -Force

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash
Write-Host "BUILD OK: $outputPath"
Write-Host "Bundle bytes: $((Get-Item -LiteralPath $outputPath).Length)"
Write-Host "User plugins: $($userPlugins.Count)"
Write-Host "SHA256: $hash"
