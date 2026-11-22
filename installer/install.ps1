param(
    [ValidateSet('Menu', 'Install', 'Repair', 'Uninstall')]
    [string]$Action = 'Menu'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

function Show-NodalMenu {
    $items = @('Install Nodal', 'Repair Nodal', 'Uninstall Nodal')
    $selected = 0
    $down = [char]0x2193
    $up = [char]0x2191
    $right = [char]0x2192
    $left = [char]0x2190

    while ($true) {
        try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
        try { [Console]::Clear() } catch { Clear-Host }
        Write-Host "Use the arrow keys to navigate: $down $up $right $left"
        Write-Host ''
        Write-Host '? What would you like to do? (Press Enter to confirm):'
        for ($i = 0; $i -lt $items.Count; $i += 1) {
            if ($i -eq $selected) { Write-Host "  > $($items[$i])" }
            else { Write-Host "    $($items[$i])" }
        }

        try {
            $key = [Console]::ReadKey($true).Key
        } catch {
            $answer = Read-Host 'Type 1, 2, or 3'
            if ($answer -eq '1') { return 'Install' }
            if ($answer -eq '2') { return 'Repair' }
            if ($answer -eq '3') { return 'Uninstall' }
            continue
        }

        switch ($key) {
            'UpArrow' { $selected = ($selected + $items.Count - 1) % $items.Count }
            'LeftArrow' { $selected = ($selected + $items.Count - 1) % $items.Count }
            'DownArrow' { $selected = ($selected + 1) % $items.Count }
            'RightArrow' { $selected = ($selected + 1) % $items.Count }
            'Enter' {
                if ($selected -eq 0) { return 'Install' }
                if ($selected -eq 1) { return 'Repair' }
                return 'Uninstall'
            }
            'Escape' { Write-Host 'Cancelled.'; exit 0 }
        }
    }
}

if ($Action -eq 'Menu') { $Action = Show-NodalMenu }

switch ($Action) {
    'Install' { Install-Nodal }
    'Repair' { Repair-Nodal }
    'Uninstall' { Uninstall-Nodal }
}
