'use strict';
// PressGO desktop updater. Checks the official GitHub Releases for a newer version, shows an
// "Update PressGO" button in the app (never downloads until it is clicked), then installs on request.
// The updater library (electron-updater) is passed in, so all the rules here can be tested without Electron.

const CHECK_FIRST_MS = 15 * 1000;          // first check shortly after launch
const CHECK_EVERY_MS = 30 * 60 * 1000;     // then every 30 minutes while the app is open
const MIN_GAP_MS = 60 * 1000;              // never check more than once a minute

// ---- version comparison (semver: 1.10.0 > 1.9.0, 1.2.0 > 1.2.0-beta.1, identical is not newer) ----
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i] ? 1 : -1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;           // a release is newer than its own pre-release
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
    if (pn) return -1;
    if (qn) return 1;
    return p > q ? 1 : -1;
  }
  return 0;
}
const isNewer = (candidate, current) => compareVersions(candidate, current) === 1;

// Release notes come from GitHub. Show them as plain text only, never as HTML.
function plainNotes(notes) {
  let s = '';
  if (typeof notes === 'string') s = notes;
  else if (Array.isArray(notes)) s = notes.map((n) => (n && n.note) || '').join('\n');
  s = s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[#*_`>]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return s.length > 300 ? s.slice(0, 297).trimEnd() + '...' : s;
}

function friendlyError(err) {
  const m = String((err && (err.code || err.message)) || err || '').toLowerCase();
  if (/enotfound|econnrefused|econnreset|etimedout|eai_again|network|internet|offline|err_internet|err_name_not_resolved|err_connection|socket/.test(m)) {
    return 'PressGO could not reach the update server. Check the internet connection and try again.';
  }
  if (/sha512|checksum|integrity|signature|verif/.test(m)) {
    return 'The downloaded update did not pass the safety check, so it was not installed. Nothing was changed. Please try again or ask a manager.';
  }
  if (/404|not found|no published versions|latest\.yml|cannot find/.test(m)) {
    return 'The update is not available right now. Please try again later.';
  }
  return 'The update could not be completed. Nothing was changed. Please try again, or ask a manager.';
}

function createUpdater(deps) {
  const { autoUpdater, ipcMain, getWindow, isTrustedSender, currentVersion, enabled, log = () => {}, now = Date.now,
    setTimer = setTimeout, setRepeat = setInterval } = deps;

  const state = { status: enabled ? 'idle' : 'disabled', currentVersion, version: null, notes: '', percent: 0, message: '' };
  let lastCheck = 0;
  let manual = false;          // true while the user is waiting on something they clicked

  const snapshot = () => ({ ...state });
  function set(patch) {
    Object.assign(state, patch);
    const w = getWindow && getWindow();
    if (w && !w.isDestroyed()) { try { w.webContents.send('update:state', snapshot()); } catch (e) { /* window closing */ } }
  }

  function check(userAsked) {
    if (!enabled) return Promise.resolve(snapshot());
    if (['checking', 'downloading', 'ready'].includes(state.status)) return Promise.resolve(snapshot());
    if (!userAsked && now() - lastCheck < MIN_GAP_MS) return Promise.resolve(snapshot());
    lastCheck = now();
    manual = !!userAsked;
    const was = state.status;
    set({ status: was === 'available' ? 'available' : 'checking', message: '' });
    return Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((e) => { onError(e); })
      .then(() => snapshot());
  }

  function onError(err) {
    log('update error', err && err.message);
    if (state.status === 'downloading') {
      set({ status: 'error', message: friendlyError(err), percent: 0 });
    } else if (manual) {
      set({ status: 'error', message: friendlyError(err) });
    } else {
      // Background check failed (offline, etc.): stay quiet, try again next time.
      set({ status: state.version ? 'available' : 'idle', message: '' });
    }
    manual = false;
  }

  if (enabled) {
    autoUpdater.autoDownload = false;            // nothing is downloaded until the button is clicked
    autoUpdater.autoInstallOnAppQuit = true;     // an update the user already downloaded installs when they quit normally
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('update-available', (info) => {
      if (!info || !isNewer(info.version, currentVersion)) {
        set({ status: 'idle', version: null, notes: '', message: '' });
        return;
      }
      set({ status: 'available', version: info.version, notes: plainNotes(info.releaseNotes), percent: 0, message: '' });
      manual = false;
    });
    autoUpdater.on('update-not-available', () => { set({ status: 'idle', version: null, notes: '', message: '' }); manual = false; });
    autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))) }));
    autoUpdater.on('update-downloaded', () => set({ status: 'ready', percent: 100, message: '' }));
    autoUpdater.on('error', (e) => onError(e));
  }

  function start() {
    if (!enabled || state.status !== 'available') return snapshot();
    set({ status: 'downloading', percent: 0, message: '' });
    Promise.resolve().then(() => autoUpdater.downloadUpdate()).catch((e) => onError(e));
    return snapshot();
  }

  function install() {
    if (!enabled || state.status !== 'ready') return snapshot();
    // Silent install of the update the user chose, then PressGO reopens. Settings and staff data
    // live on the server and in the user's profile folder, which the installer does not touch.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return snapshot();
  }

  const guard = (fn) => (event, ...a) => (isTrustedSender(event) ? fn(...a) : snapshot());
  ipcMain.handle('update:get', guard(() => snapshot()));
  ipcMain.handle('update:start', guard(() => start()));
  ipcMain.handle('update:install', guard(() => install()));
  ipcMain.handle('update:check', guard(() => check(true)));

  function schedule() {
    if (!enabled) return;
    const t1 = setTimer(() => { check(false); }, CHECK_FIRST_MS);
    const t2 = setRepeat(() => { check(false); }, CHECK_EVERY_MS);
    if (t1 && t1.unref) t1.unref();
    if (t2 && t2.unref) t2.unref();
  }

  return { state: snapshot, check, start, install, schedule, _set: set };
}

module.exports = { createUpdater, compareVersions, isNewer, plainNotes, friendlyError, CHECK_EVERY_MS, CHECK_FIRST_MS };
