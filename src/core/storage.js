(function (internal) {
  'use strict';

  var PREFIX = 'nodal:';
  var CONFIG_KEY = 'config';
  var memory = Object.create(null);
  var backend = 'memory';

  var DEFAULT_CONFIG = {
    version: '0.1.0',
    enabledPlugins: [],
    importedPlugins: [],
    importedThemes: [],
    theme: 'default',
    quickCss: '',
    quickCssEnabled: false,
    managerOpen: true,
    preferences: {}
  };

  try {
    if (window.localStorage) {
      window.localStorage.setItem(PREFIX + '__probe__', '1');
      window.localStorage.removeItem(PREFIX + '__probe__');
      backend = 'localStorage';
    }
  } catch (error) {
    backend = 'memory';
  }

  function get(key, fallback) {
    try {
      var raw = backend === 'localStorage'
        ? window.localStorage.getItem(PREFIX + key)
        : memory[key];
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      internal.logger.warn('Storage read failed for "' + key + '"', error);
      return fallback;
    }
  }

  function set(key, value) {
    try {
      var raw = JSON.stringify(value);
      if (backend === 'localStorage') window.localStorage.setItem(PREFIX + key, raw);
      else memory[key] = raw;
      return true;
    } catch (error) {
      internal.logger.warn('Storage write failed for "' + key + '"', error);
      return false;
    }
  }

  function remove(key) {
    try {
      if (backend === 'localStorage') window.localStorage.removeItem(PREFIX + key);
      else delete memory[key];
      return true;
    } catch (error) {
      internal.logger.warn('Storage removal failed for "' + key + '"', error);
      return false;
    }
  }

  function keys() {
    var result = [];
    try {
      if (backend === 'localStorage') {
        for (var i = 0; i < window.localStorage.length; i += 1) {
          var name = window.localStorage.key(i);
          if (name && name.indexOf(PREFIX) === 0) result.push(name.slice(PREFIX.length));
        }
      } else {
        result = Object.keys(memory);
      }
    } catch (error) {
      internal.logger.warn('Storage key enumeration failed', error);
    }
    return result;
  }

  function exportAll() {
    var result = {};
    keys().forEach(function (key) { result[key] = get(key, null); });
    return result;
  }

  function importAll(values) {
    if (!values || typeof values !== 'object') return false;
    Object.keys(values).forEach(function (key) { set(key, values[key]); });
    return true;
  }

  function getConfig() {
    var stored = get(CONFIG_KEY, null);
    if (!stored || typeof stored !== 'object') stored = {};
    var config = {};
    Object.keys(DEFAULT_CONFIG).forEach(function (key) {
      config[key] = stored[key] === undefined ? DEFAULT_CONFIG[key] : stored[key];
    });
    if (!Array.isArray(config.enabledPlugins)) config.enabledPlugins = [];
    if (!Array.isArray(config.importedPlugins)) config.importedPlugins = [];
    if (!Array.isArray(config.importedThemes)) config.importedThemes = [];
    if (!config.preferences || typeof config.preferences !== 'object') config.preferences = {};
    return config;
  }

  function updateConfig(patch) {
    if (!patch || typeof patch !== 'object') return getConfig();
    var config = getConfig();
    Object.keys(patch).forEach(function (key) { config[key] = patch[key]; });
    set(CONFIG_KEY, config);
    internal.events.emit('config:changed', config);
    return config;
  }

  internal.storage = {
    backend: backend,
    get: get,
    set: set,
    remove: remove,
    keys: keys,
    export: exportAll,
    import: importAll,
    getConfig: getConfig,
    updateConfig: updateConfig
  };
})(window.__NodalInternal);
