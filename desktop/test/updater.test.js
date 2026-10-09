'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createUpdater, compareVersions, isNewer, plainNotes, friendlyError } = require('../updater');

function rig(opts = {}) {
  const au = new EventEmitter();
  au.calls = [];
  au.checkForUpdates = async () => { au.calls.push('check'); if (opts.checkFails) throw Object.assign(new Error(opts.checkFails), {}); };
  au.downloadUpdate = async () => { au.calls.push('download'); if (opts.downloadFails) throw new Error(opts.downloadFails); };
  au.quitAndInstall = (...a) => au.calls.push(['install', ...a]);
  const handlers = {};
  const ipcMain = { handle: (c, f) => { handlers[c] = f; } };
  const sent = [];
  const win = { isDestroyed: () => false, webContents: { send: (c, s) => sent.push(s) } };
  let t = 1000000;
  const timers = [];
  const up = createUpdater({
    autoUpdater: au, ipcMain, getWindow: () => win, enabled: opts.enabled !== false, currentVersion: opts.current || '1.1.0',
    isTrustedSender: (e) => e.ok === true, now: () => t,
    setTimer: (f, ms) => { timers.push(['once', ms, f]); return {}; }, setRepeat: (f, ms) => { timers.push(['every', ms, f]); return {}; }
  });
  const call = (ch, ok = true) => handlers[ch]({ ok });
  return { au, up, call, sent, timers, advance: (ms) => { t += ms; } };
}

test('version comparison: older and identical are never newer', () => {
  assert.equal(isNewer('1.2.0', '1.1.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.0'), true);      // not a text comparison
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
  assert.equal(isNewer('1.1.0', '1.1.0'), false);
  assert.equal(isNewer('1.0.0', '1.1.0'), false);
  assert.equal(isNewer('1.1.0-beta.1', '1.1.0'), false);
  assert.equal(isNewer('1.1.0', '1.1.0-beta.1'), true);
  assert.equal(isNewer('v1.2.0', '1.1.0'), true);
  assert.equal(isNewer('garbage', '1.1.0'), false);
  assert.equal(isNewer(undefined, '1.1.0'), false);
  assert.equal(compareVersions('1.2.3-alpha.2', '1.2.3-alpha.10'), -1);
});

test('up to date: no button state, nothing downloaded', async () => {
  const r = rig();
  r.au.checkForUpdates = async () => { r.au.emit('update-not-available', { version: '1.1.0' }); };
  const s = await r.up.check(true);
  assert.equal(s.status, 'idle');
  assert.deepEqual(r.au.calls, []);
});

test('library reporting an older or same version is ignored (no button)', async () => {
  for (const v of ['1.0.0', '1.1.0', '0.9.9']) {
    const r = rig();
    r.au.checkForUpdates = async () => { r.au.emit('update-available', { version: v }); };
    const s = await r.up.check(true);
    assert.equal(s.status, 'idle', v);
  }
});

test('update available: shows version and short plain-text summary, still downloads nothing', async () => {
  const r = rig();
  r.au.checkForUpdates = async () => { r.au.emit('update-available', { version: '1.2.0', releaseNotes: '<h2>New</h2><p>Faster <b>chat</b> &amp; fixes</p><script>alert(1)</script>' }); };
  const s = await r.up.check(false);
  assert.equal(s.status, 'available');
  assert.equal(s.version, '1.2.0');
  assert.ok(!/[<>]/.test(s.notes), s.notes);
  assert.ok(s.notes.includes('Faster chat & fixes'));
  assert.ok(!r.au.calls.includes('download'));
  assert.equal(r.au.autoDownload, false);
});

test('download only after the click, then progress, ready, and install only when ready', async () => {
  const r = rig();
  r.au.checkForUpdates = async () => { r.au.emit('update-available', { version: '1.2.0' }); };
  await r.up.check(true);
  assert.equal((await r.call('update:install')).status, 'available');   // install before download does nothing
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(r.au.calls.filter((c) => Array.isArray(c)), []);
  const s = await r.call('update:start');
  assert.equal(s.status, 'downloading');
  await new Promise((x) => setImmediate(x));
  assert.ok(r.au.calls.includes('download'));
  r.au.emit('download-progress', { percent: 41.6 });
  assert.equal(r.up.state().percent, 42);
  r.au.emit('update-downloaded', { version: '1.2.0' });
  assert.equal(r.up.state().status, 'ready');
  await r.call('update:install');
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(r.au.calls.at(-1), ['install', true, true]);
  assert.ok(r.sent.some((x) => x.status === 'downloading') && r.sent.some((x) => x.status === 'ready'));
});

