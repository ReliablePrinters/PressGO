'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createNotifier } = require('../notify');

const CONV = '11111111-1111-1111-1111-111111111111';
function rig(o = {}) {
  const shown = [];
  class N extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; }
    show() { shown.push(this); }
    static isSupported() { return o.supported !== false; }
  }
  const sent = [];
  const win = {
    st: { visible: true, minimized: false, focused: false, destroyed: false, calls: [] },
    isDestroyed() { return this.st.destroyed; }, isVisible() { return this.st.visible; }, isMinimized() { return this.st.minimized; }, isFocused() { return this.st.focused; },
    restore() { this.st.minimized = false; this.st.calls.push('restore'); }, show() { this.st.visible = true; this.st.calls.push('show'); }, focus() { this.st.focused = true; this.st.calls.push('focus'); },
    webContents: { send: (c, d) => sent.push([c, d]) }
  };
  const handlers = {};
  let t = 1000;
  const n = createNotifier({ Notification: N, ipcMain: { handle: (c, f) => { handlers[c] = f; } }, getWindow: () => win, isTrustedSender: (e) => e.ok === true, now: () => t });
  return { n, shown, win, sent, call: (c, p, ok = true) => handlers[c]({ ok }, p), tick: (ms) => { t += ms; } };
}

test('shows a native notification with the sender and preview', () => {
  const r = rig();
  const res = r.n.show({ title: 'Marcia Brown', body: 'Proof is approved', conv: CONV });
  assert.deepEqual(res, { ok: true });
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].opts.title, 'Marcia Brown');
  assert.equal(r.shown[0].opts.body, 'Proof is approved');
});

test('clicking restores a minimized window, focuses it, and opens that conversation', () => {
  const r = rig();
  r.win.st.minimized = true; r.win.st.focused = false;
  r.n.show({ title: 'Marcia', body: 'hi', conv: CONV });
  r.shown[0].emit('click');
  assert.deepEqual(r.win.st.calls, ['restore', 'show', 'focus']);
  assert.deepEqual(r.sent, [['notify:open', { conv: CONV }]]);
});

test('a notification without a conversation (test) just brings PressGO forward', () => {
  const r = rig();
  r.n.show({ title: 'PressGO', body: 'test', conv: null, test: true });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, []);
  assert.ok(r.win.st.calls.includes('focus'));
});

test('does not notify while PressGO is the window being used', () => {
  const r = rig();
  r.win.st.focused = true;
  assert.deepEqual(r.n.show({ title: 'A', body: 'b', conv: CONV }), { ok: false, reason: 'in-use' });
  assert.equal(r.shown.length, 0);
  assert.equal(r.n.show({ title: 'PressGO', body: 'test', conv: null, test: true }).ok, true);   // the test button still works
});

test('rejects bad requests and strange conversation ids', () => {
  const r = rig();
  assert.equal(r.n.show(null).ok, false);
  assert.equal(r.n.show({ title: '', body: 'x' }).ok, false);
  r.n.show({ title: 'A', body: 'b', conv: '../../evil' });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, []);                          // an invalid id is dropped, never forwarded
});

test('cleans and shortens text', () => {
  const r = rig();
  r.n.show({ title: 'A\u0000\n\nB'.padEnd(500, 'x'), body: ('line1\n\nline2 ').repeat(100), conv: CONV });
  assert.ok(r.shown[0].opts.title.length <= 80);
  assert.ok(r.shown[0].opts.body.length <= 200);
  assert.ok(!/[\u0000-\u001f]/.test(r.shown[0].opts.title + r.shown[0].opts.body));
});

test('flood protection: at most 5 in 10 seconds', () => {
  const r = rig();
  const out = Array.from({ length: 8 }, (_, i) => r.n.show({ title: 'T' + i, body: '', conv: CONV }));
  assert.equal(out.filter((x) => x.ok).length, 5);
  assert.equal(out[7].reason, 'rate-limited');
  r.tick(11000);
  assert.equal(r.n.show({ title: 'later', body: '', conv: CONV }).ok, true);
});

test('only the real PressGO page can ask; unsupported systems fail quietly', async () => {
  const r = rig();
  assert.equal((await r.call('notify:show', { title: 'x', body: 'y' }, false)).reason, 'untrusted');
  assert.equal(r.shown.length, 0);
  assert.equal((await r.call('notify:show', { title: 'x', body: 'y', conv: CONV }, true)).ok, true);
  const u = rig({ supported: false });
  assert.equal(u.n.show({ title: 'x', body: 'y' }).reason, 'unsupported');
});
