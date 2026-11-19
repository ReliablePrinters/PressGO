'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../../docs/chatlogic.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const J = '33333333-3333-4333-8333-333333333333';

test('chat links: chat, chat + message, job chat; anything else is refused', () => {
  assert.deepStrictEqual(L.parseChatHash('#/chat/' + A), { conv: A, msg: null });
  assert.deepStrictEqual(L.parseChatHash('#/chat/' + A + '/' + B), { conv: A, msg: B });
  assert.deepStrictEqual(L.parseChatHash('#/chat/job/' + J), { job: J });
  for (const bad of ['', null, undefined, '#/chat', '#/chat/', '#/chat/nope', '#/chat/' + A + '/nope', '#/chat/' + A + '/' + B + '/extra', '#/jobs', '#/chat/' + A + '?x=1']) {
    assert.strictEqual(L.parseChatHash(bad), null, String(bad));
  }
});

test('chatHref only builds links from real ids', () => {
  assert.strictEqual(L.chatHref(A), '#/chat/' + A);
  assert.strictEqual(L.chatHref(A, B), '#/chat/' + A + '/' + B);
  assert.strictEqual(L.chatHref(A, 'junk'), '#/chat/' + A, 'a bad message id is dropped, the chat still opens');
  assert.strictEqual(L.chatHref('junk', B), null);
  assert.deepStrictEqual(L.parseChatHash(L.chatHref(A, B)), { conv: A, msg: B }, 'what we build we can read back');
});

test('an alert opens the exact message, else the chat, else the job, else nothing', () => {
  assert.strictEqual(L.alertHref({ conversation_id: A, message_id: B, job_id: J }), '#/chat/' + A + '/' + B);
  assert.strictEqual(L.alertHref({ conversation_id: A, message_id: null, job_id: J }), '#/chat/' + A);
  assert.strictEqual(L.alertHref({ conversation_id: null, message_id: null, job_id: J }), '#/job/' + J);
  assert.strictEqual(L.alertHref({ conversation_id: null, message_id: null, job_id: null }), null);
  assert.strictEqual(L.alertHref(null), null);
  assert.strictEqual(L.alertHref({ conversation_id: 'x', job_id: J }), '#/job/' + J, 'a damaged chat id falls back to the job');
});

test('reply quote: who, a one-line preview, deleted and missing originals', () => {
  const q = L.quoteInfo({ id: B, body: 'Please\n  use   the\tgold foil', author: { display_name: 'Priya' } });
  assert.deepStrictEqual(q, { gone: false, who: 'Priya', preview: 'Please use the gold foil', id: B });
  assert.strictEqual(L.quoteInfo({ id: B, body: 'x'.repeat(500), author: { display_name: 'P' } }).preview.length, 140, 'long text is cut');
  assert.strictEqual(L.quoteInfo({ id: B, body: 'Photo', attachment_path: 'a/b.jpg', author: { display_name: 'P' } }).preview, 'Picture');
  assert.strictEqual(L.quoteInfo({ id: B, body: 'proof v2', attachment_path: 'a/b.jpg', author: { display_name: 'P' } }).preview, 'Picture: proof v2');
  const gone = L.quoteInfo({ id: B, body: 'secret', hidden_at: '2026-01-01', author: { display_name: 'P' } });
  assert.deepStrictEqual([gone.gone, gone.who, gone.preview], [true, 'P', 'This message was deleted'], 'a deleted original never shows its old text');
  const none = L.quoteInfo(null);
  assert.strictEqual(none.gone, true);
  assert.match(none.preview, /not available/);
});

test('unread marker: first message from someone else after you last read', () => {
  const me = 'me';
  const msgs = [
    { author_id: 'x', sent_at: '2026-05-01T09:00:00Z' },
    { author_id: me, sent_at: '2026-05-01T09:10:00Z' },
    { author_id: 'x', sent_at: '2026-05-01T09:20:00Z' },
    { author_id: 'y', sent_at: '2026-05-01T09:30:00Z' },
  ];
  assert.strictEqual(L.firstUnreadIndex(msgs, '2026-05-01T09:15:00Z', me), 2);
  assert.strictEqual(L.firstUnreadIndex(msgs, '2026-05-01T09:30:00Z', me), -1, 'nothing after the last read');
  assert.strictEqual(L.firstUnreadIndex(msgs, '2026-04-30T00:00:00Z', me), 0);
  assert.strictEqual(L.firstUnreadIndex([{ author_id: me, sent_at: '2026-05-01T09:50:00Z' }], '2026-05-01T09:00:00Z', me), -1, 'your own messages are never unread');
  assert.strictEqual(L.firstUnreadIndex(msgs, null, me), -1, 'never opened: no marker');
  assert.strictEqual(L.firstUnreadIndex(msgs, 'garbage', me), -1);
});

