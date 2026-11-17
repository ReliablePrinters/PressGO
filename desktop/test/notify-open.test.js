'use strict';
// A Windows notification can now open the exact message (or a job), and flashes the taskbar when it appears.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createNotifier } = require('../notify');

const CONV = '11111111-1111-4111-8111-111111111111';
const MSG = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

function rig(o = {}) {
  const shown = [], sent = [], flashes = [];
  class N extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; }
    show() { shown.push(this); }
    static isSupported() { return true; }
  }
  const win = {
    st: { visible: true, minimized: false, focused: false, destroyed: false },
    isDestroyed() { return this.st.destroyed; }, isVisible() { return this.st.visible; }, isMinimized() { return this.st.minimized; }, isFocused() { return this.st.focused; },
    restore() { this.st.minimized = false; }, show() { this.st.visible = true; }, focus() { this.st.focused = true; },
    flashFrame(on) { if (o.flashThrows) throw new Error('no taskbar'); flashes.push(on); },
    webContents: { send: (c, d) => sent.push([c, d]) },
  };
  const n = createNotifier({ Notification: N, ipcMain: { handle() {} }, getWindow: () => win, isTrustedSender: () => true, now: () => 1000 });
  return { n, shown, sent, flashes, win };
}

test('clicking opens the exact message in its chat', () => {
  const r = rig();
  r.n.show({ title: 'Priya', body: 'Approved', conv: CONV, msg: MSG });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, [['notify:open', { conv: CONV, msg: MSG }]]);
});

test('without a message the old behaviour is unchanged: just the chat', () => {
  const r = rig();
  r.n.show({ title: 'Priya', body: 'hi', conv: CONV });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, [['notify:open', { conv: CONV }]]);
});

test('a damaged message id is dropped, the chat still opens', () => {
  const r = rig();
  r.n.show({ title: 'P', body: 'b', conv: CONV, msg: '../../evil' });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, [['notify:open', { conv: CONV }]]);
});

test('a message id without a chat is never forwarded', () => {
  const r = rig();
  r.n.show({ title: 'P', body: 'b', conv: null, msg: MSG });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, []);
});

test('a job notification opens that job; a damaged job id opens nothing', () => {
  const r = rig();
  r.n.show({ title: 'Assigned', body: 'Job #1042', conv: null, job: JOB });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, [['notify:open', { job: JOB }]]);
  const bad = rig();
  bad.n.show({ title: 'x', body: 'y', job: 'nope' });
  bad.shown[0].emit('click');
  assert.deepEqual(bad.sent, []);
});

test('the chat wins when both a chat and a job are given', () => {
  const r = rig();
  r.n.show({ title: 'P', body: 'b', conv: CONV, msg: MSG, job: JOB });
  r.shown[0].emit('click');
  assert.deepEqual(r.sent, [['notify:open', { conv: CONV, msg: MSG }]]);
});

test('the taskbar flashes for a real notification, not for the test button', () => {
  const r = rig();
  r.n.show({ title: 'P', body: 'b', conv: CONV });
  assert.deepEqual(r.flashes, [true]);
  r.n.show({ title: 'PressGO', body: 'test', conv: null, test: true });
  assert.deepEqual(r.flashes, [true], 'the test notification does not flash');
});

test('no flash when nothing is shown (window in use), and a failing flash never breaks the notification', () => {
  const r = rig();
  r.win.st.focused = true;
  assert.equal(r.n.show({ title: 'P', body: 'b', conv: CONV }).reason, 'in-use');
  assert.deepEqual(r.flashes, []);
  const t = rig({ flashThrows: true });
  assert.equal(t.n.show({ title: 'P', body: 'b', conv: CONV }).ok, true);
  assert.equal(t.shown.length, 1);
});
