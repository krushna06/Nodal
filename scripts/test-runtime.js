'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PORT = Number(process.env.NODAL_CDP_PORT || 9223);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) value = CRC_TABLE[(value ^ buffer[i]) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function createZip(files, method = 0) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.keys(files).forEach((name) => {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.from(files[name], 'utf8');
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + compressed.length;
  });

  const centralSize = centralParts.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const TEST_ZIP = createZip({
  'manifest.json': JSON.stringify({
    id: 'test-imported',
    name: 'Test Imported Plugin',
    description: 'Imported during the live Nodal test.',
    version: '1.0.0',
    author: 'Nodal Test',
    entry: 'index.js',
    style: 'style.css'
  }),
  'index.js': "window.NodalPlugin = { start: function () { window.__nodalTestPluginStarted = true; }, stop: function () { window.__nodalTestPluginStopped = true; } };",
  'style.css': '.nodal-test-imported-plugin { color: rgb(4, 5, 6) !important; }'
}).toString('base64');

const TEST_DEFLATE_ZIP = createZip({
  'manifest.json': JSON.stringify({
    id: 'test-deflate',
    name: 'Test Deflate Plugin',
    description: 'Deflated plugin.zip import check.',
    version: '1.0.0',
    author: 'Nodal Test',
    entry: 'index.js'
  }),
  'index.js': "window.NodalPlugin = { start: function () { window.__nodalDeflatePluginStarted = true; }, stop: function () {} };"
}, 8).toString('base64');

async function devtoolsIsOpen() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return targets.some((target) => target.type === 'page' && /^devtools:\/\//.test(target.url));
}

async function waitForDevtools(open, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await devtoolsIsOpen() === open) return true;
    await delay(250);
  }
  return false;
}

async function pressDevtoolsShortcut(cdp) {
  const key = { key: 'I', code: 'KeyI', windowsVirtualKeyCode: 73, nativeVirtualKeyCode: 73, modifiers: 10 };
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, key));
  await cdp.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, key));
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.console = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || []).map((arg) => arg.value || arg.description || '').join(' ');
        this.console.push(`${message.params.type}: ${text}`);
      }
      if (message.method === 'Log.entryAdded') {
        this.console.push(`log.${message.params.entry.level}: ${message.params.entry.text}`);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''));
    }
    return result.result.value;
  }
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await cdp.evaluate(expression)) return true;
    } catch (_) { /* page may be reloading */ }
    await delay(250);
  }
  return false;
}

async function dismissModal(cdp) {
  const open = await cdp.evaluate('!!document.querySelector(\'[data-slot="dialog-content"][data-open]\')');
  if (!open) return false;
  const closed = await cdp.evaluate('(function(){var e=document.querySelector(\'[data-slot="dialog-content"] [data-testid="close-button"]\'); if(!e) return false; e.click(); return true;})()');
  await delay(500);
  return closed;
}

async function pressEscape(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
}

async function openSettings(cdp) {
  const pageSelector = '[data-testid="settings-page-container"]';
  if (await cdp.evaluate(`!!document.querySelector('${pageSelector}')`)) return true;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dismissModal(cdp);
    await waitFor(cdp, '!!document.querySelector(\'[aria-label="Settings"]\')', 15000);
    await cdp.evaluate('(function(){var e=document.querySelector(\'[aria-label="Settings"]\'); if(!e) return false; e.click(); return true;})()');
    await delay(500);
    await dismissModal(cdp);
    await cdp.evaluate('(function(){var e=Array.from(document.querySelectorAll(\'[role="menuitem"]\')).find(function(x){return x.textContent.trim()==="Settings";}); if(!e) return false; e.click(); return true;})()');
    await delay(700);
    if (await waitFor(cdp, `!!document.querySelector('${pageSelector}')`, 4000)) return true;
    await pressEscape(cdp);
    await delay(300);
  }
  return false;
}

