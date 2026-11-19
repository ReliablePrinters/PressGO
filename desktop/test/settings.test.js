'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../../docs/settingslogic.js');
const C = require('../../docs/chatlogic.js');

test('settings links: each section opens, unknown sections open the first, other links are not settings', () => {
  assert.strictEqual(S.parseSettingsHash('#/settings'), 'profile');
  assert.strictEqual(S.parseSettingsHash('#/settings/'), 'profile');
  for (const id of ['profile', 'security', 'notifications', 'appearance', 'about']) assert.strictEqual(S.parseSettingsHash('#/settings/' + id), id);
  assert.strictEqual(S.parseSettingsHash('#/settings/nonsense'), 'profile');
  for (const bad of ['', null, undefined, '#/home', '#/settingsx', '#/settings/security/extra', '#/chat/settings']) assert.strictEqual(S.parseSettingsHash(bad), null, String(bad));
});

test('settingsHref builds links that parse back; the first section is the short link', () => {
  assert.strictEqual(S.settingsHref('profile'), '#/settings');
  assert.strictEqual(S.settingsHref('security'), '#/settings/security');
  assert.strictEqual(S.settingsHref('junk'), '#/settings');
  for (const s of S.SECTIONS) assert.strictEqual(S.parseSettingsHash(S.settingsHref(s.id)), s.id);
  assert.deepStrictEqual(S.IDS, ['profile', 'security', 'notifications', 'appearance', 'keyboard', 'about']);
});

test('password check: every rule, with plain sentences', () => {
  const ok = S.checkPassword({ current: 'old-password', next: 'a-better-one-1', again: 'a-better-one-1' });
  assert.deepStrictEqual([ok.ok, ok.errors], [true, []]);
  assert.deepStrictEqual(ok.rules, { current: true, length: true, different: true, match: true });

  assert.match(S.checkPassword({ current: '', next: 'a-better-one-1', again: 'a-better-one-1' }).errors.join(' '), /current password/);
  assert.match(S.checkPassword({ current: 'x', next: 'short', again: 'short' }).errors.join(' '), /at least 8/);
  assert.match(S.checkPassword({ current: 'x', next: 'x'.repeat(73), again: 'x'.repeat(73) }).errors.join(' '), /too long/);
  assert.match(S.checkPassword({ current: 'same-password', next: 'same-password', again: 'same-password' }).errors.join(' '), /different/);
  assert.match(S.checkPassword({ current: 'x', next: 'a-better-one-1', again: 'a-better-one-2' }).errors.join(' '), /do not match/);
  assert.strictEqual(S.checkPassword({ current: 'x', next: 'x'.repeat(72), again: 'x'.repeat(72) }).ok, true, '72 is allowed');
  assert.strictEqual(S.checkPassword({ current: 'x', next: 'x'.repeat(8), again: 'x'.repeat(8) }).ok, true, '8 is allowed');
  assert.strictEqual(S.checkPassword({}).ok, false, 'an empty form is never fine');
  assert.strictEqual(S.checkPassword(null).ok, false);
  // a short password does not also complain about the confirmation: one thing at a time
  assert.strictEqual(S.checkPassword({ current: 'x', next: 'short', again: 'different' }).errors.filter((e) => /match/.test(e)).length, 0);
});

test('server messages become plain sentences, and the unknown ones are still readable', () => {
  assert.match(S.friendlyAuthError('Invalid login credentials'), /current password is not right/);
  assert.match(S.friendlyAuthError('New password should be different from the old password.'), /different from your current/);
  assert.match(S.friendlyAuthError('Password should be at least 6 characters'), /not strong enough/);
  assert.match(S.friendlyAuthError('email rate limit exceeded'), /Too many tries/);
  assert.match(S.friendlyAuthError('Failed to fetch'), /Could not reach the server/);
  assert.match(S.friendlyAuthError('Something odd'), /Something odd/);
  assert.match(S.friendlyAuthError(''), /not changed/);
});

