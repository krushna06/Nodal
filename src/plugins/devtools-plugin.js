(function (internal) {
  'use strict';

  var listenerInstalled = false;

  function toggleDevTools() {
    try {
      if (window.MedalIPC && window.MedalIPC.debug && typeof window.MedalIPC.debug.toggleDevTools === 'function') {
        window.MedalIPC.debug.toggleDevTools();
        return true;
      }
      if (window.MedalIPC && window.MedalIPC.appWindow && typeof window.MedalIPC.appWindow.openDevTools === 'function') {
        window.MedalIPC.appWindow.openDevTools({ mode: 'detach' });
        return true;
      }
    } catch (error) {
      internal.logger.warn('[devtools] Could not toggle developer tools', error);
    }
    return false;
  }

  function onKeyDown(event) {
    if (event.altKey) return;
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    var isI = (event.code === 'KeyI') || ((event.key || '').toLowerCase() === 'i');
    if (!isI) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    toggleDevTools();
  }

  function installListener() {
    if (listenerInstalled) return;
    window.addEventListener('keydown', onKeyDown, true);
    listenerInstalled = true;
  }

  function removeListener() {
    if (!listenerInstalled) return;
    window.removeEventListener('keydown', onKeyDown, true);
    listenerInstalled = false;
  }

  internal.devtoolsPlugin = {
    register: function () {
      return internal.plugins.register({
        id: 'devtools',
        name: 'DevTools Shortcut',
        description: 'Enables Ctrl+Shift+I to toggle Medal\'s built-in developer tools.',
        version: '0.1.0',
        author: 'Nodal',
        start: function () {
          installListener();
          internal.logger.info('[devtools] Ctrl+Shift+I enabled');
        },
        stop: function () {
          removeListener();
          internal.logger.info('[devtools] Ctrl+Shift+I disabled');
        }
      });
    }
  };
})(window.__NodalInternal);
