$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP ('nodal-installer-stage-' + [guid]::NewGuid().ToString('N'))
$zipPath = Join-Path $stage 'payload.zip'
$csPath = Join-Path $stage 'InstallerProgram.cs'
$exePath = Join-Path $projectRoot 'NodalInstaller.exe'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $csc -PathType Leaf)) { throw "C# compiler not found: $csc" }

New-Item -ItemType Directory -Force -Path (Join-Path $stage 'installer') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'build') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'src') | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\common.ps1') -Destination (Join-Path $stage 'installer\common.ps1') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\install.ps1') -Destination (Join-Path $stage 'installer\install.ps1') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'build\build.ps1') -Destination (Join-Path $stage 'build\build.ps1') -Force
Copy-Item -Path (Join-Path $projectRoot 'src\*') -Destination (Join-Path $stage 'src') -Recurse -Force

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -Force
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($zipPath))

$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Windows.Forms;

internal static class Program
{
    private const string Payload = "__PAYLOAD__";
    private const string ConfigName = "installer.json";

    [STAThread]
    private static int Main()
    {
        string temp = Path.Combine(Path.GetTempPath(), "NodalInstaller_" + Guid.NewGuid().ToString("N"));
        string zip = Path.Combine(temp, "payload.zip");
        string root = Path.Combine(temp, "Nodal");

        try
        {
            Directory.CreateDirectory(temp);
            File.WriteAllBytes(zip, Convert.FromBase64String(Payload));
            ZipFile.ExtractToDirectory(zip, root);

            string extracted = ResolveExtractedRoot();
            string script = Path.Combine(root, "installer", "install.ps1");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.EnvironmentVariables["NODAL_EXTRACTED_ROOT"] = extracted;

            string backupDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Nodal", "backups");
            Directory.CreateDirectory(backupDir);
            psi.EnvironmentVariables["NODAL_BACKUP_DIR"] = backupDir;

            int code;
            using (Process process = Process.Start(psi))
            {
                process.WaitForExit();
                code = process.ExitCode;
            }
            if (code == 0) RestartDevApp(extracted);
            return code;
        }
        catch (Exception ex)
        {
            Console.WriteLine("NODAL INSTALLER ERROR: " + ex.Message);
            return 1;
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
        }
    }

    private static void RestartDevApp(string extracted)
    {
        string parent = Path.GetFullPath(Path.Combine(extracted, ".."));
        string devExe = Path.Combine(parent, "medal-dev-runtime", "Medal.exe");
        if (!File.Exists(devExe)) return;
        string userData = Path.Combine(parent, "medal-dev-userdata");
        Directory.CreateDirectory(userData);

        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = devExe;
        psi.Arguments = "--remote-debugging-port=9223 --user-data-dir=\"" + userData + "\" --no-first-run";
        psi.UseShellExecute = false;
        Process.Start(psi);
        Console.WriteLine("Restarted Medal with the updated runtime.");
    }

    private static string ResolveExtractedRoot()
    {
        string config = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Nodal", ConfigName);

        if (File.Exists(config))
        {
            string saved = ReadConfig(config);
            if (IsValidRoot(saved)) return saved;
        }

        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string candidate = Path.GetFullPath(Path.Combine(exeDir, "..", "medal-extracted"));
        if (IsValidRoot(candidate)) { SaveConfig(config, candidate); return candidate; }

        candidate = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "medal-extracted"));
        if (IsValidRoot(candidate)) { SaveConfig(config, candidate); return candidate; }

        Console.WriteLine();
        Console.WriteLine("Select the extracted Medal folder (the one with renderer.min.html).");
        using (FolderBrowserDialog dialog = new FolderBrowserDialog())
        {
            dialog.Description = "Choose the extracted Medal app folder";
            dialog.ShowNewFolderButton = false;
            if (dialog.ShowDialog() != DialogResult.OK)
                throw new Exception("No extracted Medal folder was selected.");
            if (!IsValidRoot(dialog.SelectedPath))
                throw new Exception("That folder is missing renderer.min.html or preload.min.js.");
            SaveConfig(config, dialog.SelectedPath);
            return dialog.SelectedPath;
        }
    }

    private static bool IsValidRoot(string path)
    {
        if (string.IsNullOrEmpty(path) || !Directory.Exists(path)) return false;
        return File.Exists(Path.Combine(path, "renderer.min.html")) &&
               File.Exists(Path.Combine(path, "preload.min.js"));
    }

    private static string ReadConfig(string path)
    {
        string text = File.ReadAllText(path);
        int key = text.IndexOf("ExtractedRoot", StringComparison.OrdinalIgnoreCase);
        if (key < 0) return null;
        int colon = text.IndexOf(':', key);
        if (colon < 0) return null;
        int first = text.IndexOf('"', colon + 1);
        if (first < 0) return null;
        int second = text.IndexOf('"', first + 1);
        if (second < 0) return null;
        return text.Substring(first + 1, second - first - 1).Replace("\\\\", "\\");
    }

    private static void SaveConfig(string path, string root)
    {
        string dir = Path.GetDirectoryName(path);
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        string json = "{\n  \"ExtractedRoot\": \"" + root.Replace("\\", "\\\\") + "\"\n}\n";
        File.WriteAllText(path, json);
    }
}
'@

$source = $source.Replace('__PAYLOAD__', $base64)
[IO.File]::WriteAllText($csPath, $source, (New-Object System.Text.UTF8Encoding($false)))

& $csc /nologo /target:exe /out:$exePath /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll $csPath
if ($LASTEXITCODE -ne 0) { throw "Compilation failed with exit code $LASTEXITCODE" }

Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host "INSTALLER OK: $exePath"
Write-Host "Installer bytes: $((Get-Item -LiteralPath $exePath).Length)"
