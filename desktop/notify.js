'use strict';
// Shows Windows desktop notifications for PressGO and brings the right chat to the front when one is clicked.
// The PressGO page decides WHAT is worth a notification (new message, not yours, you are away).
// This side only checks the request is safe, shows it, and handles the click. It holds no keys and talks to no server.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_WINDOW = 5;            // never more than 5 pop-ups in 10 seconds, whatever the page asks
const WINDOW_MS = 10 * 1000;

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function createNotifier({ Notification, ipcMain, getWindow, isTrustedSender, now = Date.now }) {
  const alive = new Set();            // keeps each notification object until it is closed
  const times = [];

  function windowIsInUse() {
    const w = getWindow();
    return !!(w && !w.isDestroyed() && w.isVisible() && !w.isMinimized() && w.isFocused());
  }

  function bringToFront(conv) {
    const w = getWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    if (conv) w.webContents.send('notify:open', { conv });
  }

  function show(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'bad-request' };
    if (!Notification || !Notification.isSupported()) return { ok: false, reason: 'unsupported' };
    const title = clean(payload.title, 80), body = clean(payload.body, 200);
    const conv = typeof payload.conv === 'string' && UUID.test(payload.conv) ? payload.conv : null;
    if (!title) return { ok: false, reason: 'bad-request' };
    if (payload.test !== true && windowIsInUse()) return { ok: false, reason: 'in-use' };   // already looking at PressGO
    const t = now();
    while (times.length && t - times[0] > WINDOW_MS) times.shift();
    if (times.length >= MAX_PER_WINDOW) return { ok: false, reason: 'rate-limited' };
    times.push(t);
    const n = new Notification({ title, body, silent: false });
    alive.add(n);
    n.on('click', () => { bringToFront(conv); alive.delete(n); });
    n.on('close', () => alive.delete(n));
    n.on('failed', () => alive.delete(n));
    n.show();
    return { ok: true };
  }

  const guard = (fn) => (event, ...a) => (isTrustedSender(event) ? fn(...a) : { ok: false, reason: 'untrusted' });
  ipcMain.handle('notify:show', guard((p) => show(p)));
  ipcMain.handle('notify:supported', guard(() => ({ supported: !!(Notification && Notification.isSupported()) })));

  return { show, bringToFront };
}

module.exports = { createNotifier, clean, UUID };
