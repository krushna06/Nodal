(function (internal) {
  'use strict';

  var PREFIX = '[Nodal]';
  var MAX_ENTRIES = 250;
  var entries = [];

  function format(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message || String(value);
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }

  function record(level, args) {
    var parts = [];
    for (var i = 0; i < args.length; i += 1) parts.push(format(args[i]));
    var message = PREFIX + ' ' + parts.join(' ');
    entries.push({ level: level, message: message, time: new Date().toISOString() });
    if (entries.length > MAX_ENTRIES) entries.shift();
    return message;
  }

  function write(level, args) {
    var message = record(level, args);
    try {
      var method = console[level] || console.log;
      method.call(console, message);
    } catch (error) {
      /* Logging must never throw into the host renderer. */
    }
  }

  internal.logger = {
    info: function () { write('info', Array.prototype.slice.call(arguments)); },
    warn: function () { write('warn', Array.prototype.slice.call(arguments)); },
    error: function () { write('error', Array.prototype.slice.call(arguments)); },
    debug: function () { write('debug', Array.prototype.slice.call(arguments)); },
    entries: function () { return entries.slice(); },
    clear: function () { entries.length = 0; }
  };
})(window.__NodalInternal);
