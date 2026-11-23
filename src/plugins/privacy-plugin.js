(function (internal) {
  'use strict';

  var BLOCKED_HOSTS = [
    /(^|\.)amplitude\.com$/i,
    /(^|\.)sentry\.medal\.tv$/i,
    /(^|\.)sentry\.io$/i,
    /(^|\.)honeycomb\.io$/i,
    /(^|\.)mixpanel\.com$/i,
    /(^|\.)segment\.io$/i,
    /(^|\.)segment\.com$/i,
    /(^|\.)posthog\.com$/i,
    /(^|\.)fullstory\.com$/i,
    /(^|\.)hotjar\.com$/i,
    /(^|\.)bugsnag\.com$/i,
    /(^|\.)datadoghq\.com$/i,
    /(^|\.)newrelic\.com$/i
  ];

  var HOSTILE_URL_PARTS = [
    /sentry\.medal\.tv/i,
    /ingest\.sentry\.io/i,
    /api-sr\.(eu\.|stag2\.)?amplitude\.com/i,
    /api2?\.(eu\.)?amplitude\.com/i,
    /diagnostics\.prod\.[a-z0-9-]+\.amplitude\.com/i,
    /sr-client-cfg\.(eu\.)?amplitude\.com/i
  ];

  var patched = false;
  var observer = null;
  var originalFetch = null;
  var originalOpen = null;
  var originalSend = null;
  var originalBeacon = null;
  var originalSetAttribute = null;
  var blocked = [];

  function hostnameOf(url) {
    try {
      return new URL(String(url), window.location.href).hostname;
    } catch (error) {
      return '';
    }
  }

  function blockReason(url) {
    var text = String(url || '');
    for (var i = 0; i < HOSTILE_URL_PARTS.length; i += 1) {
      if (HOSTILE_URL_PARTS[i].test(text)) return HOSTILE_URL_PARTS[i].source;
    }
    var host = hostnameOf(text);
    if (host) {
      for (var j = 0; j < BLOCKED_HOSTS.length; j += 1) {
        if (BLOCKED_HOSTS[j].test(host)) return host;
      }
    }
    return null;
  }

  function record(url, kind) {
    var reason = blockReason(url);
    if (!reason) return null;
    if (blocked.length < 100) {
      blocked.push({ kind: kind, url: String(url).slice(0, 200), reason: reason });
    }
    return reason;
  }

  function fakeResponse() {
    try {
      if (typeof Response === 'function') {
        return new Response('{"code":200}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    } catch (error) {
    }
    return new Promise(function () {});
  }

  function patchedFetch(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (record(url, 'fetch')) return Promise.resolve(fakeResponse());
    return originalFetch.apply(this, arguments);
  }

  function patchedOpen(method, url) {
    if (record(url, 'xhr')) {
      this.__nodalPrivacyBlocked = true;
      return originalOpen.apply(this, [method, 'data:text/plain,']);
    }
    this.__nodalPrivacyBlocked = false;
    return originalOpen.apply(this, arguments);
  }

  function patchedSend() {
    return originalSend.apply(this, arguments);
  }

  function patchedSendBeacon(url) {
    if (record(url, 'beacon')) return true;
    return originalBeacon.apply(this, arguments);
  }

  function patchedSetAttribute(name, value) {
    var lower = String(name).toLowerCase();
    if ((lower === 'src' || lower === 'href') && this.nodeType === 1) {
      if (record(value, lower)) return this;
    }
    return originalSetAttribute.apply(this, arguments);
  }

  function scanResourceAttributes() {
    var nodes = document.querySelectorAll('img[src],iframe[src],script[src],source[src],webview[src],link[href]');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var url = node.getAttribute('src') || node.getAttribute('href') || '';
      if (record(url, 'element') && node.hasAttribute('data-nodal-privacy-src') === false) {
        internal.storage.set('privacyBlockedResources', blocked.length);
        node.setAttribute('data-nodal-privacy-src', '');
        node.setAttribute('src', 'data:text/plain,');
      }
    }
  }

  function patch() {
    if (patched) return;
    try {
      if (typeof window.fetch === 'function') {
        originalFetch = window.fetch;
        window.fetch = patchedFetch;
      }
      if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
        originalOpen = window.XMLHttpRequest.prototype.open;
        originalSend = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.open = patchedOpen;
        window.XMLHttpRequest.prototype.send = patchedSend;
      }
      if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
        originalBeacon = window.navigator.sendBeacon;
        window.navigator.sendBeacon = patchedSendBeacon;
      }
      originalSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = patchedSetAttribute;
      patched = true;
    } catch (error) {
      internal.logger.warn('[privacy] Could not install network guards', error);
    }
  }

  function unpatch() {
    if (!patched) return;
    try {
      if (originalFetch) window.fetch = originalFetch;
      if (originalOpen) window.XMLHttpRequest.prototype.open = originalOpen;
      if (originalSend) window.XMLHttpRequest.prototype.send = originalSend;
      if (originalBeacon) window.navigator.sendBeacon = originalBeacon;
      if (originalSetAttribute) Element.prototype.setAttribute = originalSetAttribute;
      patched = false;
    } catch (error) {
      internal.logger.warn('[privacy] Could not restore network methods', error);
    }
  }

  function start() {
    blocked = [];
    patch();
    scanResourceAttributes();
    if (window.MutationObserver) {
      observer = new MutationObserver(scanResourceAttributes);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'href']
      });
    }
    internal.logger.info('[privacy] Telemetry, analytics, session replay and crash reporting blocked');
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    unpatch();
    var nodes = document.querySelectorAll('[data-nodal-privacy-src]');
    for (var i = 0; i < nodes.length; i += 1) nodes[i].removeAttribute('data-nodal-privacy-src');
    internal.logger.info('[privacy] Network guards removed');
  }

  internal.privacyPlugin = {
    register: function () {
      return internal.plugins.register({
        id: 'privacy',
        name: 'Privacy Guard',
        description: 'No telemetry. Analytics, session replay and crash reporting are blocked.',
        version: '0.1.0',
        author: 'Nodal',
        start: start,
        stop: stop
      });
    },
    stats: function () {
      return { blocked: blocked.length, recent: blocked.slice(-8) };
    }
  };
})(window.__NodalInternal);
