'use strict';
// docs/caps.js decides which 2.0 features can be used with the database that is actually there (migration 0014 today; 0015 to 0018 later).
// These tests cover both worlds: a database at migration 0014 (features off, never a broken screen) and a fully migrated one (features on).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const loadCaps = () => { delete require.cache[require.resolve('../../docs/caps.js')]; return require('../../docs/caps.js'); };   // a fresh module (fresh state) per test

// ---- error shapes as PostgREST / PostgreSQL / Supabase Storage report a missing function, table, column or bucket
const MISSING = [
  ['missing function (PostgREST)', { code: 'PGRST202', message: 'Could not find the function pressgo.set_avatar(p_mime, p_path, p_size) in the schema cache', details: 'Searched for the function pressgo.set_avatar', hint: null }],
  ['missing function, older PostgREST', { code: '42883', message: 'function pressgo.mark_unread(uuid) does not exist' }],
  ['missing table (PostgREST)', { code: 'PGRST205', message: "Could not find the table 'pressgo.employee_avatars' in the schema cache" }],
  ['missing table, older PostgREST', { code: '42P01', message: 'relation "pressgo.employee_preferences" does not exist' }],
  ['missing column in a select', { code: '42703', message: 'column jobs.deleted_at does not exist' }],
  ['missing column (PostgREST schema cache)', { code: 'PGRST204', message: "Could not find the 'message_id' column of 'notifications' in the schema cache" }],
  ['missing storage bucket', { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' }],
  ['no code, HTTP 404', { status: 404, message: 'relation "pressgo.employee_avatars" does not exist' }],
  ['wrapped message only', { message: 'Could not find the function pressgo.delete_job(p_job, p_reason, p_version) in the schema cache' }]
];
const NOT_MISSING = [
  ['an error raised by a PressGO function', { code: 'P0001', message: 'Job does not exist or you do not have access' }],
  ['version conflict', { code: '40001', message: 'version conflict' }],
  ['permission denied', { code: '42501', message: 'permission denied for table employee_avatars' }],
  ['duplicate key', { code: '23505', message: 'duplicate key value violates unique constraint' }],
  ['a bad value', { code: '22P02', message: 'invalid input syntax for type uuid: "x"; column does not exist is not this' }],
  ['expired sign-in', { code: 'PGRST301', message: 'JWT expired' }],
  ['network failure', new TypeError('Failed to fetch')],
  ['null', null], ['undefined', undefined], ['empty object', {}], ['empty string', '']
];

test('isMissing: every way the database reports "that function, table, column or bucket does not exist" is recognised', () => {
  const caps = loadCaps();
  for (const [what, err] of MISSING) assert.equal(caps.isMissing(err), true, what);
});

test('isMissing: real failures are never mistaken for "not available yet"', () => {
  const caps = loadCaps();
  for (const [what, err] of NOT_MISSING) assert.equal(caps.isMissing(err), false, what);
});

// ---- a fake database client: reports which tables/columns exist, and refuses everything except the zero-row read the probe is allowed to make
function fakeSb(present, opts) {
  opts = opts || {};
  const calls = [];
  const sb = {
    calls,
    from(table) {
      calls.push(['from', table]);
      return { select(col) { calls.push(['select', col]); return { limit(n) { calls.push(['limit', n]);
        if (opts.network) return Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } });
        if (opts.throws) return Promise.reject(new Error('socket hang up'));
        if (present.has(table + '.' + col)) return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: opts.error || MISSING[2][1] });
      } }; } };
    },
    rpc() { throw new Error('the probe must never call a database function'); },
    storage: { from() { throw new Error('the probe must never touch storage'); } }
  };
  return sb;
}
const ALL = new Set(['employee_avatars.employee_id', 'employee_preferences.theme', 'jobs.deleted_at', 'notifications.message_id']);

test('probe on a database at migration 0014: every 2.0 feature that needs 0015-0018 is off, nothing else is touched', async () => {
  for (const [what, err] of MISSING.slice(0, 6)) {
    const caps = loadCaps(); const sb = fakeSb(new Set(), { error: err });
    const snap = await caps.probe(sb);
    assert.deepEqual(snap, { avatars: false, prefs: false, deleteJob: false, links: false }, what);
    for (const n of caps.NAMES) assert.equal(caps.has(n), false, what + ': ' + n);
    assert.ok(sb.calls.every((c) => ['from', 'select', 'limit'].includes(c[0])), 'only zero-row reads');
    assert.ok(sb.calls.filter((c) => c[0] === 'limit').every((c) => c[1] === 0), 'limit(0): no data is read at all');
  }
});

test('probe on a fully migrated database (0015 to 0018): every feature is on', async () => {
  const caps = loadCaps(); const snap = await caps.probe(fakeSb(ALL));
  assert.deepEqual(snap, { avatars: true, prefs: true, deleteJob: true, links: true });
  for (const n of caps.NAMES) assert.equal(caps.has(n), true, n);
});

test('probe on a partly migrated database: each feature follows its own update', async () => {
  const caps = loadCaps(); const snap = await caps.probe(fakeSb(new Set(['employee_avatars.employee_id', 'employee_preferences.theme'])));   // 0015 and 0016 only
  assert.deepEqual(snap, { avatars: true, prefs: true, deleteJob: false, links: false });
  const c2 = loadCaps(); await c2.probe(fakeSb(new Set(['jobs.deleted_at', 'notifications.message_id'])));                                          // 0017 and 0018 only
  assert.deepEqual(c2.snapshot(), { avatars: false, prefs: false, deleteJob: true, links: true });
});