test('how a person is described', () => {
  assert.strictEqual(S.roleText({ manager_role: true, front_desk: true }), 'Manager · Front Desk');
  assert.strictEqual(S.roleText({ manager_role: false, front_desk: true }), 'Front Desk');
  assert.strictEqual(S.roleText({ manager_role: true, front_desk: false }), 'Manager');
  assert.strictEqual(S.roleText({}), 'Staff');
  assert.strictEqual(S.roleText(null), 'Staff');
  assert.strictEqual(S.joinNames(['Novelty', 'Bindery']), 'Novelty, Bindery');
  assert.strictEqual(S.joinNames([]), 'None yet');
  assert.strictEqual(S.sinceText('garbage'), '');
  assert.match(S.sinceText('2026-10-05T10:00:00Z'), /2026/);
});

test('alert types: every alert kind the database creates belongs to a switchable group, unknown kinds are never silenced', () => {
  for (const kind of ['assigned', 'handoff', 'problem', 'task', 'approved', 'approval_withdrawn', 'reply', 'job_deleted']) {
    assert.notStrictEqual(C.alertGroup(kind), 'other', kind);
  }
  assert.strictEqual(C.alertGroup('approved'), C.alertGroup('approval_withdrawn'));
  assert.strictEqual(C.alertGroup('something-new'), 'other');
  const ids = C.ALERT_GROUPS.map((g) => g.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate group ids');
  assert.ok(!ids.includes('other'), 'the catch-all cannot be switched off');
  const kinds = C.ALERT_GROUPS.flatMap((g) => g.kinds);
  assert.strictEqual(new Set(kinds).size, kinds.length, 'a kind belongs to exactly one group');
});

// ---------- wiring: the Settings page is reachable, safe and keeps the old features ----------
const fs = require('node:fs');
const path = require('node:path');
const DOCS = path.join(__dirname, '..', '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

test('Settings is routed, loaded in the right order and replaces the old footer buttons', () => {
  const app = read('app.js'), html = read('index.html');
  assert.ok(app.includes('parseSettingsHash(h)') && app.includes('window.viewSettings(sec)'), 'route() opens Settings');
  assert.ok(app.includes('id="set"') && app.includes('id="so"'), 'Settings and Sign out stay in the footer');
  for (const gone of ['id="cpw"', 'id="nfy"', 'id="prof"']) assert.ok(!app.includes(gone), gone + ' is gone');
  assert.ok(!app.includes('Change my password'), 'the old password dialog is gone');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  for (const f of ['version.js', 'settingslogic.js', 'settings.js']) assert.ok(at(f) > 0, f + ' is loaded');
  assert.ok(at('settingslogic.js') < at('settings.js') && at('chatlogic.js') < at('notify.js') && at('profile.js') < at('settings.js'));
  assert.ok(at('settings.js') < at('app.js'), 'settings.js is ready before the app starts');
});

test('settings.js: password change proves the current password first and never logs or stores a password', () => {
  const src = read('settings.js');
  assert.ok(src.indexOf('signInWithPassword') > 0 && src.indexOf('signInWithPassword') < src.indexOf('updateUser'), 're-check the current password before changing it');
  assert.ok(!/console\.|localStorage|sessionStorage/.test(src), 'no logging and no browser storage in the settings page');
  assert.ok(src.includes('S.checkPassword') && src.includes('S.friendlyAuthError'), 'uses the tested rules');
});

test('settings.js: Appearance saves through set_preferences, passes no employee id, and undoes itself on failure', () => {
  const src = read('settings.js');
  const calls = [...src.matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(calls, ['set_preferences']);
  assert.ok(/p_theme: next\.theme, p_accent: next\.accent/.test(src));
  assert.ok(!/p_employee|employee_id\s*:/.test(src));
  assert.ok(/catch \(ex\) \{\s*P\.apply\(saved\)/.test(src), 'a failed save goes back to the saved look');
});

test('settings.js: every section in the list has a panel, and About shows the app and desktop versions', () => {
  const src = read('settings.js');
  for (const id of S.IDS) assert.ok(src.includes(`    ${id}(el) {`), id + ' panel exists');
  assert.ok(src.includes('PG_VERSION') && src.includes('currentVersion'));
  assert.ok(/version:\s*'\d+\.\d+\.\d+'/.test(read('version.js')));
});

test('profile.js: the old dialog is gone and the picture editor is exported for Settings', () => {
  const src = read('profile.js');
  assert.ok(src.includes('mountPicture') && !src.includes('async function openProfile'));
  assert.ok(/open: \(\) => \{ root\.location\.hash = '#\/settings'; \}/.test(src), 'any old link to the profile opens Settings');
});
