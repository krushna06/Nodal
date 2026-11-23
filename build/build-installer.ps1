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
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class Program
{
    private const string Payload = "__PAYLOAD__";
    private const string ConfigName = "installer.json";
    private const string AsarBackupName = "app.asar.original";
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    private static string medalRoot;
    private static string asarPath;
    private static string extractedRoot;
    private static string backupDir;
    private static string configPath;

    [STAThread]
    private static int Main()
    {
        Json.MaxJsonLength = int.MaxValue;
        string temp = Path.Combine(Path.GetTempPath(), "NodalInstaller_" + Guid.NewGuid().ToString("N"));
        try
        {
            Console.WriteLine("Nodal installer: locating Medal...");
            Directory.CreateDirectory(temp);
            string zip = Path.Combine(temp, "payload.zip");
            string root = Path.Combine(temp, "Nodal");
            File.WriteAllBytes(zip, Convert.FromBase64String(Payload));
            ZipFile.ExtractToDirectory(zip, root);

            medalRoot = DetectMedalRoot();
            Console.WriteLine("Medal directory: " + medalRoot);
            asarPath = FindAppAsar(medalRoot);
            Console.WriteLine("Medal app archive: " + asarPath);

            backupDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Nodal", "backups");
            Directory.CreateDirectory(backupDir);
            configPath = Path.Combine(Path.GetDirectoryName(backupDir), ConfigName);
            string asarBackup = Path.Combine(backupDir, AsarBackupName);

            string sourceAsar = ResolveSourceAsar(asarBackup);
            Console.WriteLine("Pristine source archive: " + sourceAsar);

            extractedRoot = EnsureExtractedRoot(sourceAsar);
            Console.WriteLine("Extracted app: " + extractedRoot);

            string script = Path.Combine(root, "installer", "install.ps1");
            RunInstaller(script, root, asarBackup);

            string patchedHash = PatchInstalledAsar(sourceAsar, asarBackup, asarPath);
            SaveConfig(sourceAsar, patchedHash);
            RestartMedal();

            Console.WriteLine("NODAL INSTALL OK: Medal patched and relaunched.");
            return 0;
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

    private static string DetectMedalRoot()
    {
        string custom = Environment.GetEnvironmentVariable("NODAL_MEDAL_ROOT");
        if (!string.IsNullOrWhiteSpace(custom) && Directory.Exists(custom)) return Path.GetFullPath(custom);

        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Medal");
        if (!Directory.Exists(root))
            throw new Exception("Medal installation not found at " + root + ". Install Medal first, or set NODAL_MEDAL_ROOT.");
        return root;
    }

    private static string FindAppAsar(string root)
    {
        string preferred = Path.Combine(root, "current", "resources", "app.asar");
        if (File.Exists(preferred)) return preferred;

        string[] found = Directory.GetFiles(root, "app.asar", SearchOption.AllDirectories);
        if (found.Length == 0) throw new Exception("app.asar was not found under " + root + ".");
        Array.Sort(found, delegate(string a, string b) { return File.GetLastWriteTimeUtc(b).CompareTo(File.GetLastWriteTimeUtc(a)); });
        return found[0];
    }

    private static string ResolveSourceAsar(string asarBackup)
    {
        string currentHash = Sha256(asarPath);
        string patchedHash = ReadConfigValue("PatchedAsarSha256");

        if (File.Exists(asarBackup))
        {
            string backupHash = Sha256(asarBackup);
            if (currentHash == patchedHash || currentHash == backupHash) return asarBackup;

            Console.WriteLine("Medal update detected; refreshing the pristine archive backup.");
            File.Copy(asarPath, asarBackup, true);
            return asarBackup;
        }

        Console.WriteLine("Saving a pristine copy of app.asar for uninstall/repair.");
        File.Copy(asarPath, asarBackup, true);
        return asarBackup;
    }

    private static string EnsureExtractedRoot(string sourceAsar)
    {
        string dir = Path.Combine(medalRoot, "nodal-extracted");
        string sourceHash = Sha256(sourceAsar);
        if (string.Equals(ReadConfigValue("ExtractedRoot"), dir, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(ReadConfigValue("SourceAsarSha256"), sourceHash, StringComparison.OrdinalIgnoreCase) &&
            IsValidRoot(dir))
        {
            Console.WriteLine("Reusing already extracted app: " + dir);
            return dir;
        }

        Console.WriteLine("Extracting app.asar into " + dir + " ...");
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Directory.CreateDirectory(dir);
        ExtractAsar(sourceAsar, dir);

        // A fresh source means backups made from an older version are stale.
        string htmlBackup = Path.Combine(backupDir, "renderer.min.html.original");
        if (File.Exists(htmlBackup)) File.Delete(htmlBackup);
        return dir;
    }

    private static bool IsValidRoot(string path)
    {
        return Directory.Exists(path) &&
               File.Exists(Path.Combine(path, "renderer.min.html")) &&
               File.Exists(Path.Combine(path, "preload.min.js"));
    }

    private static void RunInstaller(string script, string workDir, string asarBackup)
    {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = "powershell.exe";
        psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Action Install";
        psi.WorkingDirectory = workDir;
        psi.UseShellExecute = false;
        psi.EnvironmentVariables["NODAL_EXTRACTED_ROOT"] = extractedRoot;
        psi.EnvironmentVariables["NODAL_BACKUP_DIR"] = backupDir;
        psi.EnvironmentVariables["NODAL_MEDAL_ROOT"] = medalRoot;
        psi.EnvironmentVariables["NODAL_INSTALLED_ASAR"] = asarPath;
        psi.EnvironmentVariables["NODAL_ASAR_BACKUP"] = asarBackup;
        psi.EnvironmentVariables["NODAL_SKIP_DEV_ASAR"] = "1";

        int code;
        using (Process process = Process.Start(psi))
        {
            process.WaitForExit();
            code = process.ExitCode;
        }
        if (code != 0) throw new Exception("The install script failed with exit code " + code + ".");
    }

    private static string PatchInstalledAsar(string sourceAsar, string asarBackup, string targetAsar)
    {
        string json;
        long dataStart;
        long dataLength;
        ReadAsarHeader(sourceAsar, out json, out dataStart, out dataLength);

        Dictionary<string, object> root = (Dictionary<string, object>)Json.DeserializeObject(json);
        object filesValue;
        if (!root.TryGetValue("files", out filesValue)) throw new Exception("app.asar header has no files map.");
        Dictionary<string, object> files = (Dictionary<string, object>)filesValue;

        List<AsarAddition> additions = new List<AsarAddition>();
        string htmlPath = Path.Combine(extractedRoot, "renderer.min.html");
        if (!File.Exists(htmlPath)) throw new Exception("Injected renderer.min.html is missing.");
        additions.Add(new AsarAddition("renderer.min.html", htmlPath));

        string nodalDir = Path.Combine(extractedRoot, "nodal");
        if (Directory.Exists(nodalDir))
        {
            foreach (string file in Directory.GetFiles(nodalDir, "*", SearchOption.AllDirectories))
            {
                string relative = file.Substring(nodalDir.Length).TrimStart(Path.DirectorySeparatorChar)
                    .Replace(Path.DirectorySeparatorChar, '/');
                additions.Add(new AsarAddition("nodal/" + relative, file));
            }
        }
        if (additions.Count < 2) throw new Exception("Nodal runtime files are missing from the extracted app.");

        long nextOffset = dataLength;
        foreach (AsarAddition addition in additions)
        {
            addition.Data = File.ReadAllBytes(addition.DiskPath);
            addition.Offset = nextOffset;
            nextOffset += addition.Data.Length;
        }

        foreach (AsarAddition addition in additions)
            SetAsarEntry(files, addition.EntryPath, addition.Data.Length, addition.Offset, MakeIntegrity(addition.Data));

        byte[] rawJson = new UTF8Encoding(false).GetBytes(Json.Serialize(root));
        int rawLength = rawJson.Length;
        int contentLength = (rawLength + 3) & ~3;
        byte[] jsonBytes = new byte[contentLength];
        Array.Copy(rawJson, jsonBytes, rawLength);
        for (int i = rawLength; i < contentLength; i++) jsonBytes[i] = (byte)' ';

        string tempAsar = targetAsar + ".nodal-tmp";
        try
        {
            using (FileStream input = File.OpenRead(sourceAsar))
            using (FileStream output = new FileStream(tempAsar, FileMode.Create, FileAccess.Write))
            {
                WriteUInt32(output, 4);
                WriteUInt32(output, (uint)(contentLength + 8));
                WriteUInt32(output, (uint)(contentLength + 4));
                WriteUInt32(output, (uint)contentLength);
                output.Write(jsonBytes, 0, jsonBytes.Length);

                input.Position = dataStart;
                CopyBytes(input, output, dataLength);
                foreach (AsarAddition addition in additions) output.Write(addition.Data, 0, addition.Data.Length);
            }

            ValidateAsar(tempAsar);
            StopMedalProcesses();

            if (!string.Equals(Path.GetFullPath(sourceAsar), Path.GetFullPath(asarBackup), StringComparison.OrdinalIgnoreCase))
                File.Copy(sourceAsar, asarBackup, true);

            File.SetAttributes(targetAsar, FileAttributes.Normal);
            File.Copy(tempAsar, targetAsar, true);
            return Sha256(targetAsar);
        }
        finally
        {
            try { if (File.Exists(tempAsar)) File.Delete(tempAsar); } catch { }
        }
    }

    private static void ReadAsarHeader(string path, out string json, out long dataStart, out long dataLength)
    {
        using (FileStream fs = File.OpenRead(path))
        {
            byte[] prefix = new byte[16];
            ReadExact(fs, prefix, 0, 16);
            int jsonLength = BitConverter.ToInt32(prefix, 12);
            if (jsonLength <= 0 || jsonLength > 128 * 1024 * 1024)
                throw new Exception("Invalid app.asar header in " + path + ".");
            byte[] bytes = new byte[jsonLength];
            ReadExact(fs, bytes, 0, jsonLength);
            json = new UTF8Encoding(false).GetString(bytes);
            dataStart = 16 + jsonLength;
            dataLength = fs.Length - dataStart;
        }
    }

    private static void ExtractAsar(string asarPath, string destRoot)
    {
        string json;
        long dataStart;
        long dataLength;
        ReadAsarHeader(asarPath, out json, out dataStart, out dataLength);
        Dictionary<string, object> root = (Dictionary<string, object>)Json.DeserializeObject(json);
        object filesValue;
        if (!root.TryGetValue("files", out filesValue)) throw new Exception("app.asar header has no files map.");
        string unpackedRoot = asarPath + ".unpacked";

        using (FileStream fs = File.OpenRead(asarPath))
        {
            foreach (KeyValuePair<string, object> pair in (Dictionary<string, object>)filesValue)
                ExtractNode((Dictionary<string, object>)pair.Value, pair.Key, fs, dataStart, destRoot, unpackedRoot);
        }
    }

    private static void ExtractNode(Dictionary<string, object> node, string relative, FileStream fs,
        long dataStart, string destRoot, string unpackedRoot)
    {
        object children;
        if (node.TryGetValue("files", out children))
        {
            foreach (KeyValuePair<string, object> pair in (Dictionary<string, object>)children)
                ExtractNode((Dictionary<string, object>)pair.Value, JoinRelative(relative, pair.Key), fs, dataStart, destRoot, unpackedRoot);
            return;
        }

        object sizeValue;
        object offsetValue;
        if (!node.TryGetValue("size", out sizeValue) || !node.TryGetValue("offset", out offsetValue)) return;
        string safe = SanitizeRelative(relative);
        if (safe == null) return;

        long size = Convert.ToInt64(sizeValue);
        long offset = Convert.ToInt64(offsetValue);
        string dest = Path.Combine(destRoot, safe.Replace('/', Path.DirectorySeparatorChar));
        string destDir = Path.GetDirectoryName(dest);
        if (!Directory.Exists(destDir)) Directory.CreateDirectory(destDir);

        string unpacked = Path.Combine(unpackedRoot, safe.Replace('/', Path.DirectorySeparatorChar));
        if (File.Exists(unpacked))
        {
            File.Copy(unpacked, dest, true);
            return;
        }

        using (FileStream output = File.Create(dest))
        {
            fs.Position = dataStart + offset;
            CopyBytes(fs, output, size);
        }
    }

    private static string JoinRelative(string relative, string name)
    {
        return string.IsNullOrEmpty(relative) ? name : relative + "/" + name;
    }

    private static string SanitizeRelative(string relative)
    {
        if (string.IsNullOrWhiteSpace(relative)) return null;
        string[] parts = relative.Replace('\\', '/').Split('/');
        List<string> safe = new List<string>();
        foreach (string part in parts)
        {
            if (string.IsNullOrEmpty(part) || part == "." || part == "..") continue;
            foreach (char c in Path.GetInvalidFileNameChars()) if (part.IndexOf(c) >= 0) return null;
            safe.Add(part);
        }
        return safe.Count == 0 ? null : string.Join("/", safe.ToArray());
    }

    private static void SetAsarEntry(Dictionary<string, object> files, string entryPath, long size, long offset, object integrity)
    {
        string[] parts = entryPath.Split('/');
        Dictionary<string, object> current = files;
        for (int i = 0; i < parts.Length - 1; i++)
        {
            object child;
            if (!current.TryGetValue(parts[i], out child) || !(child is Dictionary<string, object>))
            {
                child = new Dictionary<string, object>();
                current[parts[i]] = child;
            }
            Dictionary<string, object> directory = (Dictionary<string, object>)child;
            object nested;
            if (!directory.TryGetValue("files", out nested) || !(nested is Dictionary<string, object>))
            {
                nested = new Dictionary<string, object>();
                directory["files"] = nested;
            }
            current = (Dictionary<string, object>)nested;
        }

        Dictionary<string, object> entry = new Dictionary<string, object>();
        entry["size"] = size;
        entry["offset"] = offset.ToString();
        entry["integrity"] = integrity;
        current[parts[parts.Length - 1]] = entry;
    }

    private static object MakeIntegrity(byte[] data)
    {
        const int blockSize = 4194304;
        byte[] fullHash;
        using (SHA256 sha = SHA256.Create()) fullHash = sha.ComputeHash(data);

        List<string> blocks = new List<string>();
        if (data.Length == 0)
        {
            blocks.Add(Hex(fullHash));
        }
        else
        {
            for (int offset = 0; offset < data.Length; offset += blockSize)
            {
                int count = Math.Min(blockSize, data.Length - offset);
                using (MemoryStream slice = new MemoryStream(data, offset, count, false))
                using (SHA256 sha = SHA256.Create())
                    blocks.Add(Hex(sha.ComputeHash(slice)));
            }
        }

        Dictionary<string, object> result = new Dictionary<string, object>();
        result["algorithm"] = "SHA256";
        result["hash"] = Hex(fullHash);
        result["blockSize"] = blockSize;
        result["blocks"] = blocks.ToArray();
        return result;
    }

    private static void ValidateAsar(string path)
    {
        string json;
        long dataStart;
        long dataLength;
        ReadAsarHeader(path, out json, out dataStart, out dataLength);
        Dictionary<string, object> root = (Dictionary<string, object>)Json.DeserializeObject(json);
        Dictionary<string, object> files = (Dictionary<string, object>)root["files"];
        if (!files.ContainsKey("renderer.min.html")) throw new Exception("Patched archive is missing renderer.min.html.");
        object nodal;
        if (!files.TryGetValue("nodal", out nodal)) throw new Exception("Patched archive is missing nodal runtime.");
    }

    private static void StopMedalProcesses()
    {
        string prefix = medalRoot.TrimEnd('\\') + '\\';
        foreach (Process process in Process.GetProcesses())
        {
            try
            {
                string path = process.MainModule.FileName;
                if (path != null && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine("Stopping Medal process " + process.Id + " before patching.");
                    process.Kill();
                }
            }
            catch { }
        }
        Thread.Sleep(800);
    }

    private static void RestartMedal()
    {
        string exe = Path.Combine(medalRoot, "Medal.exe");
        if (!File.Exists(exe))
        {
            string[] found = Directory.GetFiles(medalRoot, "Medal.exe", SearchOption.AllDirectories);
            if (found.Length > 0) exe = found[0];
        }
        if (!File.Exists(exe))
        {
            Console.WriteLine("Medal.exe was not found; start Medal manually.");
            return;
        }
        ProcessStartInfo psi = new ProcessStartInfo(exe);
        psi.WorkingDirectory = Path.GetDirectoryName(exe);
        psi.UseShellExecute = true;
        Process.Start(psi);
        Console.WriteLine("Launched " + exe);
    }

    private static string Sha256(string path)
    {
        using (FileStream fs = File.OpenRead(path))
        using (SHA256 sha = SHA256.Create())
            return Hex(sha.ComputeHash(fs));
    }

    private static string Hex(byte[] bytes)
    {
        return BitConverter.ToString(bytes).Replace("-", "");
    }

    private static string ReadConfigValue(string key)
    {
        if (!File.Exists(configPath)) return null;
        string text = File.ReadAllText(configPath);
        int keyIndex = text.IndexOf("\"" + key + "\"", StringComparison.OrdinalIgnoreCase);
        if (keyIndex < 0) return null;
        int colon = text.IndexOf(':', keyIndex + key.Length + 2);
        if (colon < 0) return null;
        int first = text.IndexOf('"', colon + 1);
        if (first < 0) return null;
        int second = text.IndexOf('"', first + 1);
        if (second < 0) return null;
        return text.Substring(first + 1, second - first - 1).Replace("\\\\", "\\").Replace("\\/", "/");
    }

    private static void SaveConfig(string sourceAsar, string patchedHash)
    {
        StringBuilder sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine("  \"ExtractedRoot\": \"" + Escape(extractedRoot) + "\",");
        sb.AppendLine("  \"MedalRoot\": \"" + Escape(medalRoot) + "\",");
        sb.AppendLine("  \"AsarPath\": \"" + Escape(asarPath) + "\",");
        sb.AppendLine("  \"SourceAsarSha256\": \"" + Sha256(sourceAsar) + "\",");
        sb.AppendLine("  \"PatchedAsarSha256\": \"" + patchedHash + "\"");
        sb.AppendLine("}");
        File.WriteAllText(configPath, sb.ToString());
    }

    private static string Escape(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private static void ReadExact(Stream stream, byte[] buffer, int offset, int count)
    {
        int read = 0;
        while (read < count)
        {
            int n = stream.Read(buffer, offset + read, count - read);
            if (n == 0) throw new EndOfStreamException();
            read += n;
        }
    }

    private static void CopyBytes(Stream input, Stream output, long count)
    {
        byte[] buffer = new byte[81920];
        while (count > 0)
        {
            int n = (int)Math.Min(buffer.Length, count);
            int read = input.Read(buffer, 0, n);
            if (read == 0) throw new EndOfStreamException();
            output.Write(buffer, 0, read);
            count -= read;
        }
    }

    private static void WriteUInt32(Stream stream, uint value)
    {
        byte[] bytes = BitConverter.GetBytes(value);
        stream.Write(bytes, 0, 4);
    }

    private sealed class AsarAddition
    {
        public string EntryPath;
        public string DiskPath;
        public byte[] Data;
        public long Offset;

        public AsarAddition(string entryPath, string diskPath)
        {
            EntryPath = entryPath;
            DiskPath = diskPath;
        }
    }
}
'@

$source = $source.Replace('__PAYLOAD__', $base64)
[IO.File]::WriteAllText($csPath, $source, (New-Object System.Text.UTF8Encoding($false)))

& $csc /nologo /target:exe /out:$exePath /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll $csPath
if ($LASTEXITCODE -ne 0) { throw "Compilation failed with exit code $LASTEXITCODE" }

Remove-Item -LiteralPath $stage -Recurse -Force
Write-Host "INSTALLER OK: $exePath"
Write-Host "Installer bytes: $((Get-Item -LiteralPath $exePath).Length)"
