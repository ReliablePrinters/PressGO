'use strict';
// PressGO 2.0 must work with the database that is live today (migration 0014) AND with the fully migrated database (0015 to 0018).
// Features that need a database update are switched off with a short explanation until the update exists, and switch on by themselves afterwards.
// These tests run the real browser code (settings.js, profile.js, prefs.js, caps.js) in a sandbox against both kinds of database, and fail if anyone
// adds a call to something newer than 0014 without gating it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = path.join(ROOT, 'docs'), MIG = path.join(ROOT, 'supabase', 'migrations');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');
const MISSING_FN = Object.assign(new Error('Could not find the function pressgo.set_preferences(p_accent, p_theme) in the schema cache'), { code: 'PGRST202' });

// ------------------------------------------------------------------ a tiny browser: just enough of window/document for the real files to run
function sandbox(state) {
  const calls = [], toasts = [], shells = [];
  const stub = { innerHTML: '', textContent: '', hidden: false, style: {}, dataset: {}, files: [], checked: false, value: '', _l: {},
    addEventListener(t, f) { this._l[t] = f; }, querySelector() { return stub; }, querySelectorAll() { return []; }, setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, remove() {}, scrollIntoView() {}, click() {}, closest() { return null; } };
  const mkEl = () => ({ ...stub, style: {}, _l: {}, dataset: {}, querySelector() { return stub; }, querySelectorAll() { return []; } });
  const body = mkEl();
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Date, Promise, JSON, Math, Map, Set, Object, Array, String, Number, Error, URL,
    document: { documentElement: { getAttribute: () => 'light', setAttribute() {}, style: {} }, getElementById: (id) => (id === 'sbody' ? body : stub), querySelector: () => null,
      querySelectorAll: () => [], addEventListener() {}, createElement: mkEl, head: { appendChild() {} }, visibilityState: 'visible', hasFocus: () => true },
    localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, v); } },
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    me: { id: 'e1', display_name: 'Test Person', manager_role: false, created_at: '2026-01-01T00:00:00Z' }, depts: [], myDepts: new Set(),
    shell: (name, html) => shells.push([name, html]), toast: (m, kind) => toasts.push([m, kind || 'ok']),
    sb: { from() { throw new Error('the page must not query the database in these tests'); } },
    pgAvatar: () => ''
  };
  ctx.window = ctx; ctx.self = ctx; ctx.crypto = { randomUUID: () => 'u' };
  ctx.call = async (fn, args) => { calls.push([fn, args]); if (ctx.__callError) throw ctx.__callError; return null; };
  vm.createContext(ctx);
  const run = (f) => vm.runInContext(read(f), ctx, { filename: f });
  // the real friendly() and cap() lines from app.js (the whole of app.js needs a full page, these two are self-contained)
  const app = read('app.js');
  vm.runInContext(app.match(/^const friendly = .*$/m)[0] + '\n' + app.match(/^const cap = .*$/m)[0] + '\nthis.friendly = friendly; this.cap = cap;', ctx, { filename: 'app.js(friendly,cap)' });
  ['caps.js', 'prefs.js', 'settingslogic.js', 'profile.js', 'settings.js'].forEach(run);
  const C = ctx.pgCaps;
  if (state === '0014') C.NAMES.forEach((n) => C.markMissing(n));
  if (state === 'migrated') C.NAMES.forEach((n) => C.markPresent(n));
  return { ctx, body, stub, calls, toasts, shells, mkEl, C };
}

// ------------------------------------------------------------------ the two worlds
test('a database at migration 0014: Appearance explains instead of offering a look that cannot be saved, and asks the database nothing', () => {
  const s = sandbox('0014'); s.ctx.window.viewSettings('appearance');
  assert.ok(/not available yet/i.test(s.body.innerHTML), 'explanation shown');
  assert.ok(!/name="theme"|name="accent"|type="radio"/.test(s.body.innerHTML), 'no controls');
  assert.ok(/following your computer/i.test(s.body.innerHTML), 'says what happens instead');
  assert.deepEqual(s.calls, [], 'set_preferences is never called');
});

test('a fully migrated database: Appearance shows the controls, and a change is saved through set_preferences and reported as saved', async () => {
  const s = sandbox('migrated'); s.ctx.window.viewSettings('appearance');
  assert.ok(s.body.innerHTML.includes('name="theme"') && s.body.innerHTML.includes('name="accent"'), 'controls shown');
  assert.ok(!/not available yet/i.test(s.body.innerHTML));
  await s.body._l.change({ target: { name: 'theme', value: 'dark' } });
  assert.deepEqual(s.calls, [['set_preferences', { p_theme: 'dark', p_accent: 'purple' }]]);
  assert.equal(s.stub.textContent, 'Saved.');
});

