(function () {
  'use strict';

  var context = window.NodalPluginContext;
  var activeClass = 'nodal-example-plugin-active';

  window.NodalPlugin = {
    start: function () {
      document.documentElement.classList.add(activeClass);
      if (context && context.notify) context.notify('Example Plugin enabled');
    },
    stop: function () {
      document.documentElement.classList.remove(activeClass);
      if (context && context.notify) context.notify('Example Plugin disabled');
    }
  };
})();
