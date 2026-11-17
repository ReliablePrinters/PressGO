'use strict';
// The only door between the splash page and the app's main process: it can receive the state, ask for a retry, or ask to quit.
// It cannot read files, run commands or reach the network.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('splashHost', {
  onState: (cb) => { if (typeof cb === 'function') ipcRenderer.on('splash:state', (_e, s) => cb(s)); },
  retry: () => ipcRenderer.send('splash:retry'),
  quit: () => ipcRenderer.send('splash:quit'),
  loaded: () => ipcRenderer.send('splash:loaded')
});
