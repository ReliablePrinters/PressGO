// Runs the real admin-users function code against the fake backend. Usage: node run_admin_users_test.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'; import { spawnSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '../../functions/admin-users/index.ts'), 'utf8')
  .replace("from 'npm:@supabase/supabase-js@2'", "from './fake_supabase.mjs'");
const tmp = fs.mkdtempSync(path.join(here, '.tmp-'));
fs.copyFileSync(path.join(here, 'fake_supabase.mjs'), path.join(tmp, 'fake_supabase.mjs'));
fs.writeFileSync(path.join(tmp, 'fn.ts'), src);
fs.writeFileSync(path.join(tmp, 'test.mjs'), `
import { state, reset } from './fake_supabase.mjs';
let handler; globalThis.Deno = { env: { get: (k) => 'x' }, serve: (h) => { handler = h; } };
await import('./fn.ts');
let fails = 0;
const check = (ok, label) => { if (!ok) { fails++; console.log('FAILED: ' + label); } };
const call = async (token, body, method = 'POST') => {
  const r = await handler(new Request('http://x/', { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
reset();
const D1 = '11111111-1111-4111-8111-111111111111', D2 = '22222222-2222-4222-8222-222222222222';
state.tables.departments.push({ id: D1, name: 'Novelty', active: true }, { id: D2, name: 'Bindery', active: true });
state.tables.employees.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', auth_user_id: 'U-MGR', email: 'boss@pressgo.example.com', display_name: 'Boss', manager_role: true, front_desk: true, active: true },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', auth_user_id: 'U-STAFF', email: 'sam@pressgo.example.com', display_name: 'Sam', manager_role: false, front_desk: false, active: true },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', auth_user_id: 'U-OFF', email: 'old@pressgo.example.com', display_name: 'Old', manager_role: true, front_desk: false, active: false });
state.users.push({ id: 'U-MGR', email: 'boss@pressgo.example.com', password: 'x' }, { id: 'U-STAFF', email: 'sam@pressgo.example.com', password: 'x' }, { id: 'U-OFF', email: 'old@pressgo.example.com', password: 'x' });
state.tokenToUser = { MGR: 'U-MGR', STAFF: 'U-STAFF', OFF: 'U-OFF' };
const good = { action: 'create', username: 'Jane', display_name: 'Jane Doe', password: 'longenough1', manager_role: false, front_desk: true, department_ids: [D1] };

// --- who may call
let r = await call('NOPE', good); check(r.status === 401, 'anonymous caller accepted');
r = await call('STAFF', good); check(r.status === 403, 'non-manager created a login');
r = await call('OFF', good); check(r.status === 403, 'disabled manager created a login');
r = await call('MGR', {}, 'GET'); check(r.status === 405, 'GET accepted');
r = await handler(new Request('http://x/', { method: 'OPTIONS' })); check(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*', 'CORS preflight');
check(state.users.length === 3, 'a rejected call still created a login');

// --- create
r = await call('MGR', good); check(r.status === 200 && r.body.username === 'jane', 'manager create failed: ' + JSON.stringify(r.body));
check(state.users.some((u) => u.email === 'jane@pressgo.example.com' && u.password === 'longenough1'), 'auth user missing');
const jane = state.tables.employees.find((e) => e.email === 'jane@pressgo.example.com');
check(jane && jane.front_desk === true && jane.manager_role === false && jane.auth_user_id, 'employee row wrong');
check(state.tables.department_memberships.filter((m) => m.employee_id === jane.id && m.department_id === D1 && m.ended_at === null).length === 1, 'department missing');
check(state.tables.audit_events.some((a) => a.action === 'staff.created' && a.actor_id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'creation not audited with actor');
check(!JSON.stringify(state.tables.audit_events).includes('longenough1'), 'password leaked into history');
r = await call('MGR', good); check(r.status === 400 && /taken/.test(r.body.error), 'duplicate username accepted');
for (const [label, patch] of [['short password', { password: 'short' }], ['long password', { password: 'x'.repeat(73) }], ['bad username', { username: 'a b' }], ['short username', { username: 'ab' }],
  ['symbols', { username: 'a@b.com' }], ['blank name', { display_name: '  ' }], ['unknown dept', { username: 'zed', department_ids: ['99999999-9999-4999-8999-999999999999'] }], ['bad dept id', { username: 'zed', department_ids: ['nope'] }]]) {
  const before = state.users.length;
  r = await call('MGR', { ...good, username: 'x' + Math.random().toString(36).slice(2, 8), ...patch }); check(r.status === 400, label + ' accepted'); check(state.users.length === before, label + ' left a login behind');
}
state.failEmployeeInsert = true; const beforeUsers = state.users.length;
r = await call('MGR', { ...good, username: 'rollback' }); check(r.status === 400 && state.users.length === beforeUsers, 'failed save left an orphan login'); state.failEmployeeInsert = false;

// --- passwords
r = await call('STAFF', { action: 'set_password', employee_id: jane.id, password: 'newpassword1' }); check(r.status === 403, 'staff reset a password');
r = await call('MGR', { action: 'set_password', employee_id: jane.id, password: 'newpassword1' }); check(r.status === 200, 'manager reset failed');
check(state.users.find((u) => u.email === 'jane@pressgo.example.com').password === 'newpassword1', 'password not changed');
r = await call('MGR', { action: 'set_password', employee_id: jane.id, password: 'short' }); check(r.status === 400, 'short reset accepted');
r = await call('MGR', { action: 'set_password', employee_id: 'nope', password: 'newpassword1' }); check(r.status === 400, 'bad id accepted');
check(!JSON.stringify(state.tables.audit_events).includes('newpassword1'), 'reset password leaked into history');

// --- disable / enable
r = await call('MGR', { action: 'set_active', employee_id: jane.id, active: false }); check(r.status === 200 && jane.active === false, 'disable failed');
check(state.banned[jane.auth_user_id] === '876000h', 'disabled person can still sign in');
r = await call('MGR', { action: 'set_active', employee_id: jane.id, active: true }); check(jane.active === true && state.banned[jane.auth_user_id] === 'none', 'enable failed');
r = await call('MGR', { action: 'set_active', employee_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', active: false }); check(r.status === 400 && /own account/.test(r.body.error), 'manager disabled themself');
r = await call('STAFF', { action: 'set_active', employee_id: jane.id, active: false }); check(r.status === 403, 'staff disabled someone');

// --- update + departments
r = await call('MGR', { action: 'update', employee_id: jane.id, display_name: 'Jane D', manager_role: true, front_desk: false, department_ids: [D2] });
check(r.status === 200 && jane.display_name === 'Jane D' && jane.manager_role === true && jane.front_desk === false, 'update failed');
const mem = (d) => state.tables.department_memberships.find((m) => m.employee_id === jane.id && m.department_id === d);
check(mem(D1).ended_at !== null && mem(D2).ended_at === null, 'department switch failed');
r = await call('MGR', { action: 'update', employee_id: jane.id, display_name: 'Jane D', manager_role: true, front_desk: false, department_ids: [D1, D2] });
check(mem(D1).ended_at === null && mem(D2).ended_at === null, 're-adding an old department failed');
r = await call('MGR', { action: 'update', employee_id: jane.id, display_name: '', manager_role: true, front_desk: false, department_ids: [] }); check(r.status === 400, 'blank name update accepted');
r = await call('STAFF', { action: 'update', employee_id: jane.id, display_name: 'Hax', manager_role: true, front_desk: true, department_ids: [] }); check(r.status === 403 && jane.display_name === 'Jane D', 'staff edited someone');
r = await call('MGR', { action: 'bogus' }); check(r.status === 400, 'unknown action accepted');
console.log(fails ? fails + ' CHECKS FAILED' : 'ALL ADMIN-USERS TESTS PASSED'); process.exit(fails ? 1 : 0);
`);
const out = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(tmp, 'test.mjs')], { encoding: 'utf8' });
fs.rmSync(tmp, { recursive: true, force: true });
process.stdout.write(out.stdout + out.stderr); process.exit(out.status ?? 1);
