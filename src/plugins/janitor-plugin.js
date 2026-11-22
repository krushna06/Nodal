(function (internal) {
  'use strict';

  var STYLE_ID = 'nodal-janitor-styles';
  var BLOCK_ATTR = 'data-nodal-janitor-blocked';
  var observer = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    try {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = '[' + BLOCK_ATTR + '] { display: none !important; }';
      (document.head || document.documentElement).appendChild(style);
    } catch (error) {
      internal.logger.warn('[janitor] Could not install blocking style', error);
    }
  }

  function removeStyle() {
    var style = document.getElementById(STYLE_ID);
    if (style && style.parentNode) style.parentNode.removeChild(style);
  }

  function findPopups() {
    var nodes = document.querySelectorAll('[data-slot="dialog-portal"], [data-slot="dialog-content"][data-open]');
    var matches = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var text = nodes[i].textContent || '';
      if (text.indexOf('Do you know') !== -1 || text.indexOf('Suggested users') !== -1) {
        matches.push(nodes[i]);
      }
    }
    return matches;
  }

  function block(node) {
    if (!node || node.hasAttribute(BLOCK_ATTR)) return false;
    node.setAttribute(BLOCK_ATTR, '');

    var button = node.querySelector('[data-testid="close-button"]');
    if (button) {
      try {
        button.click();
      } catch (error) {
        internal.logger.debug('[janitor] Close button was unavailable', error);
      }
    }
    internal.logger.info('[janitor] Blocked the "Do you know" popup before display');
    return true;
  }

  function scan() {
    findPopups().forEach(block);
  }

  internal.janitorPlugin = {
    register: function () {
      return internal.plugins.register({
        id: 'janitor',
        name: 'Janitor',
        description: 'Prevents the "Do you know" suggested-users popup from ever being displayed.',
        version: '0.1.0',
        author: 'Nodal',
        start: function () {
          internal.logger.info('[janitor] Plugin started');
          ensureStyle();
          scan();
          if (window.MutationObserver) {
            observer = new MutationObserver(scan);
            observer.observe(document.documentElement, { childList: true, subtree: true });
          }
        },
        stop: function () {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          removeStyle();
          internal.logger.info('[janitor] Plugin stopped');
        }
      });
    }
  };
})(window.__NodalInternal);
