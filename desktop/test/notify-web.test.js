'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createCore } = require('../../docs/notify.js');

const ME = 'me-1', BOB = 'bob-2', ANN = 'ann-3';
const NAMES = { [BOB]: 'Bob Marley', [ANN]: 'Ann Lee' };
const DM = { id: 'c-dm', type: 'direct', name: 'Bob Marley' }, GEN = { id: 'c-gen', type: 'general', name: 'General' };
const URG = { id: 'c-urg', type: 'urgent', name: 'Urgent' }, JOB = { id: 'c-job', type: 'job', name: 'Job #1042 · Kingston Bakery' };

function rig(o = {}) {
  const shown = [];
  let away = o.away !== false;
  const timers = [];
  const core = createCore({
    bridge: { show: (p) => shown.push(p) },
    getPrefs: () => ({ mode: 'dm', preview: true, ...(o.prefs || {}) }),
    getName: async (id) => NAMES[id] || '',
    isAway: () => away,
    setTimer: (f) => { timers.push(f); return timers.length; },
    now: () => Date.parse('2026-10-09T12:00:00Z')
  });
  let seq = 0;
  const msg = (author, conv, body, x = {}) => ({ id: x.id || 'm' + ++seq, conversation_id: conv.id, author_id: author, body, sent_at: '2026-10-09T12:00:01Z', attachment_path: null, hidden_at: null, ...x });
  return { core, shown, msg, setAway: (v) => { away = v; }, flush: async () => { const f = timers.splice(0); for (const t of f) await t(); await core.flush(); } };
}

test('away + private message: one notification with sender name and preview', async () => {
  const r = rig();
  r.core.message(r.msg(BOB, DM, 'Can you check the proof?'), DM, ME);
  await r.flush();
  assert.deepEqual(r.shown, [{ title: 'Bob Marley', body: 'Can you check the proof?', conv: 'c-dm' }]);
});

test('actively using PressGO: no notification', async () => {
  const r = rig({ away: false });
  r.core.message(r.msg(BOB, DM, 'hi'), DM, ME);
  await r.flush();
  assert.equal(r.shown.length, 0);
});

test('you came back while the message was waiting to be shown: dropped', async () => {
  const r = rig();
  r.core.message(r.msg(BOB, DM, 'hi'), DM, ME);
  r.setAway(false);
  await r.flush();
  assert.equal(r.shown.length, 0);
});

test('same message twice (reconnect, double event): one notification', async () => {
  const r = rig();
  const m = r.msg(BOB, DM, 'once', { id: 'same' });
  r.core.message(m, DM, ME); r.core.message(m, DM, ME); r.core.message({ ...m }, DM, ME);
  await r.flush();
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].body, 'once');
});

test('burst of messages in one chat becomes one notification', async () => {
  const r = rig();
  for (let i = 1; i <= 6; i++) r.core.message(r.msg(BOB, DM, 'msg ' + i), DM, ME);
  await r.flush();
  assert.equal(r.shown.length, 1);
  assert.equal(r.shown[0].title, '6 new messages from Bob Marley');
  assert.equal(r.shown[0].body, 'Latest: msg 6');
});

test('several chats: one each; a flood across many chats: one summary', async () => {
  const r = rig({ prefs: { mode: 'all' } });
  r.core.message(r.msg(BOB, DM, 'a'), DM, ME); r.core.message(r.msg(ANN, URG, 'b'), URG, ME);
  await r.flush();
  assert.equal(r.shown.length, 2);
  const r2 = rig({ prefs: { mode: 'all' } });
  [DM, URG, GEN, JOB].forEach((c) => r2.core.message(r2.msg(BOB, c, 'x'), c, ME));
  await r2.flush();
  assert.equal(r2.shown.length, 1);
  assert.equal(r2.shown[0].body, '4 new messages in 4 chats');
});

test('never your own messages, never hidden ones', async () => {
  const r = rig();
  r.core.message(r.msg(ME, DM, 'mine'), DM, ME);
  r.core.message(r.msg(BOB, DM, 'gone', { hidden_at: '2026-10-09T12:00:05Z' }), DM, ME);
  await r.flush();
  assert.equal(r.shown.length, 0);
});

test('default mode: private and Urgent only; All chats includes General and job chats', async () => {
  const r = rig();
  r.core.message(r.msg(BOB, GEN, 'g'), GEN, ME); r.core.message(r.msg(BOB, JOB, 'j'), JOB, ME);
  r.core.message(r.msg(ANN, URG, 'u'), URG, ME);
  await r.flush();
  assert.deepEqual(r.shown.map((s) => s.conv), ['c-urg']);
  const a = rig({ prefs: { mode: 'all' } });
  a.core.message(a.msg(BOB, GEN, 'g'), GEN, ME); a.core.message(a.msg(BOB, JOB, 'j'), JOB, ME);
  await a.flush();
  assert.deepEqual(a.shown.map((s) => s.title), ['Bob Marley in #General', 'Bob Marley in Job #1042 · Kingston Bakery']);
});

test('off means off', async () => {
  const r = rig({ prefs: { mode: 'off' } });
  r.core.message(r.msg(BOB, DM, 'hi'), DM, ME);
  await r.flush();
  assert.equal(r.shown.length, 0);
});

test('privacy: preview off shows the sender but never the text', async () => {
  const r = rig({ prefs: { preview: false } });
  r.core.message(r.msg(BOB, DM, 'secret pricing details'), DM, ME);
  await r.flush();
  assert.deepEqual(r.shown, [{ title: 'Bob Marley', body: 'New message', conv: 'c-dm' }]);
  const r2 = rig({ prefs: { preview: false } });
  r2.core.message(r2.msg(BOB, DM, 'a'), DM, ME); r2.core.message(r2.msg(BOB, DM, 'secret b'), DM, ME);
  await r2.flush();
  assert.ok(!JSON.stringify(r2.shown).includes('secret'));
});

test('pictures, long text, and markup are shown safely as plain short text', async () => {
  const r = rig();
  r.core.message(r.msg(BOB, DM, 'Photo', { attachment_path: 'p/1' }), DM, ME);
  await r.flush();
  assert.equal(r.shown[0].body, 'Sent a picture');
  const r2 = rig();
  r2.core.message(r2.msg(BOB, DM, '<b>hi</b>\n\n' + 'x'.repeat(500)), DM, ME);
  await r2.flush();
  assert.ok(r2.shown[0].body.length <= 100);
  assert.ok(!r2.shown[0].body.includes('\n'));
});

test('old messages (before PressGO started) are not "new"', async () => {
  const r = rig();
  r.core.message(r.msg(BOB, DM, 'ancient', { sent_at: '2026-10-09T09:00:00Z' }), DM, ME);
  await r.flush();
  assert.equal(r.shown.length, 0);
});

test('no desktop bridge (normal browser): does nothing and cannot crash', () => {
  const core = createCore({ bridge: null, getPrefs: () => ({ mode: 'all', preview: true }), getName: async () => '', isAway: () => true });
  assert.doesNotThrow(() => core.message({ id: 'x', conversation_id: 'c', author_id: 'a' }, {}, 'me'));
});