test('capability not known yet: Appearance is offered, and if the save then finds the update missing the look goes back, nothing says "Saved.", the feature switches off', async () => {
  const s = sandbox('unknown'); s.ctx.window.viewSettings('appearance');
  assert.ok(s.body.innerHTML.includes('name="theme"'), 'offered while unknown');
  s.ctx.__callError = MISSING_FN;
  await s.body._l.change({ target: { name: 'theme', value: 'dark' } });
  assert.notEqual(s.stub.textContent, 'Saved.');
  assert.ok(/not available yet/i.test(s.stub.textContent) && !/schema cache|PGRST/.test(s.stub.textContent), 'plain words, not the database message: ' + s.stub.textContent);
  assert.equal(s.ctx.pgPrefs.get().theme, 'system', 'the look went back to what is saved');
  assert.equal(s.C.has('prefs'), false, 'remembered');
  s.ctx.window.viewSettings('appearance');
  assert.ok(/not available yet/i.test(s.body.innerHTML) && !s.body.innerHTML.includes('name="theme"'), 'next visit: the explanation');
});

test('a failure that is NOT about a missing update keeps the feature on and shows the normal message', async () => {
  const s = sandbox('migrated'); s.ctx.window.viewSettings('appearance');
  s.ctx.__callError = Object.assign(new Error('Your look must be one of the listed choices'), { code: 'P0001' });
  await s.body._l.change({ target: { name: 'theme', value: 'dark' } });
  assert.ok(/Your look was not saved: Your look must be one of the listed choices/.test(s.stub.textContent), s.stub.textContent);
  assert.equal(s.C.has('prefs'), true);
});

test('profile picture: migration 0014 shows the explanation only (no file chooser, no save button); a migrated database shows the editor', () => {
  const off = sandbox('0014'), hostOff = off.mkEl(); off.ctx.pgProfile.mountPicture(hostOff);
  assert.ok(/not available yet/i.test(hostOff.innerHTML) && /initials/i.test(hostOff.innerHTML), hostOff.innerHTML);
  assert.ok(!/type="file"|Save picture/.test(hostOff.innerHTML));
  const on = sandbox('migrated'), hostOn = on.mkEl(); on.ctx.pgProfile.mountPicture(hostOn);
  assert.ok(/type="file"/.test(hostOn.innerHTML) && /Save picture/.test(hostOn.innerHTML) && !/not available yet/i.test(hostOn.innerHTML));
  const unknown = sandbox('unknown'), hostU = unknown.mkEl(); unknown.ctx.pgProfile.mountPicture(hostU);
  assert.ok(/type="file"/.test(hostU.innerHTML), 'offered while not yet known (the save itself is guarded)');
});

test('profile pictures and the saved look: no database or storage request is made when the update is known to be missing', async () => {
  const s = sandbox('0014'); const asked = [];
  s.ctx.sb = { from(t) { asked.push(t); throw new Error('must not be asked'); }, storage: { from() { asked.push('storage'); throw new Error('must not be asked'); } } };
  await s.ctx.pgProfile.reload();   // loadAvatars
  s.ctx.pgProfile.init();           // loadPrefs + loadAvatars
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(asked, [], 'nothing was requested');
  const m = sandbox('migrated'); const q = [];
  m.ctx.sb = { from(t) { q.push(t); return { select() { return { maybeSingle: async () => ({ data: null, error: null }), then: (r) => r({ data: [], error: null }) }; } }; }, storage: { from() { return { createSignedUrls: async () => ({ data: [] }) }; } } };
  await m.ctx.pgProfile.reload(); await new Promise((r) => setTimeout(r, 20));
  assert.ok(q.includes('employee_avatars'), 'migrated: pictures are requested');
});

test('a missing-update error during the load switches the feature off and is not shown to anyone', async () => {
  const s = sandbox('unknown'); const err = { code: 'PGRST205', message: "Could not find the table 'pressgo.employee_avatars' in the schema cache" };
  s.ctx.sb = { from() { return { select() { return Promise.resolve({ data: null, error: err }); } }; } };
  await s.ctx.pgProfile.reload();
  assert.equal(s.C.has('avatars'), false); assert.deepEqual(s.toasts, [], 'no message');
});

