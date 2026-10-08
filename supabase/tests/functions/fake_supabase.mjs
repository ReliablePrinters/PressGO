// Tiny in-memory stand-in for supabase-js, just enough to exercise the admin-users rules.
export const state = { tables: {}, users: [], banned: {}, nextId: 1, audit: [], tokenToUser: {} };
const uuid = () => '00000000-0000-4000-8000-' + String(state.nextId++).padStart(12, '0');
export function reset() {
  state.tables = { employees: [], departments: [], department_memberships: [], audit_events: [] };
  state.users = []; state.banned = {}; state.nextId = 1; state.tokenToUser = {};
}
class Q {
  constructor(t) { this.t = t; this.filters = []; this.op = 'select'; this.payload = null; this.wantSingle = false; this.wantMaybe = false; }
  select() { return this; }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
  in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
  insert(o) { this.op = 'insert'; this.payload = o; return this; }
  update(o) { this.op = 'update'; this.payload = o; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybe = true; return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    const rows = state.tables[this.t];
    if (this.op === 'insert') {
      const row = { id: uuid(), active: true, manager_role: false, front_desk: false, ended_at: null, ...this.payload };
      if (this.t === 'employees' && rows.some((r) => r.email === row.email)) return { data: null, error: { message: 'duplicate key' } };
      if (this.t === 'employees' && state.failEmployeeInsert) return { data: null, error: { message: 'boom' } };
      rows.push(row);
      return { data: this.wantSingle ? row : [row], error: null };
    }
    const hit = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') {
      if (this.t === 'employees' && this.payload.active === false) {
        for (const r of hit) {
          const others = rows.filter((x) => x !== r && x.manager_role && x.active);
          if (r.manager_role && !others.length) return { data: null, error: { message: 'ERROR: cannot remove or disable the last active manager' } };
        }
      }
      hit.forEach((r) => Object.assign(r, this.payload));
      return { data: hit, error: null };
    }
    if (this.wantSingle) return hit.length ? { data: hit[0], error: null } : { data: null, error: { message: 'no rows' } };
    if (this.wantMaybe) return { data: hit[0] ?? null, error: null };
    return { data: hit, error: null };
  }
}
export function createClient(url, key, opts) {
  const authHeader = opts?.global?.headers?.Authorization ?? '';
  return {
    from: (t) => new Q(t),
    auth: {
      getUser: async () => {
        const uid = state.tokenToUser[authHeader.replace('Bearer ', '')];
        return uid ? { data: { user: { id: uid } } } : { data: { user: null } };
      },
      admin: {
        createUser: async ({ email, password }) => {
          if (state.users.some((u) => u.email === email)) return { data: null, error: { message: 'User already registered' } };
          const u = { id: uuid(), email, password }; state.users.push(u); return { data: { user: u }, error: null };
        },
        deleteUser: async (id) => { state.users = state.users.filter((u) => u.id !== id); return { error: null }; },
        updateUserById: async (id, attrs) => {
          const u = state.users.find((x) => x.id === id); if (!u) return { error: { message: 'no user' } };
          if (attrs.password) u.password = attrs.password;
          if (attrs.ban_duration) state.banned[id] = attrs.ban_duration;
          return { error: null };
        },
      },
    },
  };
}
