'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, session, shell, clipboard, ipcMain, Notification, nativeTheme } = require('electron');
const { buildTemplate } = require('./contextmenu');
const { createUpdater } = require('./updater');
const { createNotifier } = require('./notify');
const { createStartup, SPLASH_NAVY } = require('./startup/startup');

// PressGO desktop: a plain window around the live PressGO site.
// It holds no keys, no data and no copy of the site. Everything is loaded from APP_URL.
let APP_URL = 'https://reliableprinters.github.io/PressGO/';
let TEST_BUILD = false;   // true only in the local PressGO Test build (made by try-build.js); it switches on the startup test hooks below
// Local test builds only (made by try-build.js, never by the real build): open a copy of the site on this computer.
try {
  const o = require('./test-override.json');
  if (o && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(o.url)) { APP_URL = o.url; TEST_BUILD = true; }
} catch (e) { /* normal build: no override file */ }
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_PATH = new URL(APP_URL).pathname;
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen']);

let win = null;
let startup = null;

function isAppUrl(u) {
  try {
    const x = new URL(u);
    return x.origin === APP_ORIGIN && x.pathname.startsWith(APP_PATH);
  } catch (e) {
    return false;
  }
}

function openInBrowser(u) {
  try {
    if (new URL(u).protocol === 'https:') shell.openExternal(u);
  } catch (e) {
    /* ignore */
  }
}

// The colour of the window before the page has painted. It is the page's own background (docs/style.css --bg) for the computer's
// light or dark setting, so there is no jump when the page appears. desktop/test/design-web.test.js keeps these in step with style.css.
const START_COLOURS = { dark: { bg: '#000000', fg: '#f2f2f7' }, light: { bg: '#f4f6f8', fg: '#14202e' } };
const startColours = () => (nativeTheme.shouldUseDarkColors ? START_COLOURS.dark : START_COLOURS.light);

function showOffline() {
  if (!win || win.isDestroyed()) return;
  const c = startColours();
  const html = '<!doctype html><meta charset="utf-8"><title>PressGO</title>' +
    '<body style="font-family:Segoe UI,sans-serif;background:' + c.bg + ';color:' + c.fg + ';display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    '<div style="text-align:center"><h2>PressGO cannot connect</h2><p>Check your internet connection. Trying again every 10 seconds.</p></div></body>';
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.loadURL(APP_URL);
  }, 10000);
}

// Updates only work for the installed copy (made by PressGO-Setup.exe). The portable zip and a developer
// run show no update button, because the installer must not be run over a folder it did not create.
function isInstalledCopy() {
  try {
    return fs.readdirSync(path.dirname(process.execPath)).some((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch (e) {
    return false;
  }
}

function startNotifications() {
  createNotifier({
    Notification,
    ipcMain,
    getWindow: () => win,
    // Only the real PressGO page, in the main window, may ask for a notification.
    isTrustedSender: (e) => !!(e.senderFrame && win && e.senderFrame === win.webContents.mainFrame && isAppUrl(e.senderFrame.url))
  });
}

function startUpdates() {
  const enabled = app.isPackaged && isInstalledCopy();
  let autoUpdater = null;
  if (enabled) {
    try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }
  }
  const up = createUpdater({
    autoUpdater: autoUpdater || { on() {}, checkForUpdates() {}, downloadUpdate() {}, quitAndInstall() {} },
    ipcMain,
    enabled: !!autoUpdater,
    currentVersion: app.getVersion(),
    getWindow: () => win,
    // Only the real PressGO page in the main frame may talk to the updater.
    isTrustedSender: (e) => !!(e.senderFrame && e.senderFrame === win?.webContents.mainFrame && isAppUrl(e.senderFrame.url)),
    log: () => {}
  });
  up.schedule();
}

function createWindow() {
  // The window stays hidden until the startup splash (startup/) has drawn, then shows at once, so the first thing anyone sees is the
  // navy splash and never a blank or white window. Its colour is the splash's navy.
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'PressGO',
    backgroundColor: SPLASH_NAVY,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false,
      webSecurity: true
    }
  });

  // Links that leave the PressGO site open in the normal browser, never inside this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openInBrowser(url);
    }
  });
  // While the startup splash is showing it deals with failures (offline, error, crash) itself, with a way to try again. Once the app
  // is showing, a failed page load behaves exactly as it always did.
  win.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (startup && startup.active()) { startup.onFail(code, isMainFrame); return; }
    if (isMainFrame && code !== -3) showOffline();
  });
  win.webContents.on('render-process-gone', (event, details) => { if (startup && startup.active()) startup.onGone(details.reason); });
  win.webContents.on('dom-ready', () => { if (startup) startup.onDomReady(); });
  // Electron shows no right-click menu by itself, so build the usual one (text editing, links, images).
  win.webContents.on('context-menu', (event, params) => {
    const wc = win.webContents;
    const tpl = buildTemplate(params, {
      copyText: (t) => clipboard.writeText(t),
      copyImageAt: (x, y) => wc.copyImageAt(x, y),
      openExternal: openInBrowser,
      saveImage: (u) => wc.downloadURL(u),               // Windows shows its normal "Save as" box
      replaceMisspelling: (w) => wc.replaceMisspelling(w),
      addToDictionary: (w) => wc.session.addWordToSpellCheckerDictionary(w),
      canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
      goBack: () => (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack()),
      reload: () => wc.reload(),
      isAppUrl
    });
    if (tpl.length) Menu.buildFromTemplate(tpl).popup({ window: win });
  });
  win.on('closed', () => {
    win = null;
  });
  // Local PressGO Test build only (TEST_BUILD is set from test-override.json, which the real build never contains): the window title
  // always starts with "TEST", so this window can never be mistaken for the real PressGO.
  if (TEST_BUILD) {
    win.setTitle('TEST - PressGO');
    win.webContents.on('page-title-updated', (event, title) => { event.preventDefault(); win.setTitle('TEST - ' + title); });
  }

  // The startup splash. In the local test build only, it can be made to start slowly, fail or crash (see startup/README.md).
  const startupTest = TEST_BUILD ? {
    sim: process.env.PRESSGO_TEST_STARTUP || '',
    logFile: path.join(require('os').tmpdir(), 'pressgo-startup-test.log'),
    shotsDir: process.env.PRESSGO_TEST_STARTUP_SHOTS || '',
    shotsAt: String(process.env.PRESSGO_TEST_STARTUP_SHOTS_AT || '').split(',').filter(Boolean).map(Number),
    exitAfterHandover: process.env.PRESSGO_TEST_STARTUP_EXIT === '1',
    quitAfter: process.env.PRESSGO_TEST_STARTUP_QUITAFTER
  } : null;
  startup = createStartup({ win, appUrl: APP_URL, loadApp: () => { win.loadURL(APP_URL).catch(() => { /* a failed load is reported by did-fail-load */ }); }, test: startupTest });
  startup.begin();   // if the splash cannot start, it shows the app plainly (as before the splash existed)
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    // Windows needs this name to match the installed shortcut, or it will not show notifications.
    try { app.setAppUserModelId(require('./package.json').pgAppId || 'com.reliableprinters.pressgo'); } catch (e) { /* keep default */ }
    createWindow();
    startNotifications();
    startUpdates();
  });
  app.on('window-all-closed', () => app.quit());
}
