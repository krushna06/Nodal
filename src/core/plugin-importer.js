(function (internal) {
  'use strict';

  var CONFIG_KEY = 'importedPlugins';
  var MAX_ZIP_BYTES = 8 * 1024 * 1024;
  var packageRecords = Object.create(null);
  var decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;

  function text(bytes) {
    if (decoder) return decoder.decode(bytes);
    var result = '';
    for (var i = 0; i < bytes.length; i += 1) result += String.fromCharCode(bytes[i]);
    return result;
  }

  function safePath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    if (normalized.charAt(0) === '/' || /(^|\/)\.\.(\/|$)/.test(normalized)) return null;
    return normalized;
  }

  function findEocd(view) {
    var length = view.byteLength;
    var minimum = Math.max(0, length - 65557);
    for (var offset = length - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error('Not a valid ZIP archive');
  }

  function readEntries(buffer) {
    var view = new DataView(buffer);
    var eocd = findEocd(view);
    var count = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var bytes = new Uint8Array(buffer);
    var entries = Object.create(null);

    for (var i = 0; i < count; i += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('ZIP central directory is corrupt');
      }
      var method = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      var uncompressedSize = view.getUint32(offset + 24, true);
      var nameLength = view.getUint16(offset + 28, true);
      var extraLength = view.getUint16(offset + 30, true);
      var commentLength = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = text(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
      entries[name] = {
        method: method,
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        localOffset: localOffset
      };
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return { view: view, bytes: bytes, entries: entries };
  }

  function adler32(bytes) {
    var a = 1;
    var b = 0;
    for (var i = 0; i < bytes.length; i += 1) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('This Medal build cannot decompress plugin ZIP files');
    }

    var stream;
    try {
      stream = new DecompressionStream('deflate-raw');
    } catch (error) {
      var checksum = adler32(bytes);
      var wrapped = new Uint8Array(bytes.length + 6);
      wrapped[0] = 0x78;
      wrapped[1] = 0x9c;
      wrapped.set(bytes, 2);
      wrapped[bytes.length + 2] = (checksum >>> 24) & 0xff;
      wrapped[bytes.length + 3] = (checksum >>> 16) & 0xff;
      wrapped[bytes.length + 4] = (checksum >>> 8) & 0xff;
      wrapped[bytes.length + 5] = checksum & 0xff;
      stream = new DecompressionStream('deflate');
      bytes = wrapped;
    }

    var body = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(body).arrayBuffer());
  }

  async function readEntry(archive, name) {
    var entry = archive.entries[name];
    if (!entry) throw new Error('Missing file in plugin ZIP: ' + name);

    var view = archive.view;
    if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
      throw new Error('ZIP local header is corrupt');
    }
    var nameLength = view.getUint16(entry.localOffset + 26, true);
    var extraLength = view.getUint16(entry.localOffset + 28, true);
    var start = entry.localOffset + 30 + nameLength + extraLength;
    var data = archive.bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new Error('Unsupported ZIP compression method: ' + entry.method);
  }

  function findEntryName(archive, wanted) {
    if (archive.entries[wanted]) return wanted;
    var lower = wanted.toLowerCase();
    var names = Object.keys(archive.entries);
    for (var i = 0; i < names.length; i += 1) {
      if (names[i].toLowerCase() === lower) return names[i];
    }
    return null;
  }

  function normalizeManifest(manifest, archive) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('manifest.json must contain a JSON object');
    }

    var id = typeof manifest.id === 'string' ? manifest.id.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) {
      throw new Error('manifest.json needs a valid lowercase id (letters, numbers, dot, dash, underscore)');
    }
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
      throw new Error('manifest.json needs a name');
    }

    var entryName = safePath(manifest.entry || manifest.main || manifest.script || 'index.js');
    if (!entryName || !findEntryName(archive, entryName)) {
      throw new Error('Plugin entry file not found: ' + (entryName || 'index.js'));
    }

    var styleName = null;
    if (manifest.style) {
      styleName = safePath(manifest.style);
      if (!styleName || !findEntryName(archive, styleName)) {
        throw new Error('Plugin stylesheet not found: ' + manifest.style);
      }
    } else if (findEntryName(archive, 'style.css')) {
      styleName = 'style.css';
    }

    return {
      id: id,
      name: manifest.name.trim(),
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '1.0.0',
      author: typeof manifest.author === 'string' ? manifest.author : 'community',
      entry: entryName,
      style: styleName
    };
  }

  async function extractPackage(buffer, fileName) {
    if (!buffer || buffer.byteLength > MAX_ZIP_BYTES) {
      throw new Error('Plugin ZIP is too large (maximum 8 MB)');
    }

    var archive = readEntries(buffer);
    var manifestName = findEntryName(archive, 'manifest.json');
    if (!manifestName) throw new Error('plugin.zip must contain manifest.json');

    var manifestBytes = await readEntry(archive, manifestName);
    var rawManifest;
    try {
      rawManifest = JSON.parse(text(manifestBytes));
    } catch (error) {
      throw new Error('manifest.json is not valid JSON');
    }

    var manifest = normalizeManifest(rawManifest, archive);
    var entryName = findEntryName(archive, manifest.entry);
    var scriptBytes = await readEntry(archive, entryName);
    var css = '';
    if (manifest.style) {
      css = text(await readEntry(archive, findEntryName(archive, manifest.style)));
    }

    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      entry: manifest.entry,
      style: manifest.style,
      script: text(scriptBytes),
      css: css,
      fileName: fileName || 'plugin.zip',
      source: 'imported'
    };
  }

  function bootstrapNonce() {
    var tag = document.querySelector('script[src="./nodal/bootstrap.js"]');
    return tag ? (tag.nonce || tag.getAttribute('nonce') || '') : '';
  }

  function executeScript(pkg) {
    var nonce = bootstrapNonce();
    var script = document.createElement('script');
    script.setAttribute('data-nodal-plugin', pkg.id);
    if (nonce && nonce !== 'NONCE_PLACEHOLDER') script.setAttribute('nonce', nonce);

    window.NodalPlugin = null;
    window.NodalPluginContext = {
      id: pkg.id,
      manifest: {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        author: pkg.author
      },
      notify: function (message) { internal.ui.notify(message); },
      logger: internal.logger
    };

    script.textContent = '(function(){\n' + pkg.script + '\n})();';
    try {
      (document.head || document.documentElement).appendChild(script);
    } finally {
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    var hooks = window.NodalPlugin;
    window.NodalPlugin = null;
    window.NodalPluginContext = null;
    return hooks && typeof hooks.start === 'function' ? hooks : null;
  }

  function persistPackages() {
    var records = [];
    internal.plugins.list().forEach(function (plugin) {
      var pkg = packageRecords[plugin.id];
      if (!pkg || plugin.source !== 'imported') return;
      records.push({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        author: plugin.author,
        entry: pkg.entry,
        style: pkg.style,
        script: pkg.script,
        css: pkg.css,
        fileName: pkg.fileName,
        source: 'imported'
      });
    });
    internal.storage.updateConfig({ importedPlugins: records });
  }

  function registerPackage(pkg, options) {
    options = options || {};
    var source = options.source || pkg.source || 'imported';
    var removable = source === 'imported';
    var before = internal.plugins.ids();
    var hooks = executeScript(pkg);
    var descriptor = null;

    if (hooks) {
      var plugin = {
        id: pkg.id,
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        author: pkg.author,
        source: source,
        removable: removable,
        css: pkg.css,
        start: hooks.start,
        stop: hooks.stop
      };
      if (internal.plugins.register(plugin)) descriptor = internal.plugins.get(pkg.id);
      else descriptor = internal.plugins.get(pkg.id);
      if (descriptor) {
        internal.plugins.decorate(pkg.id, {
          source: source,
          removable: removable,
          css: pkg.css
        });
      }
    } else {
      var added = internal.plugins.ids().filter(function (id) { return before.indexOf(id) === -1; });
      if (added.length === 0) {
        throw new Error('Plugin script must set window.NodalPlugin.start() or call Nodal.plugins.register()');
      }
      var registeredId = added[0];
      internal.plugins.decorate(registeredId, {
        name: pkg.name,
        description: pkg.description,
        version: pkg.version,
        author: pkg.author,
        source: source,
        removable: removable,
        css: pkg.css
      });
      descriptor = internal.plugins.get(registeredId);
      pkg.id = registeredId;
    }

    if (!descriptor) throw new Error('Plugin could not be registered');
    packageRecords[pkg.id] = pkg;

    if (options.enabled) {
      internal.plugins.enable(pkg.id);
      descriptor = internal.plugins.get(pkg.id) || descriptor;
    }
    if (options.persist !== false && source === 'imported') persistPackages();
    if (!options.silent) internal.events.emit('plugin:imported', descriptor);
    return descriptor;
  }

  async function importFile(file) {
    if (!file) throw new Error('No plugin file selected');
    if (!/\.zip$/i.test(file.name || '')) throw new Error('Choose a plugin.zip file');
    if (typeof file.arrayBuffer !== 'function') throw new Error('This browser cannot read plugin files');

    var buffer = await file.arrayBuffer();
    var pkg = await extractPackage(buffer, file.name);
    var existing = internal.plugins.get(pkg.id);
    if (existing && existing.source !== 'imported') {
      throw new Error('A built-in plugin already uses the id "' + pkg.id + '"');
    }
    if (existing) internal.plugins.unregister(pkg.id);

    return registerPackage(pkg, { source: 'imported', enabled: true, persist: true });
  }

  function remove(id) {
    var plugin = internal.plugins.get(id);
    if (!plugin || plugin.source !== 'imported') return false;
    var removed = internal.plugins.unregister(id);
    if (!removed) return false;
    delete packageRecords[id];
    persistPackages();
    return true;
  }

  function restore() {
    var records = internal.storage.getConfig().importedPlugins || [];
    records.forEach(function (pkg) {
      try {
        registerPackage(pkg, { source: 'imported', enabled: false, persist: false, silent: true });
      } catch (error) {
        internal.logger.error('Could not restore imported plugin "' + (pkg && pkg.id) + '"', error);
      }
    });
  }

  function restoreUserPlugins() {
    var records = internal.userPlugins || [];
    records.forEach(function (pkg) {
      try {
        registerPackage(pkg, { source: 'userplugin', enabled: false, persist: false, silent: true });
      } catch (error) {
        internal.logger.error('Could not load user plugin "' + (pkg && pkg.id) + '"', error);
      }
    });
  }

  internal.pluginImporter = {
    extractPackage: extractPackage,
    registerPackage: registerPackage,
    importFile: importFile,
    remove: remove,
    restore: restore,
    restoreUserPlugins: restoreUserPlugins
  };
})(window.__NodalInternal);