test('how many messages to load so the one you want is in the list', () => {
  assert.strictEqual(L.windowSize(0), 200);
  assert.strictEqual(L.windowSize(150), 200);
  assert.strictEqual(L.windowSize(300), 320);
  assert.strictEqual(L.windowSize(5000), 600, 'never the whole history');
});

test('alerts: unread and all views', () => {
  const list = [{ id: 1, read_at: null }, { id: 2, read_at: 'x' }, { id: 3, read_at: null }];
  assert.deepStrictEqual(L.view(list, 'unread').map((n) => n.id), [1, 3]);
  assert.deepStrictEqual(L.view(list, 'all').map((n) => n.id), [1, 2, 3]);
  assert.deepStrictEqual(L.view(null, 'all'), []);
});

test('alert grouping: same kind in the same chat or job, side by side; nothing else', () => {
  const n = (id, kind, conv, job, read) => ({ id, kind, conversation_id: conv, job_id: job, read_at: read ? 'r' : null });
  const list = [
    n(1, 'reply', A, null, false), n(2, 'reply', A, null, false), n(3, 'reply', A, null, true),
    n(4, 'approved', A, J, false),
    n(5, 'reply', B, null, false),
    n(6, 'assigned', null, null, false), n(7, 'assigned', null, null, false),   // no chat or job: never grouped
    n(8, 'reply', A, null, false),                                             // same as the first, but not adjacent
  ];
  const g = L.groupAlerts(list);
  assert.deepStrictEqual(g.map((x) => x.items.map((i) => i.id)), [[1, 2, 3], [4], [5], [6], [7], [8]]);
  assert.strictEqual(g[0].unread, 2);
  assert.strictEqual(g[0].latest.id, 1, 'the newest alert represents the group');
  assert.deepStrictEqual(L.groupAlerts([]), []);
});

test('sound rules: never your own, never deleted, not for the chat you are reading, respects the setting', () => {
  const row = { author_id: 'x', conversation_id: A };
  const dm = { type: 'direct' }, gen = { type: 'general' }, urg = { type: 'urgent' };
  const base = { meId: 'me', row, conv: dm, mode: 'dm', currentConv: B, visible: true, focused: true };
  assert.strictEqual(L.shouldPlaySound(base), true, 'a private message in another chat');
  assert.strictEqual(L.shouldPlaySound({ ...base, row: { ...row, author_id: 'me' } }), false, 'your own message');
  assert.strictEqual(L.shouldPlaySound({ ...base, row: { ...row, hidden_at: 'x' } }), false, 'a deleted message');
  assert.strictEqual(L.shouldPlaySound({ ...base, currentConv: A }), false, 'you are reading that chat right now');
  assert.strictEqual(L.shouldPlaySound({ ...base, currentConv: A, focused: false }), true, 'same chat, but you are in another window');
  assert.strictEqual(L.shouldPlaySound({ ...base, currentConv: A, visible: false }), true, 'same chat, but the window is hidden');
  assert.strictEqual(L.shouldPlaySound({ ...base, conv: gen }), false, 'a general channel is quiet in the default mode');
  assert.strictEqual(L.shouldPlaySound({ ...base, conv: urg }), true, 'Urgent always counts');
  assert.strictEqual(L.shouldPlaySound({ ...base, conv: gen, mode: 'all' }), true);
  assert.strictEqual(L.shouldPlaySound({ ...base, mode: 'off' }), false);
  assert.strictEqual(L.shouldPlaySound(null), false);
  assert.strictEqual(L.shouldPlaySound({ ...base, conv: null }), false, 'an unknown chat is not assumed private');
});

test('window title shows the unread total', () => {
  assert.strictEqual(L.titleWith('PressGO', 0, 0), 'PressGO');
  assert.strictEqual(L.titleWith('PressGO', 2, 1), '(3) PressGO');
  assert.strictEqual(L.titleWith('PressGO', 150, 0), '(99+) PressGO');
  assert.strictEqual(L.titleWith('PressGO', '2', undefined), '(2) PressGO');
});
