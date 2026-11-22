(function (internal) {
  'use strict';

  var plugins = new Map();

  function descriptor(record) {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      version: record.version,
      author: record.author,
      source: record.source,
      removable: record.removable,
      enabled: record.enabled,
      running: record.running,
      error: record.error
    };
  }

  function persist() {
    var enabled = [];
    plugins.forEach(function (record) {
      if (record.enabled && !record.error) enabled.push(record.id);
    });
    internal.storage.updateConfig({ enabledPlugins: enabled });
  }

  function styleId(id) {
    return 'nodal-plugin-style-' + id;
  }

  function ensureStyle(record) {
    if (!record.css) return;
    var existing = document.getElementById(styleId(record.id));
    if (existing) return;
    try {
      var style = document.createElement('style');
      style.id = styleId(record.id);
      style.setAttribute('data-nodal-plugin-style', record.id);
      style.textContent = record.css;
      (document.head || document.documentElement).appendChild(style);
    } catch (error) {
      internal.logger.warn('Plugin stylesheet injection failed for "' + record.id + '"', error);
    }
  }

  function removeStyle(record) {
    var existing = document.getElementById(styleId(record.id));
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function register(plugin) {
    if (!plugin || typeof plugin.id !== 'string' || !plugin.id || typeof plugin.name !== 'string') {
      internal.logger.error('Plugin registration rejected: id and name are required');
      return false;
    }
    if (typeof plugin.start !== 'function') {
      internal.logger.error('Plugin registration rejected for "' + plugin.id + '": start() is required');
      return false;
    }
    if (plugins.has(plugin.id)) {
      internal.logger.warn('Plugin already registered: ' + plugin.id);
      return false;
    }

    var record = {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description || '',
      version: plugin.version || '0.0.0',
      author: plugin.author || 'unknown',
      source: plugin.source || 'built-in',
      removable: plugin.removable === true,
      css: plugin.css || '',
      enabled: false,
      running: false,
      error: null,
      start: plugin.start,
      stop: plugin.stop
    };
    plugins.set(record.id, record);
    internal.logger.info('Plugin registered: ' + record.name + ' (' + record.id + ')');
    internal.events.emit('plugin:registered', descriptor(record));
    return true;
  }

  function decorate(id, patch) {
    var record = plugins.get(id);
    if (!record || !patch || typeof patch !== 'object') return false;
    ['name', 'description', 'version', 'author', 'source', 'removable', 'css'].forEach(function (key) {
      if (patch[key] !== undefined) record[key] = patch[key];
    });
    internal.events.emit('plugin:updated', descriptor(record));
    return true;
  }

  function enable(id) {
    var record = plugins.get(id);
    if (!record) {
      internal.logger.warn('Cannot enable unknown plugin: ' + id);
      return false;
    }
    if (record.running) return true;

    try {
      var result = record.start();
      if (result && typeof result.then === 'function') {
        result.catch(function (error) {
          record.error = String((error && error.message) || error);
          internal.logger.error('Async plugin start failed: ' + id, error);
        });
      }
      record.running = true;
      record.enabled = true;
      record.error = null;
      ensureStyle(record);
      persist();
      internal.logger.info('Plugin enabled: ' + id);
      internal.events.emit('plugin:enabled', descriptor(record));
      return true;
    } catch (error) {
      record.running = false;
      record.enabled = false;
      record.error = String((error && error.message) || error);
      persist();
      internal.logger.error('Plugin start failed: ' + id, error);
      internal.events.emit('plugin:error', descriptor(record));
      return false;
    }
  }

  function disable(id) {
    var record = plugins.get(id);
    if (!record) {
      internal.logger.warn('Cannot disable unknown plugin: ' + id);
      return false;
    }

    if (record.running && typeof record.stop === 'function') {
      try {
        record.stop();
      } catch (error) {
        internal.logger.error('Plugin stop failed: ' + id, error);
      }
    }
    record.running = false;
    record.enabled = false;
    record.error = null;
    removeStyle(record);
    persist();
    internal.logger.info('Plugin disabled: ' + id);
    internal.events.emit('plugin:disabled', descriptor(record));
    return true;
  }

  function unregister(id) {
    var record = plugins.get(id);
    if (!record) return false;
    if (record.running && typeof record.stop === 'function') {
      try {
        record.stop();
      } catch (error) {
        internal.logger.error('Plugin stop failed during removal: ' + id, error);
      }
    }
    removeStyle(record);
    plugins.delete(id);
    persist();
    internal.logger.info('Plugin removed: ' + id);
    internal.events.emit('plugin:removed', descriptor(record));
    return true;
  }

  function get(id) {
    var record = plugins.get(id);
    return record ? descriptor(record) : null;
  }

  function list() {
    var result = [];
    plugins.forEach(function (record) { result.push(descriptor(record)); });
    return result;
  }

  function ids() {
    var result = [];
    plugins.forEach(function (record) { result.push(record.id); });
    return result;
  }

  function getStats() {
    var stats = { total: 0, enabled: 0, disabled: 0, failed: 0 };
    plugins.forEach(function (record) {
      stats.total += 1;
      if (record.error) stats.failed += 1;
      if (record.enabled) stats.enabled += 1;
      else stats.disabled += 1;
    });
    return stats;
  }

  function restore() {
    var enabled = internal.storage.getConfig().enabledPlugins || [];
    enabled.forEach(function (id) {
      if (plugins.has(id)) enable(id);
    });
  }

  internal.plugins = {
    register: register,
    decorate: decorate,
    enable: enable,
    disable: disable,
    unregister: unregister,
    get: get,
    list: list,
    ids: ids,
    getStats: getStats,
    restore: restore
  };
})(window.__NodalInternal);