test('app.js friendly(): a missing update is explained in plain words, every other error reads exactly as before', () => {
  const s = sandbox('unknown'); const f = s.ctx.friendly, G = s.C.GENERIC;
  assert.equal(f(MISSING_FN), G);
  assert.equal(f({ code: 'PGRST205', message: "Could not find the table 'x' in the schema cache" }), G);
  assert.equal(f({ statusCode: '404', message: 'Bucket not found' }), G);
  assert.equal(f(new Error('ERROR: version conflict')), 'version conflict', 'the old behaviour: the "ERROR:" prefix is removed');
  assert.equal(f(new Error('Please give a real reason.')), 'Please give a real reason.');
  assert.equal(f('plain text'), 'plain text');
  assert.equal(s.ctx.cap('links'), true, 'unknown counts as available');
  s.C.markMissing('links'); assert.equal(s.ctx.cap('links'), false); assert.equal(s.ctx.cap('avatars'), true);
});

// ------------------------------------------------------------------ the other screens (whole-page code that cannot run without a full page): the gates are in place
test('index.html loads caps.js before every file that uses it', () => {
  const html = read('index.html'); const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('caps.js') > 0);
  for (const f of ['profile.js', 'chat.js', 'settings.js', 'home.js', 'app.js']) assert.ok(at('caps.js') < at(f), 'caps.js before ' + f);
});

test('app.js: the check runs once after sign-in (and never waits for long), is forgotten at sign-out, and the Delete job button needs 0017', () => {
  const app = read('app.js');
  assert.ok(/await window\.pgCaps\.start\(sb, \d+\)/.test(app), 'probe after sign-in');
  assert.ok(app.indexOf('pgCaps.start(sb') < app.indexOf('window.pgProfile.init()'), 'before the profile loads');
  assert.equal((app.match(/window\.pgCaps\.reset\(\)/g) || []).length, 2, 'both sign-out paths');
  assert.ok(app.includes("${canDelete && cap('deleteJob') ? '<button id=\"deljob\""), 'Delete job needs 0017');
  assert.ok(/markMissing\('deleteJob'\)/.test(app), 'a missing function found at the moment of deleting switches it off');
});

test('chat.js: text replies keep working; "Mark unread" and picture replies need 0018 and are not offered without it; a missing update is never shown as sent', () => {
  const chat = read('chat.js');
  assert.ok(chat.includes("const actsHtml = (m) => (m.hidden_at ? '' : `<span class=\"acts\"><button type=\"button\" data-reply="), 'the Reply button is offered with the older database too (text replies work there)');
  assert.ok(chat.includes("${m.author_id !== me.id && capOn('links') ? `<button type=\"button\" data-unread-from="), 'per-message "Mark unread" needs 0018');
  assert.ok(chat.includes("${capOn('links') ? '<button type=\"button\" class=\"sm\" id=\"mkun\""), 'chat-level Mark as unread button');
  assert.ok(chat.includes("const mkun = document.getElementById('mkun');") && chat.includes('if (mkun) mkun.onclick'), 'its handler copes with the button being absent');
  assert.equal((chat.match(/markMissing\('links'\)/g) || []).length, 3, 'send, mark unread (chat), mark unread (from a message)');
  assert.ok(chat.includes('...(replyTo ? { p_reply: replyTo.id } : {})'), 'the reply argument is sent only when replying, so ordinary messages and pictures are sent exactly as in 1.x');
  const send = chat.slice(chat.indexOf('f.onsubmit = async'), chat.indexOf('timer = setInterval'));
  assert.ok(send.includes("if (pending && replyTo && !capOn('links'))") && send.indexOf("if (pending && replyTo && !capOn('links'))") < send.indexOf("sb.storage.from('chat-files').upload"), 'a picture reply is refused with an explanation BEFORE the picture is uploaded');
  assert.ok(send.indexOf("markMissing('links'); setReply(null)") > 0 && send.indexOf("window.pgToast(friendly(err), 'error')") > send.indexOf("markMissing('links')"), 'the reply is dropped, the typed text kept, the error reported');
  assert.ok(send.indexOf("ta.value = ''") < send.indexOf('} catch (err)'), 'the text box is cleared only on success');
});

test('home.js: the live alerts feed (new in 2.0) is only subscribed when 0018 has put alerts on the change feed; before that the 30-second refresh does the job', () => {
  const home = read('home.js'); const i = home.indexOf('function alertLive()'), fn = home.slice(i, home.indexOf('window.alertLeave'));
  assert.ok(fn.includes("if (window.pgCaps && !window.pgCaps.has('links')) return;") && fn.indexOf("pgCaps.has('links')") < fn.indexOf("sb.channel('alerts-me')"), 'no subscription without 0018');
  assert.ok(/setInterval\(\(\) => \{ if \(me\) window\.alertBadge\(\); \}, 30000\)/.test(home), 'the refresh that the older version relied on is still there');
  assert.ok(!/notifications/.test(fs.readFileSync(path.join(MIG, '0005_chat.sql'), 'utf8').match(/add table pressgo\.\w+/g).join(' ')), 'at 0014 only messages is on the change feed');
});

