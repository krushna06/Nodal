(function (internal) {
  'use strict';

  var CONFIG_KEY = 'importedPlugins';
  var MAX_ZIP_BYTES = 8 * 1024 * 1024;
  var packageRecords = Object.create(null);
  var zip = internal.zip;

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

    var entryName = zip.safePath(manifest.entry || manifest.main || manifest.script || 'index.js');
    if (!entryName || !zip.findEntryName(archive, entryName)) {
      throw new Error('Plugin entry file not found: ' + (entryName || 'index.js'));
    }

    var styleName = null;
    if (manifest.style) {
      styleName = zip.safePath(manifest.style);
      if (!styleName || !zip.findEntryName(archive, styleName)) {
        throw new Error('Plugin stylesheet not found: ' + manifest.style);
      }
    } else if (zip.findEntryName(archive, 'style.css')) {
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

    var archive = zip.readEntries(buffer);
    var manifestName = zip.findEntryName(archive, 'manifest.json');
    if (!manifestName) throw new Error('plugin.zip must contain manifest.json');

    var rawManifest;
    try {
      rawManifest = JSON.parse(zip.text(await zip.readEntry(archive, manifestName)));
    } catch (error) {
      throw new Error('manifest.json is not valid JSON');
    }

    var manifest = normalizeManifest(rawManifest, archive);
    var entryName = zip.findEntryName(archive, manifest.entry);
    var scriptBytes = await zip.readEntry(archive, entryName);
    var css = '';
    if (manifest.style) {
      css = zip.text(await zip.readEntry(archive, zip.findEntryName(archive, manifest.style)));
    }

    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      entry: manifest.entry,
      style: manifest.style,
      script: zip.text(scriptBytes),
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