test('start is ignored when no update is available', async () => {
  const r = rig();
  await r.call('update:start');
  await new Promise((x) => setImmediate(x));
  assert.ok(!r.au.calls.includes('download'));
});

test('failed download shows a clear message and can be retried', async () => {
  const r = rig({ downloadFails: 'ECONNRESET while downloading' });
  r.au.checkForUpdates = async () => { r.au.emit('update-available', { version: '1.2.0' }); };
  await r.up.check(true);
  await r.call('update:start');
  await new Promise((x) => setImmediate(x)); await new Promise((x) => setImmediate(x));
  const s = r.up.state();
  assert.equal(s.status, 'error');
  assert.match(s.message, /internet connection/);
  r.advance(120000);
  await r.call('update:check');            // "Try again"
  assert.equal(r.up.state().status, 'available');
});

test('integrity failure is reported and nothing is installed', async () => {
  const r = rig();
  r.au.checkForUpdates = async () => { r.au.emit('update-available', { version: '1.2.0' }); };
  await r.up.check(true);
  await r.call('update:start');
  r.au.emit('error', new Error('sha512 checksum mismatch, expected abc, got def'));
  const s = r.up.state();
  assert.equal(s.status, 'error');
  assert.match(s.message, /safety check/);
  await r.call('update:install');
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(r.au.calls.filter((c) => Array.isArray(c)), []);
});

test('background check while offline stays silent; a clicked check shows the problem', async () => {
  const r = rig({ checkFails: 'net::ERR_INTERNET_DISCONNECTED' });
  let s = await r.up.check(false);
  assert.equal(s.status, 'idle');
  assert.equal(s.message, '');
  r.advance(120000);
  s = await r.up.check(true);
  assert.equal(s.status, 'error');
  assert.match(s.message, /internet connection/);
});

test('release not published yet (404) gives a calm message', () => {
  assert.match(friendlyError(new Error('Cannot find latest.yml in the latest release artifacts (404)')), /not available/);
});

test('background checks are rate limited and never interrupt a download', async () => {
  const r = rig();
  let n = 0;
  r.au.checkForUpdates = async () => { n++; };
  await r.up.check(false); await r.up.check(false);
  assert.equal(n, 1);
  r.advance(61000);
  r.au.emit('download-progress', { percent: 10 });
  await r.up.check(false);
  assert.equal(n, 1);
});

test('only the real PressGO page may use the updater', async () => {
  const r = rig();
  r.au.checkForUpdates = async () => { r.au.emit('update-available', { version: '1.2.0' }); };
  await r.up.check(true);
  await r.call('update:start', false);
  await new Promise((x) => setImmediate(x));
  assert.ok(!r.au.calls.includes('download'));
  assert.equal(r.up.state().status, 'available');
});

test('checks on launch (15s) and every 30 minutes', () => {
  const r = rig();
  r.up.schedule();
  assert.deepEqual(r.timers.map((t) => [t[0], t[1]]), [['once', 15000], ['every', 1800000]]);
});

test('disabled copy (portable zip / developer run): no checks, no button, install does nothing', async () => {
  const r = rig({ enabled: false });
  r.up.schedule();
  assert.equal(r.timers.length, 0);
  const s = await r.up.check(true);
  assert.equal(s.status, 'disabled');
  await r.call('update:start'); await r.call('update:install');
  await new Promise((x) => setImmediate(x));
  assert.deepEqual(r.au.calls, []);
});

test('notes are truncated and stripped to plain text', () => {
  assert.equal(plainNotes(null), '');
  assert.ok(plainNotes('x'.repeat(1000)).length <= 300);
  assert.equal(plainNotes([{ note: '[Link](http://evil) **bold**' }]), 'Link bold');
});
