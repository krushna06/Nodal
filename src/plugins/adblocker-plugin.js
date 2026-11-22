(function (internal) {
  'use strict';

  var STYLE_ID = 'nodal-adblocker-styles';
  var BLOCK_ATTR = 'data-nodal-adblocked';
  var SRC_ATTR = 'data-nodal-ad-src';
  var AD_TESTID = 'ad-card';
  var AD_PRELOAD = 'ad-webview-preload';

  var observer = null;
  var patched = false;
  var originalSetAttribute = null;
  var originalAppendChild = null;
  var originalInsertBefore = null;
  var originalReplaceChild = null;

  var CSS = '[data-testid="' + AD_TESTID + '"],webview[preload*="' + AD_PRELOAD + '"],[' + BLOCK_ATTR + '] { display: none !important; }';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    try {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    } catch (error) {
      internal.logger.warn('[adblocker] Could not install blocking style', error);
    }
  }

  function removeStyle() {
    var style = document.getElementById(STYLE_ID);
    if (style && style.parentNode) style.parentNode.removeChild(style);
  }

  function isAdCard(node) {
    return node && node.nodeType === 1 && node.getAttribute &&
      node.getAttribute('data-testid') === AD_TESTID;
  }

  function isAdWebview(node) {
    return node && node.nodeType === 1 && node.tagName === 'WEBVIEW' &&
      /ad-webview-preload/i.test(node.getAttribute('preload') || '');
  }

  function setAttributeDirectly(node, name, value) {
    if (originalSetAttribute) originalSetAttribute.call(node, name, value);
    else node.setAttribute(name, value);
  }

  function blankAdWebview(node) {
    var src = node.getAttribute('src');
    if (src && src !== 'about:blank') {
      if (!node.hasAttribute(SRC_ATTR)) setAttributeDirectly(node, SRC_ATTR, src);
      setAttributeDirectly(node, 'src', 'about:blank');
    }
  }

  function block(node) {
    if (!node || node.nodeType !== 1 || !node.setAttribute) return false;
    var changed = false;

    if (isAdCard(node) && !node.hasAttribute(BLOCK_ATTR)) {
      node.setAttribute(BLOCK_ATTR, '');
      changed = true;
    }
    if (isAdWebview(node)) {
      blankAdWebview(node);
      if (!node.hasAttribute(BLOCK_ATTR)) {
        node.setAttribute(BLOCK_ATTR, '');
        changed = true;
      }
    }
    return changed;
  }

  function blockTree(root) {
    if (!root || (root.nodeType !== 1 && root.nodeType !== 11)) return false;
    var changed = root.nodeType === 1 ? block(root) : false;
    if (root.querySelectorAll) {
      var selectors = '[data-testid="' + AD_TESTID + '"],webview[preload*="' + AD_PRELOAD + '"]';
      var nodes = root.querySelectorAll(selectors);
      for (var i = 0; i < nodes.length; i += 1) {
        if (block(nodes[i])) changed = true;
      }
    }
    return changed;
  }

  function scan() {
    return blockTree(document.documentElement);
  }

  function patchedSetAttribute(name, value) {
    var result = originalSetAttribute.apply(this, arguments);
    if (this.nodeType === 1 && this.tagName === 'WEBVIEW') {
      var preload = this.getAttribute('preload') || '';
      if (/ad-webview-preload/i.test(preload)) {
        blankAdWebview(this);
      }
    }
    return result;
  }

  function sanitizedInsert(method, original) {
    return function (node) {
      if (node && node.ownerDocument === document) blockTree(node);
      return original.apply(this, arguments);
    };
  }

  function patchDom() {
    if (patched) return;
    try {
      originalSetAttribute = Element.prototype.setAttribute;
      originalAppendChild = Node.prototype.appendChild;
      originalInsertBefore = Node.prototype.insertBefore;
      originalReplaceChild = Node.prototype.replaceChild;

      Element.prototype.setAttribute = patchedSetAttribute;
      Node.prototype.appendChild = sanitizedInsert('appendChild', originalAppendChild);
      Node.prototype.insertBefore = function (node, reference) {
        if (node && node.ownerDocument === document) blockTree(node);
        return originalInsertBefore.call(this, node, reference);
      };
      Node.prototype.replaceChild = function (node, oldChild) {
        if (node && node.ownerDocument === document) blockTree(node);
        return originalReplaceChild.call(this, node, oldChild);
      };
      patched = true;
    } catch (error) {
      internal.logger.warn('[adblocker] DOM interception unavailable', error);
    }
  }

  function unpatchDom() {
    if (!patched) return;
    try {
      Element.prototype.setAttribute = originalSetAttribute;
      Node.prototype.appendChild = originalAppendChild;
      Node.prototype.insertBefore = originalInsertBefore;
      Node.prototype.replaceChild = originalReplaceChild;
      patched = false;
    } catch (error) {
      internal.logger.warn('[adblocker] Could not restore DOM methods', error);
    }
  }

  function restoreBlockedNodes() {
    var nodes = document.querySelectorAll('[' + SRC_ATTR + '],[' + BLOCK_ATTR + ']');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.hasAttribute(SRC_ATTR)) {
        node.setAttribute('src', node.getAttribute(SRC_ATTR));
        node.removeAttribute(SRC_ATTR);
      }
      node.removeAttribute(BLOCK_ATTR);
    }
  }

  internal.adblockerPlugin = {
    register: function () {
      return internal.plugins.register({
        id: 'adblocker',
        name: 'AdBlocker',
        description: 'Removes all in-app ads and prevents ad webviews from loading.',
        version: '0.1.0',
        author: 'Nodal',
        start: function () {
          internal.logger.info('[adblocker] Plugin started');
          ensureStyle();
          patchDom();
          if (scan()) internal.logger.info('[adblocker] Blocked existing ad content');
          if (window.MutationObserver) {
            observer = new MutationObserver(scan);
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'preload', 'data-testid'] });
          }
        },
        stop: function () {
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          unpatchDom();
          restoreBlockedNodes();
          removeStyle();
          internal.logger.info('[adblocker] Plugin stopped');
        }
      });
    }
  };
})(window.__NodalInternal);
