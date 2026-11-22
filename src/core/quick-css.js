(function (internal) {
  'use strict';

  var STYLE_ID = 'nodal-quick-css-style';

  function get() {
    var config = internal.storage.getConfig();
    return typeof config.quickCss === 'string' ? config.quickCss : '';
  }

  function enabled() {
    var config = internal.storage.getConfig();
    return config.quickCssEnabled !== false && get().trim() !== '';
  }

  function removeStyle() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function ensureStyle() {
    var style = document.getElementById(STYLE_ID);
    if (style) return style;
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-nodal-quick-css', '');
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function apply(css) {
    var text = typeof css === 'string' ? css : get();
    if (!text.trim()) return clear();

    try {
      ensureStyle().textContent = text;
      internal.storage.updateConfig({ quickCss: text, quickCssEnabled: true });
      internal.logger.info('Quick CSS applied');
      internal.events.emit('quickcss:changed', text);
      return true;
    } catch (error) {
      internal.logger.error('Quick CSS application failed', error);
      return false;
    }
  }

  function clear() {
    removeStyle();
    internal.storage.updateConfig({ quickCss: '', quickCssEnabled: false });
    internal.logger.info('Quick CSS cleared');
    internal.events.emit('quickcss:changed', '');
    return true;
  }

  function restore() {
    if (!enabled()) {
      removeStyle();
      return false;
    }
    try {
      ensureStyle().textContent = get();
      return true;
    } catch (error) {
      internal.logger.error('Quick CSS restore failed', error);
      return false;
    }
  }

  internal.quickCss = {
    apply: apply,
    set: apply,
    clear: clear,
    get: get,
    enabled: enabled,
    restore: restore
  };
})(window.__NodalInternal);
