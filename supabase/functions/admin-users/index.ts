// PressGO admin-users: the only place that can create logins and set passwords.
// Runs on Supabase (Deno). It checks that the caller is a signed-in, active manager before doing anything.
// The service key it uses is provided by Supabase to the function and never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DOMAIN = 'pressgo.example.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class Fail extends Error {
  msg: string;
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.msg = msg; this.status = status; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkPassword = (p: unknown) => {
  if (typeof p !== 'string' || p.length < 8) throw new Fail('The password must be at least 8 characters.');
  if (p.length > 72) throw new Fail('The password is too long (72 characters at most).');
  return p;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new Fail('Use POST.', 405);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. who is calling?
    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) throw new Fail('Not signed in.', 401);
    const db = createClient(url, service, { db: { schema: 'pressgo' }, auth: { persistSession: false } });
    const { data: caller } = await db.from('employees').select('id,manager_role,active').eq('auth_user_id', u.user.id).maybeSingle();
    if (!caller || !caller.active || !caller.manager_role) throw new Fail('Only a manager can do this.', 403);

    const b = await req.json().catch(() => ({}));
    const audit = (action: string, after: Record<string, unknown>) =>
      db.from('audit_events').insert({ actor_id: caller.id, action, after });

    const findEmployee = async (id: unknown) => {
      if (typeof id !== 'string' || !UUID.test(id)) throw new Fail('Unknown person.');
      const { data } = await db.from('employees').select('id,auth_user_id,email,display_name,active').eq('id', id).maybeSingle();
      if (!data) throw new Fail('Unknown person.');
      return data;
    };
    const checkDepartments = async (ids: unknown) => {
      const list = Array.isArray(ids) ? [...new Set(ids)] : [];
      if (list.some((d) => typeof d !== 'string' || !UUID.test(d))) throw new Fail('Unknown department.');
      if (list.length) {
        const { data } = await db.from('departments').select('id').in('id', list).eq('active', true);
        if ((data ?? []).length !== list.length) throw new Fail('Unknown department.');
      }
      return list as string[];
    };
    const syncDepartments = async (employeeId: string, wanted: string[]) => {
      const { data: rows } = await db.from('department_memberships').select('department_id,ended_at').eq('employee_id', employeeId);
      const have = new Map((rows ?? []).map((r: any) => [r.department_id, r.ended_at]));
      for (const [dep, ended] of have) {
        if (!wanted.includes(dep) && ended === null) {
          await db.from('department_memberships').update({ ended_at: new Date().toISOString() }).eq('employee_id', employeeId).eq('department_id', dep);
        }
      }
      for (const dep of wanted) {
        if (!have.has(dep)) await db.from('department_memberships').insert({ employee_id: employeeId, department_id: dep });
        else if (have.get(dep) !== null) {
          await db.from('department_memberships').update({ ended_at: null, started_at: new Date().toISOString() }).eq('employee_id', employeeId).eq('department_id', dep);
        }
      }
    };

    switch (b.action) {
      case 'create': {
        const username = String(b.username ?? '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new Fail('Usernames are 3–30 letters, numbers, dots, dashes or underscores.');
        const name = String(b.display_name ?? '').trim();
        if (!name || name.length > 60) throw new Fail('Enter the person\'s name (up to 60 characters).');
        const password = checkPassword(b.password);
        const deps = await checkDepartments(b.department_ids);
        const email = `${username}@${DOMAIN}`;
        const { data: dup } = await db.from('employees').select('id').eq('email', email).maybeSingle();
        if (dup) throw new Fail('That username is already taken.');
        const { data: made, error: e1 } = await db.auth.admin.createUser({ email, password, email_confirm: true });
        if (e1 || !made?.user) throw new Fail(/already/i.test(e1?.message ?? '') ? 'That username is already taken.' : 'Could not create the login: ' + (e1?.message ?? 'unknown error'));
        const { data: emp, error: e2 } = await db.from('employees')
          .insert({ auth_user_id: made.user.id, email, display_name: name, manager_role: !!b.manager_role, front_desk: !!b.front_desk, active: true })
          .select('id').single();
        if (e2 || !emp) {
          await db.auth.admin.deleteUser(made.user.id);
          throw new Fail('Could not save the person: ' + (e2?.message ?? 'unknown error'));
        }
        await syncDepartments(emp.id, deps);
        await audit('staff.created', { employee_id: emp.id, username, display_name: name, manager_role: !!b.manager_role, front_desk: !!b.front_desk });
        return json({ ok: true, employee_id: emp.id, username });
      }
      case 'set_password': {
        const emp = await findEmployee(b.employee_id);
        const password = checkPassword(b.password);
        if (!emp.auth_user_id) throw new Fail('This person has no login yet.');
        const { error } = await db.auth.admin.updateUserById(emp.auth_user_id, { password });
        if (error) throw new Fail('Could not change the password: ' + error.message);
        await audit('staff.password_reset', { employee_id: emp.id });
        return json({ ok: true });
      }
      case 'set_active': {
        const emp = await findEmployee(b.employee_id);
        const active = !!b.active;
        if (emp.id === caller.id && !active) throw new Fail('You cannot disable your own account.');
        const { error: e1 } = await db.from('employees').update({ active }).eq('id', emp.id);
        if (e1) throw new Fail(e1.message.replace(/^.*?ERROR:\s*/, ''));
        if (emp.auth_user_id) await db.auth.admin.updateUserById(emp.auth_user_id, { ban_duration: active ? 'none' : '876000h' });
        await audit(active ? 'staff.enabled' : 'staff.disabled', { employee_id: emp.id });
        return json({ ok: true });
      }
      case 'update': {
        const emp = await findEmployee(b.employee_id);
        const name = String(b.display_name ?? '').trim();
        if (!name || name.length > 60) throw new Fail('Enter the person\'s name (up to 60 characters).');
        const deps = await checkDepartments(b.department_ids);
        const { error } = await db.from('employees').update({ display_name: name, manager_role: !!b.manager_role, front_desk: !!b.front_desk }).eq('id', emp.id);
        if (error) throw new Fail(error.message.replace(/^.*?ERROR:\s*/, ''));
        await syncDepartments(emp.id, deps);
        await audit('staff.updated', { employee_id: emp.id, display_name: name, manager_role: !!b.manager_role, front_desk: !!b.front_desk, department_ids: deps });
        return json({ ok: true });
      }
      default:
        throw new Fail('Unknown action.');
    }
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.msg }, e.status);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
