(function (internal) {
  'use strict';

  var PAGE_SELECTOR = '[data-testid="settings-page-container"]';
  var GROUP_ID = 'nodal-settings-group';
  var VIEW_ID = 'nodal-settings-view';
  var STYLE_ID = 'nodal-manager-styles';

  var BASE_ITEM = 'flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-1.5 text-base font-medium aria-disabled:pointer-events-none aria-disabled:opacity-50';
  var ACTIVE_ITEM = ['bg-neutral-0/16', 'text-foreground-0'];
  var INACTIVE_ITEM = ['text-foreground-300', 'hover:bg-neutral-0/4', 'hover:text-foreground-0'];

  var page = null;
  var sidebar = null;
  var content = null;
  var viewElement = null;
  var currentView = null;
  var previousActiveItem = null;
  var previousActiveClasses = null;
  var observer = null;
  var syncTimer = null;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function applyItemState(node, active) {
    ACTIVE_ITEM.forEach(function (token) { node.classList.remove(token); });
    INACTIVE_ITEM.forEach(function (token) { node.classList.remove(token); });
    (active ? ACTIVE_ITEM : INACTIVE_ITEM).forEach(function (token) { node.classList.add(token); });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    try {
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = internal.css.manager || '';
      (document.head || document.documentElement).appendChild(style);
    } catch (error) {
      internal.logger.error('Settings stylesheet injection failed', error);
    }
  }

  function createGroup() {
    var group = element('div', 'nodal-settings-group flex flex-col gap-0.5');
    group.id = GROUP_ID;
    group.appendChild(element('span', 'p-2 text-xs font-bold tracking-wider text-foreground-500 uppercase', 'Nodal'));

    var views = [
      { id: 'plugins', label: 'Plugins' },
      { id: 'themes', label: 'Themes' },
      { id: 'quick-css', label: 'Quick CSS' },
      { id: 'about', label: 'About' }
    ];
    views.forEach(function (view) {
      var item = element('div', BASE_ITEM, view.label);
      item.setAttribute('data-nodal-view', view.id);
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      applyItemState(item, false);
      group.appendChild(item);
    });
    return group;
  }

  function ensureGroup() {
    if (!sidebar) return;
    var existing = document.getElementById(GROUP_ID);
    if (existing && existing.parentNode === sidebar) return;
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var group = createGroup();
    var languageRow = Array.prototype.find.call(sidebar.children, function (child) {
      return child.className && child.className.indexOf('border-t') !== -1;
    });
    if (languageRow) sidebar.insertBefore(group, languageRow);
    else sidebar.appendChild(group);
  }

  function viewHeader(title, subtitle) {
    var header = element('div', 'flex max-w-sm flex-col items-center gap-2 p-5 text-center');
    header.appendChild(element('div', 'text-xl font-bold text-foreground-0', title));
    header.appendChild(element('div', 'text-sm text-foreground-300', subtitle));
    return header;
  }

  function card() {
    return element('div', 'flex w-full flex-col gap-4 rounded-lg bg-second-layer p-5');
  }

  function actionButton(label, primary, dataAction) {
    var classes = 'relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap select-none rounded-md border px-3 py-1.5 text-sm font-medium outline-none ';
    classes += primary
      ? 'border-stroke-0/16 bg-neutral-0/16 text-foreground-0 hover:bg-neutral-0/24'
      : 'border-stroke-0/16 bg-transparent text-foreground-0 hover:bg-neutral-0/16';
    var button = element('button', classes, label);
    button.type = 'button';
    button.setAttribute('data-slot', 'button');
    if (dataAction) button.setAttribute('data-nodal-action', dataAction);
    return button;
  }

  function statusLine() {
    var line = element('div', 'nodal-status-line min-h-5 text-sm text-foreground-300');
    line.id = 'nodal-settings-status';
    return line;
  }

  async function importPluginFile(file, host) {
    if (!file) return;
    notify('Importing ' + file.name + '…');
    try {
      var plugin = await internal.pluginImporter.importFile(file);
      notify(plugin.name + ' installed and enabled');
      renderPlugins(host);
    } catch (error) {
      notify('Import failed: ' + ((error && error.message) || error));
    }
  }

  function renderImporter(host) {
    var box = card();
    box.id = 'nodal-plugin-importer';
    box.appendChild(element('div', 'text-base font-bold text-foreground-0', 'Import a plugin'));
    box.appendChild(element('div', 'text-sm text-foreground-300', 'Drop a community plugin.zip here, or choose one from your PC. Plugins are enabled immediately and saved locally.'));

    var drop = element('div', 'nodal-plugin-drop flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-stroke-0/24 px-4 py-6 text-center', 'Drop plugin.zip here, or click to browse');
    drop.id = 'nodal-plugin-drop';
    drop.setAttribute('data-nodal-action', 'plugin-drop-zone');

    var input = document.createElement('input');
    input.type = 'file';
    input.id = 'nodal-plugin-file-input';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';

    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('dragover', function (event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      drop.setAttribute('data-dragging', 'true');
    });
    drop.addEventListener('dragleave', function () { drop.removeAttribute('data-dragging'); });
    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      event.stopPropagation();
      drop.removeAttribute('data-dragging');
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      importPluginFile(file, host);
    });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      importPluginFile(file, host);
    });

    box.appendChild(drop);
    box.appendChild(input);

    var choose = actionButton('Choose plugin.zip', false, 'choose-plugin');
    choose.addEventListener('click', function () { input.click(); });
    box.appendChild(choose);

    host.appendChild(box);
  }

  function renderPlugins(host) {
    host.textContent = '';
    host.appendChild(viewHeader('Plugins', 'Manage Nodal plugins and import community plugins.'));

    var box = card();
    var plugins = internal.plugins.list();
    if (plugins.length === 0) {
      box.appendChild(element('div', 'text-sm text-foreground-300', 'No plugins registered.'));
    }
    plugins.forEach(function (plugin) {
      var row = element('div', 'flex w-full items-center justify-between gap-4 rounded-lg bg-neutral-0/4 p-4');

      var info = element('div', 'flex min-w-0 flex-col gap-1');
      var titleRow = element('div', 'flex flex-wrap items-center gap-2');
      titleRow.appendChild(element('span', 'text-base font-bold text-foreground-0', plugin.name));
      titleRow.appendChild(element('span', 'text-xs text-foreground-500', 'v' + plugin.version));
      titleRow.appendChild(element('span', 'text-xs text-foreground-500', plugin.source || 'built-in'));
      info.appendChild(titleRow);
      info.appendChild(element('span', 'text-sm text-foreground-300', plugin.description));
      info.appendChild(element('span', 'text-xs font-bold tracking-wider uppercase ' + (plugin.enabled ? 'text-brand-primary-400' : 'text-foreground-500'), plugin.enabled ? 'Enabled' : 'Disabled'));
      if (plugin.error) info.appendChild(element('span', 'text-xs text-danger-500', 'Error: ' + plugin.error));
      row.appendChild(info);

      var actions = element('div', 'flex flex-wrap items-center gap-2');
      var toggle = actionButton(plugin.enabled ? 'Disable' : 'Enable', !plugin.enabled, 'toggle-plugin');
      toggle.setAttribute('data-plugin-id', plugin.id);
      toggle.addEventListener('click', function () {
        if (plugin.enabled) internal.plugins.disable(plugin.id);
        else internal.plugins.enable(plugin.id);
        notify(plugin.name + (internal.plugins.get(plugin.id).enabled ? ' enabled' : ' disabled'));
        renderPlugins(host);
      });
      actions.appendChild(toggle);

      if (plugin.source === 'imported') {
        var remove = actionButton('Remove', false, 'remove-plugin');
        remove.setAttribute('data-plugin-id', plugin.id);
        remove.addEventListener('click', function () {
          if (internal.pluginImporter.remove(plugin.id)) notify(plugin.name + ' removed');
          renderPlugins(host);
        });
        actions.appendChild(remove);
      }
      row.appendChild(actions);
      box.appendChild(row);
    });

    host.appendChild(box);
    renderImporter(host);
    host.appendChild(statusLine());
  }

  function renderThemes(host) {
    host.textContent = '';
    host.appendChild(viewHeader('Themes', 'Choose a Nodal theme. Medal itself is not redesigned.'));

    var box = card();
    var row = element('div', 'flex w-full flex-wrap items-center gap-3');

    var select = element('select', 'min-w-0 flex-1 rounded-md border border-stroke-0/16 bg-transparent px-3 py-1.5 text-sm text-foreground-0 outline-none');
    select.id = 'nodal-theme-select';
    internal.themes.list().forEach(function (theme) {
      var option = element('option', null, theme.name);
      option.value = theme.id;
      select.appendChild(option);
    });
    if (internal.themes.current()) select.value = internal.themes.current();
    row.appendChild(select);

    var apply = actionButton('Apply', true, 'apply-theme');
    apply.addEventListener('click', function () {
      var ok = internal.themes.apply(select.value);
      notify(ok ? 'Theme applied: ' + select.value : 'Theme could not be applied');
    });
    row.appendChild(apply);

    var disable = actionButton('Disable theme', false, 'disable-theme');
    disable.addEventListener('click', function () {
      internal.themes.disable();
      notify('Theme disabled');
    });
    row.appendChild(disable);

    box.appendChild(row);
    box.appendChild(element('div', 'text-sm text-foreground-300', 'Selected theme: ' + (internal.themes.current() || 'none')));
    host.appendChild(box);
    host.appendChild(statusLine());
  }

  function renderQuickCss(host) {
    host.textContent = '';
    host.appendChild(viewHeader('Quick CSS', 'Edit and inject custom CSS into Medal. Saved locally and applied live.'));

    var box = card();
    var toolbar = element('div', 'flex w-full flex-wrap items-center gap-3');
    var apply = actionButton('Apply', true, 'apply-quick-css');
    apply.addEventListener('click', function () {
      var text = editor.value;
      var ok = internal.quickCss.apply(text);
      notify(ok ? (text.trim() ? 'Quick CSS applied' : 'Quick CSS cleared') : 'Quick CSS could not be applied');
    });
    toolbar.appendChild(apply);

    var clear = actionButton('Clear', false, 'clear-quick-css');
    clear.addEventListener('click', function () {
      internal.quickCss.clear();
      editor.value = '';
      notify('Quick CSS cleared');
    });
    toolbar.appendChild(clear);
    box.appendChild(toolbar);

    var editor = element('textarea', 'nodal-quick-css-editor w-full rounded-md border border-stroke-0/16 bg-neutral-1000 px-3 py-2 text-sm text-foreground-0 outline-none');
    editor.id = 'nodal-quick-css-editor';
    editor.value = internal.quickCss.get();
    editor.placeholder = '/* Paste CSS here. */\n@import url("https://example.com/theme.css");\n\n/* MEDAL APP SELECTORS GO HERE */';
    editor.setAttribute('spellcheck', 'false');
    editor.setAttribute('autocapitalize', 'off');
    editor.setAttribute('autocorrect', 'off');
    editor.setAttribute('wrap', 'off');
    box.appendChild(editor);

    box.appendChild(element('div', 'text-xs text-foreground-500', 'Injected after themes. @import rules must be at the top of the stylesheet.'));
    host.appendChild(box);
    host.appendChild(statusLine());
  }

  function renderAbout(host) {
    host.textContent = '';
    host.appendChild(viewHeader('Nodal', 'A modified client for Medal.'));

    var box = card();
    var rows = [
      ['Framework version', internal.runtime.version],
      ['Runtime status', 'Active'],
      ['Storage backend', internal.storage.backend],
      ['Loaded plugins', String(internal.plugins.list().length)],
      ['Imported plugins', String(internal.plugins.list().filter(function (plugin) { return plugin.source === 'imported'; }).length)],
      ['Selected theme', internal.themes.current() || 'none']
    ];
    rows.forEach(function (pair) {
      var row = element('div', 'flex items-center justify-between gap-6 border-b border-stroke-0/16 py-2 last:border-b-0');
      row.appendChild(element('span', 'text-sm text-foreground-300', pair[0]));
      row.appendChild(element('span', 'text-sm font-medium text-foreground-0', pair[1]));
      box.appendChild(row);
    });
    host.appendChild(box);
    host.appendChild(statusLine());
  }

  function renderView() {
    if (!viewElement) return;
    var host = viewElement.firstChild;
    if (!host) return;
    if (currentView === 'plugins') renderPlugins(host);
    else if (currentView === 'themes') renderThemes(host);
    else if (currentView === 'quick-css') renderQuickCss(host);
    else if (currentView === 'about') renderAbout(host);
  }

  function refreshPluginView() {
    if (currentView === 'plugins') renderView();
  }

  function createView() {
    var view = element('div', 'flex min-h-0 transparent-scrollbar-light-visible w-full scroll-pt-6 [scrollbar-gutter:stable] flex-col items-center scroll-smooth bg-neutral-1000');
    view.id = VIEW_ID;
    view.appendChild(element('div', 'flex w-full max-w-5xl flex-col items-center gap-4 px-8 py-6'));
    return view;
  }

  function ensureView() {
    if (!page) return;
    viewElement = document.getElementById(VIEW_ID);
    if (!viewElement) {
      viewElement = createView();
      page.appendChild(viewElement);
      renderView();
    }
  }

  function markMedalItems(active) {
    if (!sidebar) return;
    Array.prototype.forEach.call(sidebar.children, function (child) {
      if (child.id === GROUP_ID) return;
      if (!child.className || child.className.indexOf('cursor-pointer') === -1 || child.className.indexOf('px-4') === -1) return;
      applyItemState(child, active);
    });
  }

  function markOurItems() {
    var group = document.getElementById(GROUP_ID);
    if (!group) return;
    Array.prototype.forEach.call(group.querySelectorAll('[data-nodal-view]'), function (item) {
      applyItemState(item, item.getAttribute('data-nodal-view') === currentView);
    });
  }

  function activate(view) {
    if (!page || !sidebar) sync();
    if (!page || !sidebar) return;
    if (currentView === null) {
      previousActiveItem = Array.prototype.find.call(sidebar.children, function (child) {
        return child.id !== GROUP_ID && child.className && child.className.indexOf('bg-neutral-0/16') !== -1;
      }) || null;
      previousActiveClasses = previousActiveItem ? previousActiveItem.className : null;
      markMedalItems(false);
    }
    currentView = view;
    ensureView();
    if (content) content.style.display = 'none';
    markOurItems();
    renderView();
    internal.events.emit('ui:navigated', view);
  }

  function restore() {
    if (currentView === null) return;
    if (viewElement && viewElement.parentNode) viewElement.parentNode.removeChild(viewElement);
    viewElement = null;
    if (content) content.style.display = '';
    if (previousActiveItem && previousActiveClasses && previousActiveItem.isConnected) {
      previousActiveItem.className = previousActiveClasses;
    }
    previousActiveItem = null;
    previousActiveClasses = null;
    currentView = null;
    markOurItems();
    internal.events.emit('ui:restored');
  }

  function notify(message) {
    try {
      var line = document.getElementById('nodal-settings-status');
      if (line) {
        line.textContent = message;
        window.setTimeout(function () {
          if (line.textContent === message) line.textContent = '';
        }, 3500);
      } else {
        internal.logger.debug(message);
      }
    } catch (error) {
      internal.logger.error('Status update failed', error);
    }
  }

  function sync() {
    var found = document.querySelector(PAGE_SELECTOR);
    if (!found) {
      if (currentView !== null) {
        currentView = null;
        viewElement = null;
        previousActiveItem = null;
        previousActiveClasses = null;
      }
      page = null;
      sidebar = null;
      content = null;
      return;
    }

    if (found !== page) {
      page = found;
      viewElement = null;
      previousActiveItem = null;
      previousActiveClasses = null;
      currentView = null;
    }

    var sidebarRoot = page.children[0];
    sidebar = sidebarRoot ? (sidebarRoot.querySelector('.transparent-scrollbar-light-visible') || sidebarRoot) : null;
    content = page.children[1] || null;
    if (!sidebar) return;

    ensureGroup();

    if (currentView !== null) {
      ensureView();
      if (content && content.style.display !== 'none') content.style.display = 'none';
      markMedalItems(false);
      markOurItems();
    }
  }

  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = window.setTimeout(function () {
      syncTimer = null;
      sync();
    }, 40);
  }

  function onClick(event) {
    var group = document.getElementById(GROUP_ID);
    var target = event.target;
    if (!target || !page) return;

    if (group && group.contains(target)) {
      var item = target.closest ? target.closest('[data-nodal-view]') : null;
      if (item) {
        event.stopPropagation();
        event.preventDefault();
        activate(item.getAttribute('data-nodal-view'));
      }
      return;
    }

    if (currentView !== null && page.contains(target)) {
      var inView = target.closest ? target.closest('#' + VIEW_ID) : false;
      if (!inView) restore();
    }
  }

  function init() {
    try {
      ensureStyles();
      internal.events.on('plugin:imported', refreshPluginView);
      internal.events.on('plugin:removed', refreshPluginView);
      document.addEventListener('click', onClick, true);
      if (window.MutationObserver) {
        observer = new window.MutationObserver(scheduleSync);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      sync();
      internal.logger.info('Manager UI initialized');
    } catch (error) {
      internal.logger.error('Manager UI initialization failed', error);
    }
    return {
      open: function () { activate('plugins'); },
      close: restore,
      isOpen: function () { return currentView !== null; },
      notify: notify
    };
  }

  internal.ui = { init: init, notify: notify, open: function () { activate('plugins'); }, close: restore };
})(window.__NodalInternal);
