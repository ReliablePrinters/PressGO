'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const profile = require('../../docs/profile.js');

const ROOT = path.join(__dirname, '..', '..');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0015_avatars.sql'), 'utf8');
const pic = (type, size) => ({ type, size });
const EMP = '00000000-0000-0000-0000-0000000000a3';
const UID = 'aaaaaaaa-0000-4000-8000-000000000001';

test('validateAvatarFile: only JPEG, PNG and WebP, not empty, not huge', () => {
  for (const t of ['image/jpeg', 'image/png', 'image/webp']) assert.equal(profile.validateAvatarFile(pic(t, 5000)).ok, true, t);
  for (const t of ['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', 'text/html', '']) {
    const v = profile.validateAvatarFile(pic(t, 5000));
    assert.equal(v.ok, false, t);
    assert.match(v.error, /JPEG, PNG or WebP/);
  }
  assert.equal(profile.validateAvatarFile(pic('image/png', 0)).ok, false);
  assert.equal(profile.validateAvatarFile(pic('image/png', 10 * 1024 * 1024)).ok, true, 'exactly 10 MB may be chosen (it is shrunk)');
  assert.equal(profile.validateAvatarFile(pic('image/png', 10 * 1024 * 1024 + 1)).ok, false);
  assert.equal(profile.validateAvatarFile(null).ok, false);
  assert.equal(profile.validateAvatarFile({}).ok, false);
});

test('cropBox: the biggest centred square', () => {
  assert.deepEqual(profile.cropBox(400, 400), { sx: 0, sy: 0, s: 400 });
  assert.deepEqual(profile.cropBox(1000, 600), { sx: 200, sy: 0, s: 600 });
  assert.deepEqual(profile.cropBox(600, 1000), { sx: 0, sy: 200, s: 600 });
  assert.deepEqual(profile.cropBox(11, 4), { sx: 3, sy: 0, s: 4 });
  assert.equal(profile.cropBox(0, 50).s, 0, 'an unreadable picture gives an empty box, which the caller rejects');
});

test('avatarPath: the person\'s own folder and a fresh name', () => {
  assert.equal(profile.avatarPath(EMP, UID), `${EMP}/${UID}.jpg`);
  assert.notEqual(profile.avatarPath(EMP, 'a'), profile.avatarPath(EMP, 'b'));
});

test('a path built by the app is accepted by the server\'s path rule (and others are not)', () => {
  const m = sql.match(/p_path !~ \('\^' \|\| me::text \|\| '([^']+)'\)/);
  assert.ok(m, 'found the path rule in set_avatar()');
  const rule = (me) => new RegExp('^' + me + m[1]);
  assert.ok(rule(EMP).test(profile.avatarPath(EMP, crypto.randomUUID())), 'app path passes');
  assert.ok(!rule(EMP).test(profile.avatarPath('00000000-0000-0000-0000-0000000000a4', UID)), 'someone else\'s folder fails');
  assert.ok(!rule(EMP).test(`${EMP}/../x/${UID}.jpg`));
  assert.ok(!rule(EMP).test(`${EMP}/evil.php.jpg`));
  assert.ok(!rule(EMP).test(`${EMP}/${UID}.svg`));
  assert.ok(!rule(EMP).test(`${EMP}/${UID}.jpg/extra`));
});

test('the app and migration 0015 agree on limits and types', () => {
  assert.equal(profile.AVATAR.MAX_STORED, 2097152);
  assert.ok(sql.includes('2097152'));
  assert.ok(profile.AVATAR.MAX_STORED >= 100 * 1024, 'a 256 px JPEG is far below the limit');
  for (const t of profile.AVATAR.TYPES) assert.ok(sql.includes(`'${t}'`), t);
  assert.equal((sql.match(/'image\/[a-z+]+'/g) || []).filter((x, i, a) => a.indexOf(x) === i).length, 3, 'migration allows exactly three image types');
  assert.ok(sql.includes("values ('avatars', 'avatars', false, 2097152,"), 'a private bucket with the same limit');
  assert.equal(profile.AVATAR.BUCKET, 'avatars');
});

test('app.js shows the profile button, and chat.js draws pictures over the default initials avatar', () => {
  const app = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');
  const chat = fs.readFileSync(path.join(ROOT, 'docs', 'chat.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(app.includes('id="prof">My profile</button>'));
  assert.ok(app.includes('window.pgProfile.init()'), 'saved look and pictures are loaded after sign-in');
  assert.ok(chat.includes('window.pgAvatarUrl'), 'the avatar helper asks for a picture');
  assert.ok(/\$\{esc\(initials\(n\)\)\}\$\{pic \?/.test(chat), 'initials stay underneath as the default');
  assert.ok(html.indexOf('chat.js') < html.indexOf('profile.js'), 'profile.js loads after chat.js (which defines pgAvatar)');
});

test('profile.js never sends anyone else\'s id: it only calls the three "mine" functions', () => {
  const src = fs.readFileSync(path.join(ROOT, 'docs', 'profile.js'), 'utf8');
  const calls = [...src.matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(calls, ['remove_avatar', 'set_avatar', 'set_preferences']);
  assert.ok(!/p_employee|employee_id\s*:/.test(src.replace(/select\('[^']*'\)/g, '')), 'no employee id is ever passed in');
});
