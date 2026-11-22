# Nodal

Nodal extends the functionality of Medal by enhancing it with new features.

## Install

Download the latest release from [GitHub Releases](https://github.com/krushna06/Nodal/releases).

Or, install from source:

Run the following command from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1
```

Menu:

```text
Use the arrow keys to navigate: ↓ ↑ → ←
? What would you like to do? (Press Enter to confirm):
  > Install Nodal
    Repair Nodal
    Uninstall Nodal
```

## Development

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build\launch-dev.ps1
node .\scripts\test-runtime.js
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\verify.ps1
```

## Plugins

Built-ins: `janitor`, `adblocker`, and `devtools`.

The starter plugin is in `src\userplugins\example-plugin\`:

```text
src\userplugins\example-plugin\
  manifest.json   plugin details
  index.js        start/stop hooks
  style.css       styles loaded while enabled
```

Copy it, change the `id` and `name`, then rebuild. `manifest.json` needs a lowercase `id` and `name`; `entry` defaults to `index.js`, and `style.css` is picked up automatically. The example appears in **Settings → Nodal → Plugins** and can be enabled there.

In **Settings → Nodal → Plugins**, pick or drop a `plugin.zip` with the same files. Imported plugins enable immediately, persist locally, and can be removed there. Quick CSS has **Apply** and **Clear** only.
