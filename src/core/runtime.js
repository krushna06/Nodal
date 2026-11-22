(function (internal) {
  'use strict';

  var VERSION = '0.1.0';
  var started = false;

  function installAlias(api) {
    if (window.NodalAPI) return;
    window.NodalAPI = {
      version: api.version,
      plugins: {
        listPlugins: function () { return api.plugins.list(); },
        getPlugin: function (id) { return api.plugins.get(id); },
        getStats: function () { return api.plugins.getStats(); },
        enable: function (id) { return api.plugins.enable(id); },
        disable: function (id) { return api.plugins.disable(id); }
      },
      importer: api.importer,
      themes: api.themes,
      quickCss: api.quickCss,
      storage: { export: function () { return api.storage.export(); } },
      settings: { export: function () { return api.storage.export(); } },
      events: api.events,
      logger: api.logger
    };
  }

  function seed(id) {
    if (internal.storage.get(id + 'Seeded', false)) return;
    var config = internal.storage.getConfig();
    if (config.enabledPlugins.indexOf(id) === -1) {
      config.enabledPlugins.push(id);
      internal.storage.updateConfig(config);
    }
    internal.storage.set(id + 'Seeded', true);
  }

  function start() {
    if (started || (window.Nodal && window.Nodal.initialized)) return window.Nodal;
    started = true;

    var api = {
      version: VERSION,
      initialized: false,
      plugins: internal.plugins,
      importer: internal.pluginImporter,
      themeImporter: internal.themeImporter,
      themes: internal.themes,
      quickCss: internal.quickCss,
      storage: internal.storage,
      events: internal.events,
      logger: internal.logger,
      userPlugins: internal.userPlugins || [],
      ui: null
    };
    window.Nodal = api;

    try {
      internal.logger.info('Nodal ' + VERSION + ' starting');

      var builtInThemes = [
        { id: 'default', name: 'Nodal Dark', description: 'Subtle dark theme that matches the existing Medal interface.' },
        { id: 'violet', name: 'Nodal Violet', description: 'Purple layers, accents, and scrollbars across the whole Medal app.' },
        { id: 'light', name: 'Nodal Light', description: 'Bright surfaces and dark text across the whole Medal app.' },
        { id: 'ocean', name: 'Nodal Ocean', description: 'Deep blue layers with cyan accents.' },
        { id: 'emerald', name: 'Nodal Emerald', description: 'Forest green layers with fresh green accents.' },
        { id: 'rose', name: 'Nodal Rose', description: 'Warm plum layers with rose accents.' },
        { id: 'amber', name: 'Nodal Amber', description: 'Warm dark layers with golden accents.' },
        { id: 'nord', name: 'Nodal Nord', description: 'Cool light layers with blue-gray accents.' }
      ];
      builtInThemes.forEach(function (theme) {
        theme.version = VERSION;
        theme.css = internal.css[theme.id + 'Theme'];
        internal.themes.register(theme);
      });
      internal.themeImporter.restore();

      api.ui = internal.ui.init();

      var config = internal.storage.getConfig();
      if (config.theme) internal.themes.apply(config.theme);
      internal.quickCss.restore();

      internal.janitorPlugin.register();
      internal.adblockerPlugin.register();
      internal.devtoolsPlugin.register();

      internal.pluginImporter.restoreUserPlugins();
      internal.pluginImporter.restore();
      seed('janitor');
      seed('adblocker');
      if (internal.storage.get('devtoolsSeeded', false) && !internal.storage.get('devtoolsUserEnabled', false)) {
        var enabled = internal.storage.getConfig().enabledPlugins;
        var index = enabled.indexOf('devtools');
        if (index !== -1) {
          enabled.splice(index, 1);
          internal.storage.updateConfig({ enabledPlugins: enabled });
        }
      }
      internal.plugins.restore();

      api.initialized = true;
      internal.logger.info('Runtime initialized');
      internal.events.emit('ready', api);
      installAlias(api);
    } catch (error) {
      internal.logger.error('Runtime initialization failed', error);
    }
    return api;
  }

  internal.runtime = { start: start, version: VERSION };
})(window.__NodalInternal);
