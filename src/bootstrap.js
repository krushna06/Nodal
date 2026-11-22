(function () {
  'use strict';

  var internal = window.__NodalInternal;

  function boot() {
    try {
      if (!internal || !internal.runtime) {
        if (window.console) console.error('[Nodal] Bootstrap could not find the runtime bundle');
        return;
      }
      internal.runtime.start();
    } catch (error) {
      if (window.console) console.error('[Nodal] Bootstrap failed', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
