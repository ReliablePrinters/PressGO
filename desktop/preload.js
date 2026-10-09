'use strict';
// Gives the PressGO site a tiny, fixed set of update actions. Nothing else from Electron or Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pressgoDesktop', Object.freeze({
  update: Object.freeze({
    getState: () => ipcRenderer.invoke('update:get'),
    start: () => ipcRenderer.invoke('update:start'),
    install: () => ipcRenderer.invoke('update:install'),
    check: () => ipcRenderer.invoke('update:check'),
    onState: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const h = (_e, s) => { try { cb(s); } catch (e) { /* ignore page errors */ } };
      ipcRenderer.on('update:state', h);
      return () => ipcRenderer.removeListener('update:state', h);
    }
  })
}));
