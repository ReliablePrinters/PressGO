'use strict';
const { app, BrowserWindow, Menu, session, shell } = require('electron');

// PressGO desktop: a plain window around the live PressGO site.
// It holds no keys, no data and no copy of the site. Everything is loaded from APP_URL.
const APP_URL = 'https://reliableprinters.github.io/PressGO/';
const APP_ORIGIN = 'https://reliableprinters.github.io';
const APP_PATH = '/PressGO/';
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
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
