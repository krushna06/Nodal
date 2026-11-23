(function (internal) {
  'use strict';

  var PAGE_SELECTOR = '[data-testid="settings-page-container"]';
  var GROUP_ID = 'nodal-settings-group';
  var VIEW_ID = 'nodal-settings-view';
  var STYLE_ID = 'nodal-manager-styles';
  var REPO_URL = 'https://github.com/krushna06/Nodal';
  var DONATE_URL = 'https://paypal.me/nostep06';

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
  var themeMenu = null;
  var themeMenuTrigger = null;
  var themeMenuCleanup = null;

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
      { id: 'settings', label: 'Settings' },
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
    sidebar.insertBefore(group, sidebar.firstChild);
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

  function closeThemeMenu() {
    if (themeMenuCleanup) {
      themeMenuCleanup();
      themeMenuCleanup = null;
    }
    if (themeMenu && themeMenu.parentNode) themeMenu.parentNode.removeChild(themeMenu);
    themeMenu = null;
    if (themeMenuTrigger && themeMenuTrigger.isConnected) themeMenuTrigger.setAttribute('aria-expanded', 'false');
    themeMenuTrigger = null;
  }

  function openThemeMenu(trigger, menu) {
    closeThemeMenu();
    themeMenuTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    if (menu.parentNode) menu.parentNode.removeChild(menu);
    trigger.parentNode.appendChild(menu);
    menu.hidden = false;
    themeMenu = menu;

    var options = Array.prototype.slice.call(menu.querySelectorAll('[data-theme-option]'));
    var selectedIndex = 0;
    options.forEach(function (option, index) {
      if (option.getAttribute('aria-selected') === 'true') selectedIndex = index;
    });

    function focusOption(index) {
      if (options.length === 0) return;
      var next = (index + options.length) % options.length;
      options.forEach(function (option, optionIndex) {
        option.setAttribute('tabindex', optionIndex === next ? '0' : '-1');
      });
      options[next].focus();
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeThemeMenu();
        trigger.focus();
        return;
      }
      if (event.key === 'Tab') {
        closeThemeMenu();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        var current = options.indexOf(document.activeElement);
        focusOption(current < 0 ? selectedIndex : current + (event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusOption(event.key === 'Home' ? 0 : options.length - 1);
      }
    }

    function onOutsidePointerDown(event) {
      if (trigger.parentNode.contains(event.target) || menu.contains(event.target)) return;
      closeThemeMenu();
    }

    function onLayoutChange(event) {
      if (menu.contains(event.target)) return;
      closeThemeMenu();
    }

    themeMenuCleanup = function () {
      document.removeEventListener('pointerdown', onOutsidePointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onLayoutChange, true);
      window.removeEventListener('resize', onLayoutChange);
      menu.hidden = true;
    };

    document.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onLayoutChange, true);
    window.addEventListener('resize', onLayoutChange);
    focusOption(selectedIndex);
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

  async function importThemeFile(file, host) {
    if (!file) return;
    notify('Importing ' + file.name + '…');
    try {
      var theme = await internal.themeImporter.importFile(file);
      notify(theme.name + ' installed and applied');
      renderThemes(host);
    } catch (error) {
      notify('Import failed: ' + ((error && error.message) || error));
    }
  }

  function renderDropImporter(host, options) {
    var box = card();
    box.id = options.boxId;
    box.appendChild(element('div', 'text-base font-bold text-foreground-0', options.title));
    box.appendChild(element('div', 'text-sm text-foreground-300', options.description));

    var drop = element('div', 'nodal-plugin-drop flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-stroke-0/24 px-4 py-6 text-center', options.dropLabel);
    drop.id = options.dropId;
    drop.setAttribute('data-nodal-action', options.dropAction);

    var input = document.createElement('input');
    input.type = 'file';
    input.id = options.inputId;
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
      options.onFile(file, host);
    });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.value = '';
      options.onFile(file, host);
    });

    box.appendChild(drop);
    box.appendChild(input);

    var choose = actionButton(options.chooseLabel, false, options.chooseAction);
    choose.addEventListener('click', function () { input.click(); });
    box.appendChild(choose);

    host.appendChild(box);
  }

  function renderImporter(host) {
    renderDropImporter(host, {
      boxId: 'nodal-plugin-importer',
      title: 'Import a plugin',
      description: 'Drop a community plugin.zip here, or choose one from your PC. Plugins are enabled immediately and saved locally.',
      dropLabel: 'Drop plugin.zip here, or click to browse',
      dropId: 'nodal-plugin-drop',
      dropAction: 'plugin-drop-zone',
      inputId: 'nodal-plugin-file-input',
      chooseLabel: 'Choose plugin.zip',
      chooseAction: 'choose-plugin',
      onFile: importPluginFile
    });
  }

  function renderThemeImporter(host) {
    renderDropImporter(host, {
      boxId: 'nodal-theme-importer',
      title: 'Import a theme',
      description: 'Drop a theme.zip with manifest.json and style.css here, or choose one from your PC. Themes are applied immediately and saved locally.',
      dropLabel: 'Drop theme.zip here, or click to browse',
      dropId: 'nodal-theme-drop',
      dropAction: 'theme-drop-zone',
      inputId: 'nodal-theme-file-input',
      chooseLabel: 'Choose theme.zip',
      chooseAction: 'choose-theme',
      onFile: importThemeFile
    });
  }

  function settingRow(title, description, checked, dataName, dataValue) {
    var row = element('div', 'flex w-full items-center justify-between gap-4 rounded-lg bg-neutral-0/4 p-4');
    var info = element('div', 'flex min-w-0 flex-col gap-1');
    var titleRow = element('div', 'flex flex-wrap items-center gap-2');
    titleRow.appendChild(element('span', 'text-base font-bold text-foreground-0', title));
    var status = element('span', 'text-xs font-bold tracking-wider uppercase ' + (checked ? 'text-brand-primary-400' : 'text-foreground-500'), checked ? 'Active' : 'Inactive');
    titleRow.appendChild(status);
    info.appendChild(titleRow);
    info.appendChild(element('span', 'text-sm text-foreground-300', description));
    row.appendChild(info);

    var toggle = element('label', 'nodal-switch');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.setAttribute('aria-label', title);
    if (dataName) input.setAttribute(dataName, dataValue);
    var track = element('span', 'nodal-switch-track');
    track.appendChild(element('span', 'nodal-switch-thumb'));
    toggle.appendChild(input);
    toggle.appendChild(track);
    row.appendChild(toggle);

    return {
      row: row,
      input: input,
      status: status,
      set: function (value) {
        input.checked = value;
        status.textContent = value ? 'Active' : 'Inactive';
        status.className = 'text-xs font-bold tracking-wider uppercase ' + (value ? 'text-brand-primary-400' : 'text-foreground-500');
      }
    };
  }

  function renderSettings(host) {
    host.textContent = '';
    host.appendChild(viewHeader('Settings', 'Quick controls for Nodal.'));

    var box = card();

    var rpc = settingRow(
      'Discord RPC',
      'Show Medal activity such as clipping with a method on Discord.',
      true,
      'data-setting',
      'discord-rpc'
    );
    rpc.input.disabled = true;
    rpc.input.setAttribute('data-nodal-action', 'toggle-discord-rpc');
    box.appendChild(rpc.row);

    function rpcAvailable() {
      return !!(window.MedalIPC && typeof window.MedalIPC.getSetting === 'function' && typeof window.MedalIPC.updateSetting === 'function');
    }

    function loadRpc() {
      if (!rpcAvailable()) {
        rpc.input.disabled = false;
        rpc.set(true);
        return;
      }
      try {
        var request = window.MedalIPC.getSetting('DiscordRpcEnabled');
        Promise.resolve(request).then(function (value) {
          var enabled = value === undefined || value === null ? true : value !== false;
          if (value === undefined || value === null) {
            Promise.resolve(window.MedalIPC.updateSetting('DiscordRpcEnabled', true)).catch(function () {});
          }
          if (rpc.input.isConnected) {
            rpc.set(enabled);
            rpc.input.disabled = false;
          }
        }).catch(function () {
          if (rpc.input.isConnected) {
            rpc.set(true);
            rpc.input.disabled = false;
          }
        });
      } catch (error) {
        rpc.input.disabled = false;
        rpc.set(true);
      }
    }

    rpc.input.addEventListener('change', function () {
      var enabled = rpc.input.checked;
      if (!rpcAvailable()) {
        notify('Discord RPC settings are unavailable');
        rpc.set(true);
        return;
      }
      rpc.input.disabled = true;
      Promise.resolve(window.MedalIPC.updateSetting('DiscordRpcEnabled', enabled)).then(function () {
        notify('Discord RPC ' + (enabled ? 'enabled' : 'disabled'));
        rpc.set(enabled);
        rpc.input.disabled = false;
      }).catch(function () {
        notify('Discord RPC could not be updated');
        rpc.set(!enabled);
        rpc.input.disabled = false;
      });
    });

    loadRpc();

    var devtools = settingRow(
      'Unlock Developer Tools',
      'Unlocks Ctrl+Shift+I so you can toggle Medal\'s built-in developer tools.',
      !!(internal.plugins.get('devtools') && internal.plugins.get('devtools').enabled),
      'data-plugin-id',
      'devtools'
    );
    devtools.input.setAttribute('data-nodal-action', 'toggle-setting-plugin');
    devtools.input.addEventListener('change', function () {
      if (!internal.plugins.get('devtools')) return;
      if (devtools.input.checked) internal.plugins.enable('devtools');
      else internal.plugins.disable('devtools');
      notify('Unlock Developer Tools ' + (internal.plugins.get('devtools').enabled ? 'enabled' : 'disabled'));
      renderSettings(host);
    });
    box.appendChild(devtools.row);

    host.appendChild(box);
    host.appendChild(statusLine());
  }

  function renderPlugins(host) {
    host.textContent = '';
    host.appendChild(viewHeader('Plugins', 'Manage Nodal plugins and import community plugins.'));

    var box = card();
    var plugins = internal.plugins.list().filter(function (plugin) {
      return plugin.id !== 'example-plugin' && plugin.id !== 'devtools';
    });
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
    closeThemeMenu();
    host.textContent = '';
    host.appendChild(viewHeader('Themes', 'Click a theme to restyle all of Medal instantly.'));

    var themes = internal.themes.list();
    var selectedId = internal.themes.current() || (themes[0] && themes[0].id) || null;
    function themeName(id) {
      var found = Array.prototype.find.call(themes, function (theme) { return theme.id === id; });
      return found ? found.name : 'Choose a theme';
    }

    var box = card();
    var row = element('div', 'flex w-full flex-wrap items-center gap-3');

    var selectWrap = element('div', 'nodal-select-wrap flex min-w-0 flex-1 items-center');
    var trigger = element('button', 'nodal-theme-trigger flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm outline-none');
    trigger.id = 'nodal-theme-select';
    trigger.type = 'button';
    trigger.setAttribute('data-slot', 'button');
    trigger.setAttribute('data-theme-id', selectedId || '');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var label = element('span', 'nodal-theme-label flex min-w-0 flex-1 truncate', themeName(selectedId));
    label.id = 'nodal-theme-label';
    trigger.appendChild(label);
    trigger.appendChild(element('span', 'nodal-theme-chevron'));

    var menu = element('div', 'nodal-theme-menu');
    menu.id = 'nodal-theme-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Themes');
    menu.hidden = true;
    themes.forEach(function (theme) {
      var option = element('div', 'nodal-theme-option flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm');
      option.setAttribute('role', 'option');
      option.setAttribute('data-theme-option', theme.id);
      option.setAttribute('aria-selected', theme.id === selectedId ? 'true' : 'false');
      option.setAttribute('tabindex', '-1');
      var check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      check.setAttribute('class', 'nodal-theme-check');
      check.setAttribute('viewBox', '0 0 16 16');
      check.setAttribute('aria-hidden', 'true');
      var checkPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      checkPath.setAttribute('d', 'M3 8.5l3.2 3.2L13 5');
      check.appendChild(checkPath);
      check.style.visibility = theme.id === selectedId ? 'visible' : 'hidden';
      option.appendChild(check);
      var text = element('div', 'flex min-w-0 flex-1 flex-col');
      text.appendChild(element('span', 'truncate', theme.name));
      if (theme.description) text.appendChild(element('span', 'nodal-theme-option-description truncate text-xs text-foreground-500', theme.description));
      option.appendChild(text);
      option.addEventListener('click', function () {
        var ok = internal.themes.apply(theme.id);
        notify(ok ? 'Theme applied: ' + theme.name : 'Theme could not be applied');
        renderThemes(host);
        var nextTrigger = document.getElementById('nodal-theme-select');
        if (nextTrigger) nextTrigger.focus();
      });
      option.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          option.click();
        }
      });
      menu.appendChild(option);
    });

    trigger.addEventListener('click', function () {
      if (themeMenu === menu) closeThemeMenu();
      else openThemeMenu(trigger, menu);
    });
    trigger.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (themeMenu !== menu) openThemeMenu(trigger, menu);
      }
    });

    selectWrap.appendChild(trigger);
    selectWrap.appendChild(menu);
    row.appendChild(selectWrap);

    var disable = actionButton('Disable theme', false, 'disable-theme');
    disable.addEventListener('click', function () {
      internal.themes.disable();
      notify('Theme disabled');
      renderThemes(host);
    });
    row.appendChild(disable);

    box.appendChild(row);
    box.appendChild(element('div', 'text-sm text-foreground-300', 'Selected theme: ' + (internal.themes.current() || 'none')));
    box.appendChild(element('div', 'text-sm text-foreground-300', 'Themes override the color tokens and CSS Medal already uses across the whole app. Use Quick CSS for one-off tweaks.'));
    host.appendChild(box);

    var guide = element('details', 'text-sm text-foreground-300');
    guide.id = 'nodal-theme-guide';
    guide.appendChild(element('summary', 'cursor-pointer font-bold text-foreground-0', 'Theme authoring example'));
    guide.appendChild(element('pre', 'nodal-theme-guide mt-2 overflow-auto rounded-lg bg-neutral-0/4 p-3 text-xs text-foreground-300',
      'theme.zip\n  manifest.json\n    { "id": "my-theme", "name": "My Theme",\n      "variables": { "--color-third-layer": "oklch(22% 0.05 310)" },\n      "style": "style.css" }\n  style.css\n    [data-testid="app-title-bar"] { border-bottom-color: pink; }\n\nThe active theme id is also set on <html data-nodal-theme="...">.'));
    host.appendChild(guide);

    var importedThemes = internal.themes.list().filter(function (theme) { return theme.source === 'imported'; });
    if (importedThemes.length > 0) {
      var importedBox = card();
      importedBox.appendChild(element('div', 'text-base font-bold text-foreground-0', 'Imported themes'));
      importedThemes.forEach(function (theme) {
        var importedRow = element('div', 'flex w-full items-center justify-between gap-4 rounded-lg bg-neutral-0/4 p-4');
        var info = element('div', 'flex min-w-0 flex-col gap-1');
        var titleRow = element('div', 'flex flex-wrap items-center gap-2');
        titleRow.appendChild(element('span', 'text-base font-bold text-foreground-0', theme.name));
        titleRow.appendChild(element('span', 'text-xs text-foreground-500', 'v' + theme.version));
        titleRow.appendChild(element('span', 'text-xs text-foreground-500', theme.source || 'imported'));
        info.appendChild(titleRow);
        info.appendChild(element('span', 'text-sm text-foreground-300', theme.description));
        importedRow.appendChild(info);

        var remove = actionButton('Remove', false, 'remove-theme');
        remove.setAttribute('data-theme-id', theme.id);
        remove.addEventListener('click', function () {
          if (internal.themeImporter.remove(theme.id)) notify(theme.name + ' removed');
          renderThemes(host);
        });
        importedRow.appendChild(remove);
        importedBox.appendChild(importedRow);
      });
      host.appendChild(importedBox);
    }

    renderThemeImporter(host);
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

    var editor = element('textarea', 'nodal-quick-css-editor w-full rounded-md border border-stroke-0/16 px-3 py-2 text-sm outline-none');
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
    host.appendChild(viewHeader('Nodal', 'A Vencord-inspired modification framework for Medal.'));

    var support = element('div', 'nodal-support-banner flex w-full flex-col gap-3 rounded-lg p-5');
    var supportTitle = element('div', 'flex items-center gap-3');
    var heartBadge = element('span', 'nodal-support-badge');
    var heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    heart.setAttribute('width', '16');
    heart.setAttribute('height', '16');
    heart.setAttribute('viewBox', '0 0 24 24');
    heart.setAttribute('fill', 'currentColor');
    heart.setAttribute('aria-hidden', 'true');
    var heartPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    heartPath.setAttribute('d', 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');
    heart.appendChild(heartPath);
    heartBadge.appendChild(heart);
    supportTitle.appendChild(heartBadge);
    supportTitle.appendChild(element('div', 'text-base font-bold text-foreground-0', 'Support the Project'));
    support.appendChild(supportTitle);
    support.appendChild(element('div', 'text-sm text-foreground-300', 'Please consider supporting the development of Nodal by donating!'));

    var supportLink = element('a', 'nodal-support-link inline-flex w-fit cursor-pointer items-center justify-center rounded-md border border-stroke-0/16 bg-neutral-0/16 px-3 py-1.5 text-sm font-medium text-foreground-0 hover:bg-neutral-0/24', 'Donate');
    supportLink.href = DONATE_URL;
    supportLink.target = '_blank';
    supportLink.rel = 'noopener noreferrer';
    support.appendChild(supportLink);
    host.appendChild(support);

    var box = card();
    var rows = [
      ['Framework version', internal.runtime.version],
      ['Runtime status', 'Active'],
      ['Created by', 'krushna06']
    ];
    rows.forEach(function (pair) {
      var row = element('div', 'flex items-center justify-between gap-6 border-b border-stroke-0/16 py-2 last:border-b-0');
      row.appendChild(element('span', 'text-sm text-foreground-300', pair[0]));
      row.appendChild(element('span', 'text-sm font-medium text-foreground-0', pair[1]));
      box.appendChild(row);
    });

    var repoRow = element('div', 'flex items-center justify-between gap-6 border-b border-stroke-0/16 py-2 last:border-b-0');
    repoRow.appendChild(element('span', 'text-sm text-foreground-300', 'GitHub'));
    var repoLink = element('a', 'nodal-support-link text-sm font-medium text-brand-primary-400 hover:underline', 'krushna06/Nodal');
    repoLink.href = REPO_URL;
    repoLink.target = '_blank';
    repoLink.rel = 'noopener noreferrer';
    repoRow.appendChild(repoLink);
    box.appendChild(repoRow);
    host.appendChild(box);
    host.appendChild(statusLine());
  }

  function renderView() {
    closeThemeMenu();
    if (!viewElement) return;
    var host = viewElement.firstChild;
    if (!host) return;
    if (currentView === 'settings') renderSettings(host);
    else if (currentView === 'plugins') renderPlugins(host);
    else if (currentView === 'themes') renderThemes(host);
    else if (currentView === 'quick-css') renderQuickCss(host);
    else if (currentView === 'about') renderAbout(host);
  }

  function refreshPluginView() {
    if (currentView === 'plugins' || currentView === 'settings') renderView();
  }

  function refreshThemeView() {
    if (currentView === 'themes') renderView();
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
    closeThemeMenu();
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
    if (!found || (found !== page && page)) {
      closeThemeMenu();
    }
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
      internal.events.on('theme:imported', refreshThemeView);
      internal.events.on('theme:removed', refreshThemeView);
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
