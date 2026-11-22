(function (internal) {
  'use strict';

  var STYLE_ID = 'nodal-theme-style';
  var themes = new Map();
  var currentId = null;

  function register(theme) {
    if (!theme || typeof theme.id !== 'string' || typeof theme.css !== 'string') {
      internal.logger.error('Theme registration rejected: id and css are required');
      return false;
    }
    if (themes.has(theme.id)) {
      internal.logger.warn('Theme already registered: ' + theme.id);
      return false;
    }
    themes.set(theme.id, {
      id: theme.id,
      name: theme.name || theme.id,
      description: theme.description || '',
      version: theme.version || '0.0.0',
      css: theme.css
    });
    return true;
  }

  function removeStyle() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function apply(id) {
    var theme = themes.get(id);
    if (!theme) {
      internal.logger.warn('Cannot apply unknown theme: ' + id);
      return false;
    }
    removeStyle();
    try {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-nodal-theme', theme.id);
      style.textContent = theme.css;
      var head = document.head || document.documentElement;
      head.appendChild(style);
      currentId = theme.id;
      internal.storage.updateConfig({ theme: theme.id });
      internal.logger.info('Theme applied: ' + theme.id);
      internal.events.emit('theme:changed', theme.id);
      return true;
    } catch (error) {
      currentId = null;
      internal.logger.error('Theme application failed: ' + id, error);
      return false;
    }
  }

  function disable() {
    removeStyle();
    currentId = null;
    internal.storage.updateConfig({ theme: null });
    internal.logger.info('Theme disabled');
    internal.events.emit('theme:changed', null);
    return true;
  }

  function list() {
    var result = [];
    themes.forEach(function (theme) {
      result.push({
        id: theme.id,
        name: theme.name,
        description: theme.description,
        version: theme.version
      });
    });
    return result;
  }

  function current() { return currentId; }

  internal.themes = {
    register: register,
    apply: apply,
    enable: apply,
    disable: disable,
    list: list,
    current: current
  };
})(window.__NodalInternal);
