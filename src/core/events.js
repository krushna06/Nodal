(function (internal) {
  'use strict';

  var listeners = Object.create(null);

  function on(name, callback) {
    if (typeof name !== 'string' || typeof callback !== 'function') return function () {};
    if (!listeners[name]) listeners[name] = [];
    listeners[name].push(callback);
    return function () { off(name, callback); };
  }

  function once(name, callback) {
    var unsubscribe = on(name, function () {
      unsubscribe();
      callback.apply(null, arguments);
    });
    return unsubscribe;
  }

  function off(name, callback) {
    var list = listeners[name];
    if (!list) return;
    for (var i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] === callback) list.splice(i, 1);
    }
    if (list.length === 0) delete listeners[name];
  }

  function emit(name) {
    var list = (listeners[name] || []).slice();
    var args = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < list.length; i += 1) {
      try {
        list[i].apply(null, args);
      } catch (error) {
        internal.logger.error('Listener failed for event "' + name + '"', error);
      }
    }
  }

  internal.events = { on: on, once: once, off: off, emit: emit };
})(window.__NodalInternal);