async function clickView(cdp, view) {
  return cdp.evaluate(`(function(){var i=document.querySelector('[data-nodal-view="${view}"]'); if(!i) return false; i.click(); return true;})()`);
}

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page' && /renderer\.min\.html/.test(item.url));
  if (!target) throw new Error('Main renderer CDP target not found. Is the dev app running with --remote-debugging-port=9223?');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.bringToFront');
  await cdp.send('Page.reload', { ignoreCache: true });

  const results = [];
  const QUICK_CSS_TEST = '.nodal-quick-css-test { color: rgb(1, 2, 3) !important; }';
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' -- ' + detail : ''}`);
  };

  check('Main renderer loaded', await waitFor(cdp, 'document.readyState === "complete"'));
  check('Nodal runtime initialized', await waitFor(cdp, 'window.Nodal && window.Nodal.initialized === true'));
  await delay(800);

  await delay(2500);
  const logText = cdp.console.join('\n');
  check('Runtime initialized console message', logText.includes('[Nodal] Runtime initialized'));
  check('Legacy MedalMod globals absent', await cdp.evaluate('!window.MedalMod && !window.MedalModAPI && !window.__MedalModInternal'));
  check('Nodal bootstrap script path', await cdp.evaluate("Array.from(document.scripts).some(function(s){return s.getAttribute('src')==='./nodal/bootstrap.js';})"));
  check('Janitor registered and enabled', await cdp.evaluate("(function(){var p=window.Nodal.plugins.get('janitor'); return !!p && p.enabled === true;})()"));
  check('Janitor prevents the "Do you know" popup from displaying', logText.includes('[janitor] Blocked the "Do you know" popup before display') || await cdp.evaluate("!Array.from(document.querySelectorAll('[data-slot=\"dialog-content\"][data-open]')).some(function(d){return (d.textContent||'').indexOf('Do you know')!==-1 && getComputedStyle(d).display!=='none';})"));
  check('AdBlocker registered and enabled', await cdp.evaluate("(function(){var p=window.Nodal.plugins.get('adblocker'); return !!p && p.enabled === true;})()"));
  check('DevTools plugin registered and enabled', await cdp.evaluate("(function(){var p=window.Nodal.plugins.get('devtools'); return !!p && p.enabled === true;})()"));

  const adBlockResult = await cdp.evaluate(`(function(){
    var host = document.createElement('div');
    host.id = 'nodal-adblock-test-host';
    document.body.appendChild(host);
    var card = document.createElement('div');
    card.setAttribute('data-testid', 'ad-card');
    card.textContent = 'Test ad';
    host.appendChild(card);
    var webview = document.createElement('webview');
    webview.setAttribute('src', 'https://ads.example.test/banner');
    webview.setAttribute('preload', './ad-webview-preload.js');
    host.appendChild(webview);
    var result = {
      cardHidden: getComputedStyle(card).display === 'none',
      cardMarked: card.hasAttribute('data-nodal-adblocked'),
      webviewSrc: webview.getAttribute('src'),
      webviewOriginal: webview.getAttribute('data-nodal-ad-src'),
      webviewHidden: getComputedStyle(webview).display === 'none'
    };
    host.parentNode.removeChild(host);
    return result;
  })()`);
  check('AdBlocker hides ad cards before display', adBlockResult.cardHidden && adBlockResult.cardMarked, JSON.stringify(adBlockResult));
  check('AdBlocker prevents ad webviews from loading', adBlockResult.webviewSrc === 'about:blank' && adBlockResult.webviewOriginal === 'https://ads.example.test/banner' && adBlockResult.webviewHidden, JSON.stringify(adBlockResult));

  check('Original Medal renderer mounted into #app', await cdp.evaluate('!!document.getElementById("app") && document.getElementById("app").childElementCount > 0'));
  check('Original preload bridge exposed', await cdp.evaluate('!!window.MedalIPC && !!window.MedalEnv'));

  check('Settings page opens', await openSettings(cdp));
  await delay(500);
  check('Nodal category exists in settings sidebar', await cdp.evaluate('!!document.getElementById("nodal-settings-group")'));
  check('Category label is "Nodal"', await cdp.evaluate(`(function(){var g=document.getElementById('nodal-settings-group'); return !!g && g.textContent.indexOf('Nodal') !== -1;})()`));
  check('Plugins / Themes / Quick CSS / About items exist in order', await cdp.evaluate(`(function(){var v=Array.from(document.querySelectorAll('#nodal-settings-group [data-nodal-view]')).map(function(e){return e.getAttribute('data-nodal-view');}); return ['plugins','themes','quick-css','about'].every(function(x,i){return v[i]===x;});})()`));
  check('No overlay panel or launcher exists', await cdp.evaluate('!document.getElementById("nodal-panel") && !document.getElementById("nodal-launcher")'));

  check('Plugins view opens from sidebar', (await clickView(cdp, 'plugins')) && await waitFor(cdp, '!!document.getElementById("nodal-settings-view") && document.getElementById("nodal-settings-view").textContent.includes("Example Plugin")'));
  check('Plugin importer drop zone exists', await cdp.evaluate('!!document.getElementById("nodal-plugin-drop") && !!document.getElementById("nodal-plugin-file-input")'));

  const pluginEnabled = await cdp.evaluate(`(function(){
    window.Nodal.plugins.disable('example-plugin');
    var view=document.getElementById('nodal-settings-view');
    var b=Array.from(view.querySelectorAll('button')).find(function(x){return x.textContent==='Enable' && x.getAttribute('data-plugin-id')==='example-plugin';});
    if(!b) return false;
    b.click();
    return window.Nodal.plugins.get('example-plugin').enabled===true;
  })()`);
  check('Example Plugin enables via native button', pluginEnabled);

  const pluginDisabled = await cdp.evaluate(`(function(){
    var b=document.querySelector('[data-nodal-action="toggle-plugin"][data-plugin-id="example-plugin"]');
    if(!b) return false;
    b.click();
    return window.Nodal.plugins.get('example-plugin').enabled===false;
  })()`);
  check('Example Plugin disables via native button', pluginDisabled);

  check('Themes view opens from sidebar', (await clickView(cdp, 'themes')) && await waitFor(cdp, '!!document.getElementById("nodal-theme-select")'));
  const themeApplied = await cdp.evaluate(`(function(){
    var select=document.getElementById('nodal-theme-select');
    select.value='default';
    var b=document.querySelector('[data-nodal-action="apply-theme"]');
    if(!b) return false;
    b.click();
    var s=document.getElementById('nodal-theme-style');
    return !!s && s.getAttribute('data-nodal-theme')==='default';
  })()`);
  check('Default theme applies via native button', themeApplied);

  check('Quick CSS view opens from sidebar', (await clickView(cdp, 'quick-css')) && await waitFor(cdp, '!!document.getElementById("nodal-quick-css-editor")'));
  check('Quick CSS has no example button', await cdp.evaluate('!document.querySelector(\'[data-nodal-action="load-quick-css-example"]\')'));

  const quickCssApplied = await cdp.evaluate(`(function(){
    var e=document.getElementById('nodal-quick-css-editor');
    e.value=${JSON.stringify(QUICK_CSS_TEST)};
    var b=document.querySelector('[data-nodal-action="apply-quick-css"]');
    if(!b) return false;
    b.click();
    var probe=document.createElement('div');
    probe.className='nodal-quick-css-test';
    document.body.appendChild(probe);
    var ok=!!document.getElementById('nodal-quick-css-style') && getComputedStyle(probe).color==='rgb(1, 2, 3)';
    document.body.removeChild(probe);
    return ok;
  })()`);
  check('Quick CSS applies live via native button', quickCssApplied);
  const storedQuickCss = await cdp.evaluate('JSON.parse(localStorage.getItem("nodal:config") || "{}").quickCss');
  const storedTheme = await cdp.evaluate('JSON.parse(localStorage.getItem("nodal:config") || "{}").theme');

  await cdp.send('Page.reload', { ignoreCache: true });
  const runtimeBack = await waitFor(cdp, 'window.Nodal && window.Nodal.initialized === true');
  const settingsBack = await openSettings(cdp);
  await clickView(cdp, 'themes');
  await delay(300);
  const themeAfterReload = await cdp.evaluate(`(function(){var s=document.getElementById('nodal-theme-style'); return !!s && s.getAttribute('data-nodal-theme')==='default';})()`);
  check('Theme persists after reload', runtimeBack && settingsBack && storedTheme === 'default' && themeAfterReload, `stored=${storedTheme}`);

  const quickCssAfterReload = await cdp.evaluate(`(function(){var s=document.getElementById('nodal-quick-css-style'); return !!s && s.textContent.indexOf('nodal-quick-css-test')!==-1;})()`);
  check('Quick CSS persists after reload', storedQuickCss === QUICK_CSS_TEST && quickCssAfterReload, `stored=${(storedQuickCss || '').length} chars`);

  await clickView(cdp, 'quick-css');
  await delay(200);
  const quickCssCleared = await cdp.evaluate(`(function(){var b=document.querySelector('[data-nodal-action="clear-quick-css"]'); if(!b) return false; b.click(); return !document.getElementById('nodal-quick-css-style') && document.getElementById('nodal-quick-css-editor').value==='';})()`);
  check('Quick CSS clears via native button', quickCssCleared);

  await clickView(cdp, 'plugins');
  await delay(200);
  const imported = await cdp.evaluate(`(async function(){
    var binary=atob('${TEST_ZIP}');
    var bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
    var file=new File([bytes],'plugin.zip',{type:'application/zip'});
    var plugin=await window.Nodal.importer.importFile(file);
    var probe=document.createElement('div');
    probe.className='nodal-test-imported-plugin';
    document.body.appendChild(probe);
    var result={
      id:plugin.id,
      name:plugin.name,
      enabled:plugin.enabled,
      source:plugin.source,
      started:window.__nodalTestPluginStarted===true,
      style:!!document.querySelector('[data-nodal-plugin-style="test-imported"]'),
      color:getComputedStyle(probe).color,
      stored:(JSON.parse(localStorage.getItem('nodal:config')||'{}').importedPlugins||[]).length,
      removeButton:!!document.querySelector('[data-nodal-action="remove-plugin"][data-plugin-id="test-imported"]')
    };
    document.body.removeChild(probe);
    return result;
  })()`);
  check('plugin.zip imports and enables immediately', imported.id === 'test-imported' && imported.enabled && imported.source === 'imported' && imported.started, JSON.stringify(imported));
  check('Imported plugin stylesheet applies', imported.style && imported.color === 'rgb(4, 5, 6)', JSON.stringify(imported));
  check('Imported plugin persists and shows Remove', imported.stored === 1 && imported.removeButton, JSON.stringify(imported));

  await cdp.send('Page.reload', { ignoreCache: true });
  const importRuntimeBack = await waitFor(cdp, 'window.Nodal && window.Nodal.initialized === true');
  const importSettingsBack = await openSettings(cdp);
  await clickView(cdp, 'plugins');
  await delay(300);
  const importRestored = await cdp.evaluate(`(function(){
    var p=window.Nodal.plugins.get('test-imported');
    var probe=document.createElement('div');
    probe.className='nodal-test-imported-plugin';
    document.body.appendChild(probe);
    var ok=!!p && p.enabled===true && !!document.querySelector('[data-nodal-plugin-style="test-imported"]') && getComputedStyle(probe).color==='rgb(4, 5, 6)';
    document.body.removeChild(probe);
    return ok;
  })()`);
  check('Imported plugin restores after reload', importRuntimeBack && importSettingsBack && importRestored);

  const importRemoved = await cdp.evaluate(`(function(){
    var b=document.querySelector('[data-nodal-action="remove-plugin"][data-plugin-id="test-imported"]');
    if(!b) return false;
    b.click();
    var stored=JSON.parse(localStorage.getItem('nodal:config')||'{}').importedPlugins||[];
    return !window.Nodal.plugins.get('test-imported') && stored.length===0;
  })()`);
  check('Imported plugin removes via native button', importRemoved);

  const deflateImported = await cdp.evaluate(`(async function(){
    var binary=atob('${TEST_DEFLATE_ZIP}');
    var bytes=new Uint8Array(binary.length);
    for(var i=0;i<binary.length;i+=1) bytes[i]=binary.charCodeAt(i);
    var file=new File([bytes],'deflate-plugin.zip',{type:'application/zip'});
    var plugin=await window.Nodal.importer.importFile(file);
    return plugin.id==='test-deflate' && plugin.enabled===true && window.__nodalDeflatePluginStarted===true;
  })()`);
  check('Deflated plugin.zip imports and enables', deflateImported);

  const deflateRemoved = await cdp.evaluate(`(function(){
    var ok=window.Nodal.importer.remove('test-deflate');
    var stored=JSON.parse(localStorage.getItem('nodal:config')||'{}').importedPlugins||[];
    return ok && !window.Nodal.plugins.get('test-deflate') && stored.length===0;
  })()`);
  check('Deflated plugin removes cleanly', deflateRemoved);

  check('About view opens from sidebar', (await clickView(cdp, 'about')) && await waitFor(cdp, 'document.getElementById("nodal-settings-view").textContent.includes("0.1.0")'));
  check('NodalAPI alias exposed', await cdp.evaluate('!!window.NodalAPI'));

  await cdp.evaluate('(function(){var e=Array.from(document.querySelectorAll(\'[data-testid="settings-page-container"] div\')).find(function(x){return x.children.length===0 && x.textContent.trim()==="Quality" && (x.className||"").indexOf("cursor-pointer")!==-1;}); if(!e) return false; e.click(); return true;})()');
  await delay(400);
  const restored = await cdp.evaluate(`(function(){
    var view=document.getElementById('nodal-settings-view');
    var content=document.querySelector('[data-testid="settings-page-container"]').children[1];
    return !view && !!content && content.style.display !== 'none';
  })()`);
  check('Clicking a Medal category restores the original settings UI', restored);

  check('Nodal category persists after returning to Medal settings', await cdp.evaluate('!!document.getElementById("nodal-settings-group")'));

  await clickView(cdp, 'plugins');
  await delay(300);
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const shotPath = path.join(__dirname, '..', 'build', 'manager-screenshot.png');
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
    console.log(`Screenshot saved: ${shotPath}`);
  } catch (error) {
    console.log(`Screenshot unavailable: ${error.message}`);
  }

  if (await devtoolsIsOpen()) {
    await cdp.evaluate('window.MedalIPC.debug.toggleDevTools()');
    await waitForDevtools(false);
  }
  await pressDevtoolsShortcut(cdp);
  check('Ctrl+Shift+I opens developer tools', await waitForDevtools(true));
  await delay(500);
  await cdp.send('Page.bringToFront');
  await pressDevtoolsShortcut(cdp);
  check('Ctrl+Shift+I closes developer tools', await waitForDevtools(false));

  const failures = results.filter((result) => !result.ok);
  console.log(`\nRESULT: ${results.length - failures.length}/${results.length} checks passed.`);
  if (failures.length) {
    console.log('Captured console log:\n' + logText);
    process.exitCode = 1;
  }
  ws.close();
}

main().catch((error) => {
  console.error('TEST HARNESS ERROR:', error.message || error);
  process.exit(1);
});