test('probe: a network failure or a thrown error leaves every feature available (the calls are guarded anyway) and is reported as not known', async () => {
  for (const opts of [{ network: true }, { throws: true }]) {
    const caps = loadCaps(); const snap = await caps.probe(fakeSb(ALL, opts));
    assert.deepEqual(snap, { avatars: null, prefs: null, deleteJob: null, links: null });
    for (const n of caps.NAMES) assert.equal(caps.has(n), true, n);
  }
});

test('probe: a permission error is not "missing" either', async () => {
  const caps = loadCaps(); const snap = await caps.probe(fakeSb(new Set(), { error: { code: '42501', message: 'permission denied for table jobs' } }));
  assert.deepEqual(snap, { avatars: null, prefs: null, deleteJob: null, links: null });
});

test('probe asks about exactly the object each update adds: the table or column exists in that migration and in no earlier one', () => {
  const caps = loadCaps(); const mig = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))) mig[f.slice(0, 4)] = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8');
  const before = (m) => Object.keys(mig).filter((k) => k < m).map((k) => mig[k]).join('\n');
  for (const n of caps.NAMES) {
    const f = caps.FEATURES[n], own = mig[f.migration];
    // "creates that table" or "adds that column to THAT table" (deleted_at also exists on the unrelated table deleted_messages, from 0010)
    const creates = new RegExp(`create table (if not exists )?pressgo\\.${f.table}\\b`, 'i');
    const alters = new RegExp(`alter table pressgo\\.${f.table}\\b[^;]*?add column (if not exists )?${f.column}\\b`, 'i');
    const earlier = before(f.migration);
    // a table that already exists before this update (jobs, notifications) is told apart by its NEW column; a brand-new table by the table itself
    const adds = creates.test(earlier) ? alters : { test: (s) => creates.test(s) || alters.test(s) };
    assert.ok(adds.test(own), `${n}: migration ${f.migration} adds ${f.table}.${f.column}`);
    assert.ok(!adds.test(earlier), `${n}: nothing before ${f.migration} adds ${f.table}.${f.column}, so the probe tells the two states apart`);
  }
});

test('start: resolves with the result, and never keeps anyone waiting longer than the limit', async () => {
  const caps = loadCaps(); const snap = await caps.start(fakeSb(new Set()), 2000);
  assert.deepEqual(snap, { avatars: false, prefs: false, deleteJob: false, links: false });
  const slow = loadCaps(); const never = { from: () => ({ select: () => ({ limit: () => new Promise(() => {}) }) }) };
  const t0 = Date.now(); const s2 = await slow.start(never, 60); assert.ok(Date.now() - t0 < 1500, 'gave up after the limit');
  assert.deepEqual(s2, { avatars: null, prefs: null, deleteJob: null, links: null });
  for (const n of slow.NAMES) assert.equal(slow.has(n), true, 'unknown stays available');
});

test('markMissing / markPresent / reset / onChange', () => {
  const caps = loadCaps(); const seen = [];
  caps.onChange((n, v) => seen.push(n + '=' + v));
  caps.markMissing('links'); caps.markMissing('links'); caps.markMissing('nonsense');
  assert.equal(caps.has('links'), false); assert.deepEqual(seen, ['links=false'], 'listeners hear each change once; unknown names are ignored');
  caps.markPresent('links'); assert.equal(caps.has('links'), true);
  caps.markMissing('avatars'); caps.reset();
  for (const n of caps.NAMES) assert.equal(caps.has(n), true, 'after sign-out nothing is remembered: ' + n);
});

test('guard: a feature call that finds the feature missing is reported once, remembered, and never counted as success', async () => {
  const caps = loadCaps(); const told = [];
  const r = await caps.guard('deleteJob', async () => { const e = new Error('Could not find the function pressgo.delete_job(p_job, p_reason, p_version) in the schema cache'); e.code = 'PGRST202'; throw e; }, (t) => told.push(t));
  assert.equal(r, undefined); assert.equal(caps.has('deleteJob'), false); assert.deepEqual(told, [caps.unavailable('deleteJob')]);
  assert.equal(await caps.guard('links', async () => 42), 42, 'success passes through');
  await assert.rejects(caps.guard('links', async () => { const e = new Error('Job does not exist'); e.code = 'P0001'; throw e; }), /Job does not exist/);
  assert.equal(caps.has('links'), true, 'a real failure does not switch a feature off');
});

test('every feature has a plain-English text that says it is not available YET', () => {
  const caps = loadCaps();
  for (const n of caps.NAMES) { const t = caps.unavailable(n); assert.ok(/not available yet/i.test(t) && t.length > 20 && t.length < 140, n + ': ' + t); assert.ok(!/migration|database|sql|supabase|0015|0016|0017|0018/i.test(t), n + ': no technical words for staff'); }
  assert.ok(/not available yet/i.test(caps.GENERIC) && /nothing was changed/i.test(caps.GENERIC));
  assert.equal(caps.friendlyText({ code: 'PGRST202', message: 'Could not find the function' }, 'x'), caps.GENERIC);
  assert.equal(caps.friendlyText({ code: 'P0001', message: 'x' }, 'normal text'), 'normal text');
});
