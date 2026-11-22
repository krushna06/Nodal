(function (internal) {
  'use strict';

  var STYLE_ID = 'nodal-theme-style';
  var ROOT_ATTR = 'data-nodal-theme';
  var TOKEN_NAMES = [
    '--color-first-layer', '--color-second-layer', '--color-third-layer',
    '--color-foreground-0', '--color-foreground-300', '--color-foreground-500',
    '--color-foreground-700', '--color-stroke-0', '--color-stroke-500',
    '--color-neutral-0', '--color-neutral-1000', '--color-brand-primary-400',
    '--color-brand-primary-500', '--color-accent-primary',
    '--background', '--foreground', '--card', '--popover', '--primary',
    '--secondary', '--muted', '--muted-foreground', '--border', '--input',
    '--ring', '--sidebar', '--sidebar-foreground', '--scrollbar-light-thumb',
    '--nodal-accent', '--nodal-surface', '--nodal-surface-raised', '--nodal-border'
  ];
  var themes = new Map();
  var currentId = null;

  function descriptor(theme) {
    return {
      id: theme.id,
      name: theme.name,
      description: theme.description,
      version: theme.version,
      source: theme.source || 'built-in',
      removable: theme.removable === true
    };
  }

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
      css: theme.css,
      variables: normalizeVariables(theme.variables),
      source: theme.source || 'built-in',
      removable: theme.removable === true
    });
    return true;
  }

  function removeStyle() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (document.documentElement) document.documentElement.removeAttribute(ROOT_ATTR);
  }

  function variablesToCss(theme) {
    var names = Object.keys(theme.variables || {});
    if (names.length === 0) return '';
    var lines = names.map(function (name) {
      return '  ' + name + ': ' + theme.variables[name] + ';';
    });
    return ':root {\n' + lines.join('\n') + '\n}\n';
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
      style.setAttribute(ROOT_ATTR, theme.id);
      style.textContent = variablesToCss(theme) + '\n' + theme.css;
      var head = document.head || document.documentElement;
      head.appendChild(style);
      if (document.documentElement) document.documentElement.setAttribute(ROOT_ATTR, theme.id);
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

  function unregister(id) {
    var theme = themes.get(id);
    if (!theme) return false;
    if (currentId === id) disable();
    themes.delete(id);
    internal.logger.info('Theme removed: ' + id);
    internal.events.emit('theme:removed', descriptor(theme));
    return true;
  }

  function list() {
    var result = [];
    themes.forEach(function (theme) { result.push(descriptor(theme)); });
    return result;
  }

  function get(id) {
    var theme = themes.get(id);
    return theme ? descriptor(theme) : null;
  }

  function current() { return currentId; }

  function tokens() {
    var computed = window.getComputedStyle(document.documentElement);
    var result = Object.create(null);
    TOKEN_NAMES.forEach(function (name) {
      result[name] = computed.getPropertyValue(name).trim();
    });
    return result;
  }

  internal.themes = {
    register: register,
    apply: apply,
    enable: apply,
    disable: disable,
    unregister: unregister,
    list: list,
    get: get,
    current: current,
    tokens: tokens
  };
})(window.__NodalInternal);
