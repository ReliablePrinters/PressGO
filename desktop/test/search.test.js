'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../docs/searchlogic.js');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

test('what counts as a query', () => {
  assert.strictEqual(S.normalize('  Harbour   Cafe  '), 'Harbour Cafe');
  assert.strictEqual(S.normalize(null), '');
  assert.strictEqual(S.normalize('x'.repeat(200)).length, 80, 'long input is cut');
  assert.ok(!S.ready('a') && !S.ready('') && !S.ready('  ') && !S.ready('--') && !S.ready('%%'), 'too short, or no letters or digits');
  assert.ok(S.ready('ab') && S.ready('10') && S.ready('Harbour'));
  assert.deepStrictEqual(S.words('red  ink  & more'), ['red', 'ink', 'more'], 'symbols alone are not words');
  assert.strictEqual(S.words('a b c d e f g').length, S.MAX_TOKENS);
});

test('job numbers are recognised in the ways people type them', () => {
  for (const q of ['1002', '#1002', 'job 1002', 'Job #1002', 'JOB1002', ' # 1002 ']) assert.strictEqual(S.jobNumberOf(q), 1002, q);
  for (const q of ['', 'harbour 1002', '1002 harbour', 'job', '10.5', '#']) assert.strictEqual(S.jobNumberOf(q), null, q);
});

