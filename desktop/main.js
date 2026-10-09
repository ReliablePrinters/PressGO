'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, session, shell, clipboard, ipcMain, Notification } = require('electron');
const { buildTemplate } = require('./contextmenu');
const { createUpdater } = require('./updater');
const { createNotifier } = require('./notify');

// PressGO desktop: a plain window around the live PressGO site.
// It holds no keys, no data and no copy of the site. Everything is loaded from APP_URL.
let APP_URL = 'https://reliableprinters.github.io/PressGO/';
// Local test builds only (made by try-build.js, never by the real build): open a copy of the site on this computer.
try {
  const o = require('./test-override.json');
  if (o && /^http:\/\/(localhost|127\.0\.0\.1):\d+\//.test(o.url)) APP_URL = o.url;
} catch (e) { /* normal build: no override file */ }
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_PATH = new URL(APP_URL).pathname;
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write', 'fullscreen']);

let win = null;

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

function showOffline() {
  if (!win || win.isDestroyed()) return;
  const html = '<!doctype html><meta charset="utf-8"><title>PressGO</title>' +
    '<body style="font-family:Segoe UI,sans-serif;background:#141826;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
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
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'PressGO',
    backgroundColor: '#141826',
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
  win.webContents.on('did-fail-load', (event, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) showOffline();
  });
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

  win.loadURL(APP_URL);
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
