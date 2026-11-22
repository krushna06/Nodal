(function (internal) {
  'use strict';

  var CONFIG_KEY = 'importedThemes';
  var MAX_ZIP_BYTES = 8 * 1024 * 1024;
  var packageRecords = Object.create(null);
  var zip = internal.zip;

  function normalizeVariables(input) {
    var result = Object.create(null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
    var keys = Object.keys(input);
    for (var i = 0; i < keys.length && i < 200; i += 1) {
      var name = keys[i];
      var value = input[name];
      if (!/^--[a-zA-Z0-9-]+$/.test(name)) continue;
      if (typeof value !== 'string' || !value.trim()) continue;
      if (/[;{}\r\n]/.test(value) || value.length > 500) continue;
      result[name] = value.trim();
    }
    return result;
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

    var variables = normalizeVariables(manifest.variables);
    var styleName = null;
    if (manifest.style) {
      styleName = zip.safePath(manifest.style);
      if (!styleName || !zip.findEntryName(archive, styleName)) {
        throw new Error('Theme stylesheet not found: ' + manifest.style);
      }
    } else if (zip.findEntryName(archive, 'style.css')) {
      styleName = 'style.css';
    } else if (Object.keys(variables).length === 0) {
      throw new Error('theme.zip needs style.css or manifest.variables');
    }

    return {
      id: id,
      name: manifest.name.trim(),
      description: typeof manifest.description === 'string' ? manifest.description : '',
      version: typeof manifest.version === 'string' ? manifest.version : '1.0.0',
      author: typeof manifest.author === 'string' ? manifest.author : 'community',
      style: styleName,
      variables: variables
    };
  }

  async function extractPackage(buffer, fileName) {
    if (!buffer || buffer.byteLength > MAX_ZIP_BYTES) {
      throw new Error('Theme ZIP is too large (maximum 8 MB)');
    }

    var archive = zip.readEntries(buffer);
    var manifestName = zip.findEntryName(archive, 'manifest.json');
    if (!manifestName) throw new Error('theme.zip must contain manifest.json');

    var rawManifest;
    try {
      rawManifest = JSON.parse(zip.text(await zip.readEntry(archive, manifestName)));
    } catch (error) {
      throw new Error('manifest.json is not valid JSON');
    }

    var manifest = normalizeManifest(rawManifest, archive);
    var css = manifest.style
      ? zip.text(await zip.readEntry(archive, zip.findEntryName(archive, manifest.style)))
      : '';

    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      style: manifest.style,
      variables: manifest.variables,
      css: css,
      fileName: fileName || 'theme.zip',
      source: 'imported'
    };
  }

  function persistPackages() {
    var records = [];
    internal.themes.list().forEach(function (theme) {
      var pkg = packageRecords[theme.id];
      if (!pkg || theme.source !== 'imported') return;
      records.push({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        version: theme.version,
        author: pkg.author,
        style: pkg.style,
        variables: normalizeVariables(pkg.variables),
        css: pkg.css,
        fileName: pkg.fileName,
        source: 'imported'
      });
    });
    internal.storage.updateConfig({ importedThemes: records });
  }

  function registerPackage(pkg, options) {
    options = options || {};
    var source = options.source || pkg.source || 'imported';
    var removable = source === 'imported';
    var theme = {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      version: pkg.version,
      source: source,
      removable: removable,
      variables: normalizeVariables(pkg.variables),
      css: pkg.css
    };

    if (!internal.themes.register(theme)) {
      var existing = internal.themes.get(pkg.id);
      if (!existing) throw new Error('Theme could not be registered');
      if (existing.source === 'built-in') {
        throw new Error('A built-in theme already uses the id "' + pkg.id + '"');
      }
      if (!internal.themes.unregister(pkg.id) || !internal.themes.register(theme)) {
        throw new Error('Theme could not be registered');
      }
    }

    packageRecords[pkg.id] = pkg;

    if (options.enabled && !internal.themes.apply(pkg.id)) {
      throw new Error('Theme could not be applied: ' + pkg.id);
    }
    if (options.persist !== false && source === 'imported') persistPackages();
    if (!options.silent) internal.events.emit('theme:imported', internal.themes.get(pkg.id));
    return internal.themes.get(pkg.id);
  }

  async function importFile(file) {
    if (!file) throw new Error('No theme file selected');
    if (!/\.zip$/i.test(file.name || '')) throw new Error('Choose a theme.zip file');
    if (typeof file.arrayBuffer !== 'function') throw new Error('This browser cannot read theme files');

    var buffer = await file.arrayBuffer();
    var pkg = await extractPackage(buffer, file.name);
    var existing = internal.themes.get(pkg.id);
    if (existing && existing.source === 'built-in') {
      throw new Error('A built-in theme already uses the id "' + pkg.id + '"');
    }
    if (existing) internal.themes.unregister(pkg.id);

    return registerPackage(pkg, { source: 'imported', enabled: true, persist: true });
  }

  function remove(id) {
    var theme = internal.themes.get(id);
    if (!theme || theme.source !== 'imported') return false;
    if (!internal.themes.unregister(id)) return false;
    delete packageRecords[id];
    persistPackages();
    return true;
  }

  function restore() {
    var records = internal.storage.getConfig().importedThemes || [];
    records.forEach(function (pkg) {
      try {
        registerPackage(pkg, { source: 'imported', enabled: false, persist: false, silent: true });
      } catch (error) {
        internal.logger.error('Could not restore imported theme "' + (pkg && pkg.id) + '"', error);
      }
    });
  }

  internal.themeImporter = {
    extractPackage: extractPackage,
    registerPackage: registerPackage,
    importFile: importFile,
    remove: remove,
    restore: restore
  };
})(window.__NodalInternal);