test('wildcards typed by a person never act as wildcards', () => {
  assert.strictEqual(S.escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  assert.strictEqual(S.likeFor('a_b'), '%a\\_b%');
  assert.strictEqual(S.orSafe('a,b(c)"d\'e%f_g*h:i'), 'abcdefghi', 'characters that structure a filter list are removed');
  assert.deepStrictEqual(S.orSafeWords('Smith, (Jones) %'), ['Smith', 'Jones']);
});

test('highlighting is case-insensitive, covers every word, and is safe to put on screen', () => {
  const p = S.highlight('Harbour Cafe menu', 'cafe HARBOUR');
  assert.deepStrictEqual(p.filter((x) => x.hit).map((x) => x.t), ['Harbour', 'Cafe']);
  assert.strictEqual(p.map((x) => x.t).join(''), 'Harbour Cafe menu', 'no text is lost');
  const h = S.highlight('a <b>bold</b> move', 'bold');
  assert.strictEqual(h.map((x) => x.t).join(''), 'a <b>bold</b> move', 'tags stay as plain text parts for the screen to escape');
  assert.deepStrictEqual(S.highlight('abc', ''), [{ t: 'abc', hit: false }]);
  assert.deepStrictEqual(S.highlight('', 'x'), [{ t: '', hit: false }]);
  assert.deepStrictEqual(S.highlight('aaaa', 'aa').map((x) => x.t), ['aaaa'], 'overlaps merge');
});

test('a message preview is centred on the match and never starts mid-word', () => {
  const long = 'The quick brown fox jumps over the lazy dog while the proof was waiting for approval from the front desk and everyone was busy and the phones kept ringing all through the afternoon until the shop finally closed for the night';
  const s = S.snippet(long, 'approval');
  const text = s.map((x) => x.t).join('');
  assert.ok(text.startsWith('…') && text.endsWith('…'), 'ellipsis at both cut ends');
  assert.ok(s.some((x) => x.hit && x.t.toLowerCase() === 'approval'), 'the match is inside the preview');
  assert.ok(text.length <= 145);
  const short = S.snippet('short one', 'short');
  assert.strictEqual(short.map((x) => x.t).join(''), 'short one');
  assert.strictEqual(S.snippet('line one\nline two', 'two').map((x) => x.t).join(''), 'line one line two', 'line breaks become spaces');
});

test('job ranking: exact number first, then customer match, open work before finished work', () => {
  const j = (n, c, st, extra) => ({ id: 'id' + n, job_number: n, customer_name: c, lifecycle_status: st, priority: 'Normal', due_at: '2026-11-20T10:00:00Z', ...extra });
  const rows = [j(1010, 'Cafe Done', 'Collected'), j(1002, 'Harbour Cafe', 'New'), j(1003, 'Other', 'In Production', { description: 'harbour' }), j(1004, 'Harbour Ltd', 'Queued')];
  assert.strictEqual(S.rankJobs(rows, '1003')[0].job_number, 1003);
  const byName = S.rankJobs(rows, 'harbour').map((r) => r.job_number);
  assert.deepStrictEqual(byName.slice(0, 2).sort(), [1002, 1004], 'customers that start with the word come first');
  assert.strictEqual(byName[byName.length - 1], 1010, 'a finished job is last');
  assert.strictEqual(S.uniqueById([{ id: 1 }, { id: 1 }, { id: 2 }]).length, 2);
});

test('conversations and people', () => {
  const convs = [{ id: 'a', type: 'general', name: 'General' }, { id: 'b', type: 'direct', name: 'Priya Shah' }, { id: 'c', type: 'job', name: 'Job #1002 · Harbour Cafe' }];
  assert.deepStrictEqual(S.filterConvs(convs, 'harbour 1002').map((c) => c.id), ['c'], 'every word must match');
  assert.deepStrictEqual(S.filterConvs(convs, 'GEN').map((c) => c.id), ['a']);
  assert.deepStrictEqual(S.filterConvs([{ name: 'x' }, null], 'x'), [], 'entries without an id are ignored');
  const people = [{ display_name: 'Priya Shah' }, { display_name: 'Tom' }];
  assert.deepStrictEqual(S.dedupePeople(people, convs).map((p) => p.display_name), ['Tom'], 'someone you already chat with appears once, as the chat');
  assert.strictEqual(S.roleOf({ manager_role: true, front_desk: true }), 'Manager · Front Desk');
  assert.strictEqual(S.roleOf({}), 'Staff');
});

test('groups keep a fixed order and the arrow keys wrap', () => {
  const res = { messages: [{ id: 'm' }], jobs: [{ id: 'j1' }, { id: 'j2' }], people: [], convs: [{ id: 'c' }], errors: {} };
  const g = S.groupsOf(res);
  assert.deepStrictEqual(g.map((x) => x.key), ['jobs', 'convs', 'messages'], 'empty groups are not shown; order is jobs, people, conversations, messages');
  assert.deepStrictEqual(S.flatten(g).map((x) => x.id), ['j1', 'j2', 'c', 'm']);
  assert.strictEqual(S.groupsOf({ ...res, people: [], errors: { people: 'x' } }).some((x) => x.key === 'people' && x.error), true, 'a failed group is still shown, with its error');
  assert.strictEqual(S.move(-1, 1, 4), 0);
  assert.strictEqual(S.move(-1, -1, 4), 3);
  assert.strictEqual(S.move(3, 1, 4), 0, 'Down on the last result goes to the first');
  assert.strictEqual(S.move(0, -1, 4), 3, 'Up on the first goes to the last');
  assert.strictEqual(S.move(1, 1, 4), 2);
  assert.strictEqual(S.move(0, 1, 0), -1, 'nothing to move to');
});

test('screen-reader announcements', () => {
  assert.strictEqual(S.announce('results', 1, 'x'), '1 result');
  assert.strictEqual(S.announce('results', 5, 'x'), '5 results');
  assert.strictEqual(S.announce('results', 0, ' no  match '), 'No results for no match');
  assert.strictEqual(S.announce('loading', 0, ''), 'Searching');
  assert.strictEqual(S.announce('error', 0, ''), 'Search failed');
  assert.strictEqual(S.announce('idle', 0, ''), '');
});

test('Ctrl+K never hijacks typing, other windows or other key combinations', () => {
  const ev = (o) => ({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, repeat: false, ...o });
  const ctx = (o) => ({ signedIn: true, modalOpen: false, typing: false, ...o });
  assert.ok(S.shouldOpen(ev(), ctx()), 'Ctrl+K opens');
  assert.ok(S.shouldOpen(ev({ key: 'K' }), ctx()), 'capital K (caps lock) too');
  assert.ok(S.shouldOpen(ev({ ctrlKey: false, metaKey: true }), ctx()), 'Command+K on a Mac');
  assert.ok(!S.shouldOpen(ev(), ctx({ typing: true })), 'not while typing');
  assert.ok(!S.shouldOpen(ev(), ctx({ signedIn: false })), 'not on the sign-in screen');
  assert.ok(!S.shouldOpen(ev(), ctx({ modalOpen: true })), 'not over another open window');
  assert.ok(!S.shouldOpen(ev({ shiftKey: true }), ctx()), 'Ctrl+Shift+K is not ours');
  assert.ok(!S.shouldOpen(ev({ altKey: true }), ctx()));
  assert.ok(!S.shouldOpen(ev({ ctrlKey: false }), ctx()), 'plain K');
  assert.ok(!S.shouldOpen(ev({ key: 'j' }), ctx()));
  assert.ok(!S.shouldOpen(ev({ repeat: true }), ctx()), 'holding the keys down does not reopen');
  assert.ok(!S.shouldOpen(null, ctx()) && !S.shouldOpen(ev(), null));
});

test('what counts as typing', () => {
  const el = (tagName, o) => ({ tagName, ...o });
  for (const e of [el('INPUT', { type: 'text' }), el('INPUT', {}), el('INPUT', { type: 'search' }), el('INPUT', { type: 'email' }), el('INPUT', { type: 'password' }), el('INPUT', { type: 'number' }), el('INPUT', { type: 'datetime-local' }), el('TEXTAREA'), el('SELECT'), el('DIV', { isContentEditable: true })]) {
    assert.ok(S.isTypingTarget(e), JSON.stringify(e));
  }
  for (const e of [el('BUTTON'), el('A'), el('BODY'), el('DIV'), el('INPUT', { type: 'checkbox' }), el('INPUT', { type: 'radio' }), el('INPUT', { type: 'file' }), el('INPUT', { type: 'submit' }), null, undefined]) {
    assert.ok(!S.isTypingTarget(e), JSON.stringify(e));
  }
});

test('a late answer never replaces a newer one', () => {
  const g = S.createGate();
  const a = g.next(), b = g.next();
  assert.ok(!g.isLatest(a) && g.isLatest(b));
  g.cancel();
  assert.ok(!g.isLatest(b), 'closing the window cancels what is still running');
});

test('error messages are plain', () => {
  assert.match(S.friendlyError(new Error('TypeError: Failed to fetch')), /Could not reach the server/);
  assert.match(S.friendlyError({ message: 'JWT expired' }), /sign-in has expired/);
  assert.match(S.friendlyError({ message: 'canceling statement due to statement timeout' }), /too long/);
  assert.match(S.friendlyError({ message: 'something else: secret details' }), /could not be completed/);
  assert.ok(!/secret/.test(S.friendlyError({ message: 'something else: secret details' })), 'database details are not shown');
});

// ---------------- wiring
test('search is loaded in order, offered on desktop and phone, and uses no database functions of its own', () => {
  const html = read('index.html'), app = read('app.js'), src = read('search.js');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('searchlogic.js') > 0 && at('search.js') > 0 && at('searchlogic.js') < at('search.js') && at('search.js') < at('app.js'));
  assert.ok(app.includes('id="gsb"') && app.includes('id="gsm"'), 'a Search button in the sidebar and in the phone bar');
  assert.ok(app.includes('window.pgSearch.open()'));
  const rpc = [...src.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(rpc, ['my_conversations'], 'only the existing conversation list is used');
  const calls = [...src.matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(calls, ['start_chat'], 'opening a person starts or reopens the private chat, as the New message button does');
  const tables = [...src.matchAll(/from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual([...new Set(tables)], ['employees', 'jobs', 'messages']);
  assert.ok(/\.is\('hidden_at', null\)/.test(src), 'removed (moderated) messages are never searched');
  assert.ok(/\.eq\('active', true\)/.test(src), 'disabled accounts are not listed');
  assert.ok(!/service|admin-users/.test(src), 'no elevated access');
});

test('search.js: keyboard, states and message links', () => {
  const src = read('search.js');
  for (const k of ["'ArrowDown'", "'ArrowUp'", "'Enter'"]) assert.ok(src.includes(k), k);
  assert.ok(src.includes('showModal()'), 'a real modal window: focus stays inside and Escape closes it');
  assert.ok(/role="combobox"/.test(src) && /role="listbox"/.test(src) && /role="option"/.test(src) && /aria-activedescendant/.test(src) && /aria-live="polite"/.test(src), 'screen-reader roles');
  for (const s of ["state === 'loading'", "state === 'empty'", "state === 'error'", "state === 'short'", "state === 'idle'"]) assert.ok(src.includes(s), s + ' is drawn');
  assert.ok(src.includes('pgChat.chatHref(m.conversation_id, m.id)'), 'a message opens its chat at that exact message (the Stage 2 link)');
  assert.ok(src.includes("href: '#/job/' + j.id"), 'a job opens its job page');
  assert.ok(src.includes('gate.isLatest(id)'), 'late answers are dropped');
  assert.ok(src.includes('Promise.allSettled'), 'one failing group does not hide the others');
  assert.ok(src.includes('L.shouldOpen('), 'the shortcut rules are the tested ones');
});

test('search styles use shared colour tokens and give phones a full-screen window', () => {
  const css = read('style.css');
  const i = css.indexOf('16. Global search');
  assert.ok(i > 0);
  const block = css.slice(i);
  assert.deepStrictEqual(block.match(/#[0-9a-fA-F]{3,6}\b/g) || [], [], 'no fixed colours');
  assert.ok(/dialog\.gs\{width:100vw;max-width:none;height:100vh;height:100dvh/.test(block.replace(/\r/g, '')), 'full screen on a phone');
  assert.ok(/\.gs-field input,\.gs-field input:focus/.test(block) && /\.gs-field:focus-within\{[^}]*box-shadow:var\(--focus\)/.test(block), 'the box shows a visible focus ring');
  assert.ok(/font-size:16px/.test(block), '16px input text, so phones do not zoom in');
});
