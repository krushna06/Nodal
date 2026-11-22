(function (internal) {
  'use strict';

  internal.examplePlugin = {
    register: function () {
      return internal.plugins.register({
        id: 'hello-world',
        name: 'Hello World',
        description: 'Built-in test plugin that confirms plugin start and stop hooks run.',
        version: '0.1.0',
        author: 'Nodal',
        start: function () {
          internal.logger.info('[hello-world] Plugin started');
          internal.ui.notify('Hello World plugin enabled', 'success');
        },
        stop: function () {
          internal.logger.info('[hello-world] Plugin stopped');
          internal.ui.notify('Hello World plugin disabled', 'info');
        }
      });
    }
  };
})(window.__NodalInternal);