test('home.js: Alerts ask for the message-link columns only when 0018 may be there, and fall back to the older columns otherwise', () => {
  const home = read('home.js'); const i = home.indexOf('async function loadAlerts()'), fn = home.slice(i, home.indexOf('window.viewAlerts'));
  assert.ok(fn.includes("!window.pgCaps.has('links')") && fn.includes('return q(OLD)'), 'known missing: the older columns straight away, no failing request');
  assert.ok(fn.includes("markMissing('links')") && fn.indexOf('q(OLD)') < fn.lastIndexOf('q(OLD)'), 'a failure falls back to the older columns');
  assert.ok(/OLD = 'id,kind,title,job_id,created_at,read_at'/.test(fn), 'the older list contains only columns that exist at 0014');
});

// ------------------------------------------------------------------ nothing newer than 0014 can slip in unguarded
test('every function and table the web code uses that does not exist at migration 0014 is gated by a capability', () => {
  const sql0014 = fs.readdirSync(MIG).filter((f) => f < '0015').map((f) => fs.readFileSync(path.join(MIG, f), 'utf8')).join('\n');
  const fns = new Set([...sql0014.matchAll(/create (?:or replace )?function pressgo\.([a-z_]+)/gi)].map((m) => m[1]));
  const tabs = new Set([...sql0014.matchAll(/create table (?:if not exists )?pressgo\.([a-z_]+)/gi)].map((m) => m[1]));
  const GATE = { set_avatar: 'avatars', remove_avatar: 'avatars', employee_avatars: 'avatars', set_preferences: 'prefs', employee_preferences: 'prefs', delete_job: 'deleteJob', mark_unread: 'links' };
  const used = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith('.js'))) {
    const src = read(f);
    for (const m of src.matchAll(/\b(?:call|rpc)\('([a-z_]+)'/g)) if (!fns.has(m[1])) used.push([m[1], f]);
    for (const m of src.matchAll(/\.from\('([a-z_]+)'\)/g)) if (!tabs.has(m[1])) used.push([m[1], f]);
  }
  assert.ok(used.length >= 7, 'the scan finds the known ones: ' + JSON.stringify(used));
  for (const [name, file] of used) {
    assert.ok(GATE[name], `docs/${file} uses "${name}", which does not exist at migration 0014: gate it in caps.js and add it here`);
    const src = read(file);
    assert.ok(new RegExp(`(has|cap|capOn|isMissing|markMissing)\\('${GATE[name]}'\\)`).test(src), `docs/${file} must check the "${GATE[name]}" capability before using ${name}`);
  }
  assert.deepEqual([...new Set(used.map((u) => u[0]))].sort(), Object.keys(GATE).sort(), 'exactly these');
});

test('the reply argument and the notification columns of 0018 are the only other newer-than-0014 things the web code relies on, and both are gated', () => {
  const sql0014 = fs.readdirSync(MIG).filter((f) => f < '0015').map((f) => fs.readFileSync(path.join(MIG, f), 'utf8')).join('\n');
  const fn = (name) => (sql0014.match(new RegExp('create (?:or replace )?function pressgo\\.' + name + '\\([^)]*\\)', 'gi')) || []).join(' ');
  assert.ok(/p_reply/.test(fn('send_message')), 'text replies: send_message has taken p_reply since 0005, so they work at 0014');
  assert.ok(fn('send_attachment') && !/p_reply/.test(fn('send_attachment')), 'picture replies: send_attachment gets p_reply only in 0018');
  assert.ok(!/notifications[^;]*conversation_id|notifications[^;]*message_id/.test(sql0014.replace(/\s+/g, ' ')), 'the notification link columns are not part of 0014');
  const chat = read('chat.js'), home = read('home.js');
  assert.ok(chat.includes('p_reply') && /replyTo \? \{ p_reply/.test(chat), 'replies send p_reply only when replying (and replying needs the gate)');
  assert.ok(home.includes('conversation_id,message_id') && home.includes("pgCaps.has('links')"));
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith('.js') && x !== 'home.js')) assert.ok(!/from\('notifications'\)\.select\('[^']*(conversation_id|message_id)/.test(read(f)), f + ' asks for the 0018 notification columns without a fallback');
});

test('deleted jobs: the web code never filters on the 0017 columns, so job lists work unchanged at 0014', () => {
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith('.js') && x !== 'caps.js')) assert.ok(!/\.(is|eq|not|neq)\('deleted_(at|by)'|delete_reason/.test(read(f)), f);   // caps.js only names the column in a comment
});
