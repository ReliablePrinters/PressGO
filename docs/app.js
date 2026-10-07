'use strict';
const sb = window.supabase.createClient(PRESSGO.url, PRESSGO.key, { db: { schema: 'pressgo' } });
const $app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const LOGIN_DOMAIN = 'pressgo.example.com';   // a username "jane" signs in as jane@pressgo.example.com (nothing is ever emailed there)
let me = null;            // my employee record
let depts = [];           // active departments
let myDepts = new Set();  // ids of departments I belong to
const inDept = (id) => myDepts.has(id);
const STATUSES = ['New', 'Queued', 'In Production', 'Finishing', 'Ready for Collection', 'Collected', 'Cancelled'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const isClosed = (j) => j.lifecycle_status === 'Collected' || j.lifecycle_status === 'Cancelled';
const isLate = (j) => !isClosed(j) && j.lifecycle_status !== 'Ready for Collection' && new Date(j.due_at) < new Date();
const canCreate = () => me && (me.manager_role || me.front_desk);
const friendly = (e) => (e && e.message ? e.message : String(e)).replace(/^.*?ERROR:\s*/, '');

// ---------------------------------------------------------------- small helpers
function ask(title, fields, okLabel = 'OK') {
  return new Promise((resolve) => {
    dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${fields}
      <div class="actions" style="justify-content:flex-end"><button type="button" id="dx">Cancel</button><button class="primary" value="ok">${esc(okLabel)}</button></div></form>`;
    const f = dlg.querySelector('form');
    dlg.querySelector('#dx').onclick = () => { dlg.close(); resolve(null); };
    f.onsubmit = () => {
      const o = {};
      for (const [k, v] of new FormData(f)) o[k] = k in o ? [].concat(o[k], v) : v;
      resolve(o);
    };
    dlg.onclose = () => resolve(null);
    dlg.showModal();
  });
}
async function call(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}

function alert2(msg) { return ask('PressGO', `<p>${esc(msg)}</p>`, 'OK'); }
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (error) {
    let m = 'Could not reach the server. Please try again.';
    try { m = (await error.context.json()).error || m; } catch (_) { /* keep default */ }
    throw new Error(m);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------- auth
async function start() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return showLogin();
  await loadMe(data.session);
}
async function loadMe(session) {
  $app.innerHTML = '<main><p class="note">Loading…</p></main>';
  let { data: emp } = await sb.from('employees').select('*').eq('auth_user_id', session.user.id).maybeSingle();
  if (!emp) {
    const { error } = await sb.rpc('accept_invitation');
    if (error) return showBlocked(session, friendly(error));
    ({ data: emp } = await sb.from('employees').select('*').eq('auth_user_id', session.user.id).maybeSingle());
  }
  if (!emp || !emp.active) return showBlocked(session, 'Your access has been disabled.');
  me = emp;
  const { data: d } = await sb.from('departments').select('id,name').eq('active', true).order('name');
  depts = d || [];
  const { data: mem } = await sb.from('department_memberships').select('department_id').eq('employee_id', emp.id).is('ended_at', null);
  myDepts = new Set((mem || []).map((m) => m.department_id));
  window.onhashchange = route;
  route();
}
function showLogin(msg = '') {
  $app.innerHTML = `<div class="center card"><div class="logo big">P</div><h2>PressGO</h2><p class="note">Staff sign-in. Use the username and password your manager gave you.</p>
    <form id="lf"><label>Username<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
    <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
    <div class="err" id="lerr">${esc(msg)}</div>
    <div class="actions"><button class="primary" type="submit">Sign in</button></div></form>
    <p class="note">Forgot your password? Ask a manager to reset it for you.</p></div>`;
  const f = document.getElementById('lf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const u = f.username.value.trim().toLowerCase();
    const email = u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
    const { error } = await sb.auth.signInWithPassword({ email, password: f.password.value });
    if (error) return (document.getElementById('lerr').textContent = /invalid login/i.test(error.message) ? 'Wrong username or password.' : error.message);
    start();
  };
}
function showBlocked(session, why) {
  $app.innerHTML = `<div class="center card"><h2>No access yet</h2><p>${esc(why)}</p>
    <p class="note">Signed in as ${esc(session.user.email.split('@')[0])}. Ask a manager to check your account, then sign in again.</p>
    <button id="so">Sign out</button></div>`;
  document.getElementById('so').onclick = async () => { await sb.auth.signOut(); showLogin(); };
}

// ---------------------------------------------------------------- shell + routing
function shell(active, inner) {
  const nav = (href, key, label) => `<a class="nav ${active === key ? 'on' : ''}" href="${href}">${label}</a>`;
  const roles = [me.manager_role ? 'Manager' : '', me.front_desk ? 'Front Desk' : ''].filter(Boolean).join(' · ');
  $app.innerHTML = `<div class="app" id="appbox"><div class="mobbar"><button id="burger" aria-label="Menu">☰</button><b>PressGO</b></div>
    <aside class="side"><div class="brand"><span class="logo">P</span>PressGO</div><div class="scroll">
      ${nav('#/home', 'home', 'Home')}${nav('#/jobs', 'jobs', 'Jobs')}${canCreate() ? nav('#/new', 'new', '+ New job') : ''}${nav('#/tasks', 'tasks', 'Tasks')}<a class="nav ${active === 'alerts' ? 'on' : ''}" href="#/alerts" id="alertlink">Alerts</a>${me.manager_role ? nav('#/staff', 'staff', 'Staff') : ''}
      <div id="sidechats"></div></div>
    <div class="foot"><div class="me2">${window.pgAvatar(me.display_name, 36)}<div><b>${esc(me.display_name)}</b><div class="note">${esc(roles)}</div></div></div>
      <div class="actions"><button id="cpw">Change password</button><button id="so">Sign out</button></div></div></aside>
    <div class="content"><main>${inner}</main></div></div>`;
  const box = document.getElementById('appbox');
  document.getElementById('burger').onclick = () => box.classList.toggle('nav-open');
  box.querySelector('.side').onclick = (e) => { if (e.target.closest('a')) box.classList.remove('nav-open'); };
  if (window.chatSidebar) window.chatSidebar();
  if (window.alertBadge) window.alertBadge();
  document.getElementById('cpw').onclick = async () => {
    const r = await ask('Change my password', '<label>New password (at least 8 characters)<input name="p1" type="password" required minlength="8" autocomplete="new-password"></label><label>Type it again<input name="p2" type="password" required minlength="8" autocomplete="new-password"></label>', 'Save password');
    if (!r) return;
    if (r.p1 !== r.p2) return alert2('The two passwords did not match. Nothing was changed.');
    const { error } = await sb.auth.updateUser({ password: r.p1 });
    alert2(error ? error.message : 'Your password has been changed.');
  };
  document.getElementById('so').onclick = async () => { await sb.auth.signOut(); me = null; showLogin(); };
}
function route() {
  const h = location.hash || '#/home';
  if (window.chatLeave) window.chatLeave();
  if (h.startsWith('#/chat')) return window.viewChat(h);
  if (h === '#/home') return window.viewHome();
  if (h === '#/tasks') return window.viewTasks();
  if (h === '#/alerts') return window.viewAlerts();
  if (h === '#/new') return canCreate() ? viewNew() : (location.hash = '#/jobs');
  if (h === '#/staff') return me.manager_role ? viewStaff() : (location.hash = '#/jobs');
  const m = h.match(/^#\/job\/([0-9a-f-]{36})$/);
  if (m) return viewJob(m[1]);
  return viewJobs();
}

// ---------------------------------------------------------------- jobs list
async function viewJobs() {
  shell('jobs', '<p class="note">Loading jobs…</p>');
  const { data: jobs, error } = await sb.from('jobs')
    .select('id,job_number,customer_name,description,quantity,due_at,priority,lifecycle_status,current_department_id,current_assignee_id,departments:current_department_id(name),assignee:current_assignee_id(display_name)')
    .order('due_at');
  if (error) return shell('jobs', `<p class="err">${esc(friendly(error))}</p>`);
  const [{ data: oh }, { data: ph }] = await Promise.all([
    sb.from('job_holds').select('job_id').is('resolved_at', null),
    sb.from('job_handoffs').select('job_id,to_department_id').eq('status', 'Pending')]);
  const holdSet = new Set((oh || []).map((h) => h.job_id));
  const handMap = new Map((ph || []).map((h) => [h.job_id, h.to_department_id]));
  const state = { q: '', status: 'active', dept: '', mine: false };
  const draw = () => {
    const q = state.q.toLowerCase();
    const list = jobs.filter((j) =>
      (state.status === 'active' ? !isClosed(j) : state.status === 'all' ? true : j.lifecycle_status === state.status) &&
      (!state.dept || j.current_department_id === state.dept) &&
      (!state.mine || j.current_assignee_id === me.id) &&
      (!q || `${j.job_number} ${j.customer_name} ${j.description}`.toLowerCase().includes(q))
    ).sort((a, b) => (b.priority === 'Rush') - (a.priority === 'Rush') || new Date(a.due_at) - new Date(b.due_at));
    document.getElementById('jl').innerHTML = list.length ? list.map((j) => `
      <a class="job" href="#/job/${j.id}">
        <div><div class="num">#${j.job_number}</div><span class="badge st ${isClosed(j) ? 'done' : ''}">${esc(j.lifecycle_status)}</span></div>
        <div><div><b>${esc(j.customer_name)}</b> — ${esc(j.description)} <span class="sub">×${j.quantity}</span></div>
          <div class="sub">${esc(j.departments?.name || 'No department')} · ${j.assignee ? window.pgAvatar(j.assignee.display_name, 18) + ' ' + esc(j.assignee.display_name) : 'Unassigned'}</div></div>
        <div>${holdSet.has(j.id) ? '<span class="badge late">Problem</span>' : ''}${handMap.has(j.id) ? `<span class="badge st">${inDept(handMap.get(j.id)) ? 'Waiting for you to accept' : 'Handoff pending'}</span>` : ''}${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}${isLate(j) ? '<span class="badge late">Overdue</span>' : ''}<span class="sub">Due ${esc(fmt(j.due_at))}</span></div>
      </a>`).join('') : '<p class="note">No jobs match.</p>';
  };
  shell('jobs', `<h2>Jobs</h2><div class="toolbar">
    <input id="q" type="search" placeholder="Search number, customer, description">
    <select id="st"><option value="active">Active</option><option value="all">All</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select>
    <select id="dp"><option value="">All departments</option>${depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
    <label class="inline" style="margin:0"><input type="checkbox" id="mine"> My jobs</label></div><div id="jl"></div>`);
  document.getElementById('q').oninput = (e) => { state.q = e.target.value; draw(); };
  document.getElementById('st').onchange = (e) => { state.status = e.target.value; draw(); };
  document.getElementById('dp').onchange = (e) => { state.dept = e.target.value; draw(); };
  document.getElementById('mine').onchange = (e) => { state.mine = e.target.checked; draw(); };
  draw();
}

// ---------------------------------------------------------------- create
function viewNew() {
  const reqId = crypto.randomUUID();                       // same id on retry => one job only
  const tomorrow = new Date(Date.now() + 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  shell('new', `<h2>New job</h2><form class="card" id="nf">
    <div class="grid2"><label>Customer *<input name="customer" required></label><label>Phone<input name="phone"></label></div>
    <label>Job description *<textarea name="desc" rows="2" required placeholder="e.g. 500 flyers, A5, double-sided"></textarea></label>
    <div class="grid3"><label>Product<input name="product" placeholder="Flyers, banner…"></label><label>Quantity *<input name="qty" type="number" min="1" required></label><label>Size<input name="size"></label></div>
    <div class="grid2"><label>Material<input name="material"></label><label>Finishing<input name="finishing"></label></div>
    <div class="grid3"><label>Due *<input name="due" type="datetime-local" value="${tomorrow}" required></label>
      <label>Priority<select name="priority"><option>Normal</option><option>Rush</option><option>Low</option></select></label>
      <label>Department *<select name="dept" required>${depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label></div>
    <label>Assign to (optional)<select name="assignee"><option value="">Unassigned</option></select></label>
    ${me.manager_role ? '<label class="inline"><input type="checkbox" name="noart"> Artwork not required for this job</label>' : ''}
    <div class="err" id="ne"></div><div class="actions"><button class="primary" id="nb" type="submit">Create job</button></div></form>`);
  const f = document.getElementById('nf');
  const loadStaff = async () => {
    const { data } = await sb.rpc('department_staff', { p_dept: f.dept.value });
    f.assignee.innerHTML = '<option value="">Unassigned</option>' + (data || []).map((s) => `<option value="${s.employee_id}">${esc(s.display_name)}</option>`).join('');
  };
  f.dept.onchange = loadStaff; loadStaff();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = document.getElementById('nb'); b.disabled = true;                      // no double-taps
    try {
      const j = await call('create_job', {
        p_request_id: reqId, p_customer: f.customer.value, p_phone: f.phone.value, p_desc: f.desc.value, p_product: f.product.value,
        p_qty: Number(f.qty.value), p_size: f.size.value, p_material: f.material.value, p_finishing: f.finishing.value,
        p_due: new Date(f.due.value).toISOString(), p_priority: f.priority.value, p_dept: f.dept.value,
        p_assignee: f.assignee.value || null, p_artwork_required: !(f.noart && f.noart.checked)
      });
      location.hash = '#/job/' + j.id;
    } catch (err) { document.getElementById('ne').textContent = friendly(err); b.disabled = false; }   // entered values are kept
  };
}

// ---------------------------------------------------------------- staff (managers only)
async function viewStaff() {
  shell('staff', '<p class="note">Loading staff…</p>');
  const [{ data: emps, error }, { data: mems }] = await Promise.all([
    sb.from('employees').select('id,username,display_name,active,manager_role,front_desk,auth_user_id').order('display_name'),
    sb.from('department_memberships').select('employee_id,department_id').is('ended_at', null)]);
  if (error) return shell('staff', `<p class="err">${esc(friendly(error))}</p>`);
  const deptOf = (id) => (mems || []).filter((m) => m.employee_id === id).map((m) => m.department_id);
  const nameOf = (id) => depts.find((d) => d.id === id)?.name || '?';
  const deptBoxes = (sel) => depts.map((d) => `<label class="inline"><input type="checkbox" name="dept" value="${d.id}" ${sel.includes(d.id) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('');
  shell('staff', `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin:0">Staff</h2><button class="primary" id="addst">+ Add staff</button></div>
    <div class="err" id="se"></div>
    <div class="card">${(emps || []).map((e) => `<div class="job" style="grid-template-columns:1fr auto;${e.active ? '' : 'opacity:.6'}">
      <div class="who">${window.pgAvatar(e.display_name, 38)}<div><b>${esc(e.display_name)}</b> <span class="sub">username: ${esc(e.username)}</span>
        <div>${e.manager_role ? '<span class="badge st">Manager</span>' : ''}${e.front_desk ? '<span class="badge st">Front Desk</span>' : ''}${e.active ? '' : '<span class="badge late">Disabled</span>'}${!e.auth_user_id ? '<span class="badge">No login yet</span>' : ''}</div>
        <div class="sub">${deptOf(e.id).map(nameOf).join(', ') || 'No department'}</div></div></div>
      <div class="actions" data-id="${e.id}"><button data-a="edit">Edit…</button><button data-a="pw">Reset password…</button>
        ${e.id === me.id ? '' : `<button data-a="${e.active ? 'off' : 'on'}" class="${e.active ? 'danger' : ''}">${e.active ? 'Disable' : 'Enable'}</button>`}</div></div>`).join('')}</div>
    <p class="note">Usernames are lower-case and cannot be changed later. A disabled person cannot sign in but their history is kept.</p>`);
  const fail = (e) => (document.getElementById('se').textContent = friendly(e));
  const done = () => viewStaff();
  document.getElementById('addst').onclick = async () => {
    const r = await ask('Add staff', `<label>Username (letters, numbers, dots, dashes)<input name="username" required minlength="3" maxlength="30" autocapitalize="none" spellcheck="false"></label>
      <label>Name<input name="name" required maxlength="60"></label>
      <label>Temporary password (at least 8 characters)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <p class="note">Tell them their password in person. They can change it with “Change password”.</p>
      <label class="inline"><input type="checkbox" name="mgr"> Manager</label><label class="inline"><input type="checkbox" name="fd"> Front Desk</label>
      <div class="note">Departments</div>${deptBoxes([])}`, 'Create login');
    if (!r) return;
    try { await adminCall({ action: 'create', username: r.username, display_name: r.name, password: r.password, manager_role: !!r.mgr, front_desk: !!r.fd, department_ids: [].concat(r.dept || []) }); done(); } catch (e) { fail(e); }
  };
  document.querySelector('.card').onclick = async (ev) => {
    const b = ev.target.closest('button[data-a]'); if (!b) return;
    const id = b.closest('[data-id]').dataset.id; const e = emps.find((x) => x.id === id);
    try {
      if (b.dataset.a === 'pw') {
        const r = await ask(`Reset password for ${e.display_name}`, '<label>New password (at least 8 characters)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><p class="note">Tell them the new password in person.</p>', 'Set password');
        if (r) { await adminCall({ action: 'set_password', employee_id: id, password: r.password }); await alert2('Password changed.'); }
      } else if (b.dataset.a === 'edit') {
        const r = await ask(`Edit ${e.display_name}`, `<label>Name<input name="name" value="${esc(e.display_name)}" required maxlength="60"></label>
          <label class="inline"><input type="checkbox" name="mgr" ${e.manager_role ? 'checked' : ''}> Manager</label><label class="inline"><input type="checkbox" name="fd" ${e.front_desk ? 'checked' : ''}> Front Desk</label>
          <div class="note">Departments</div>${deptBoxes(deptOf(id))}`, 'Save');
        if (r) { await adminCall({ action: 'update', employee_id: id, display_name: r.name, manager_role: !!r.mgr, front_desk: !!r.fd, department_ids: [].concat(r.dept || []) }); done(); }
      } else if (b.dataset.a === 'off' || b.dataset.a === 'on') {
        await adminCall({ action: 'set_active', employee_id: id, active: b.dataset.a === 'on' }); done();
      }
    } catch (err) { fail(err); }
  };
}

// ---------------------------------------------------------------- job detail
async function viewJob(id) {
  shell('jobs', '<p class="note">Loading…</p>');
  const [{ data: j, error }, { data: hist }, { data: files }, { data: holds }, { data: hand }] = await Promise.all([
    sb.from('jobs').select('*,departments:current_department_id(name),assignee:current_assignee_id(display_name)').eq('id', id).maybeSingle(),
    sb.from('audit_events').select('id,action,reason,created_at,before,after,actor:actor_id(display_name)').eq('job_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }),
    sb.from('job_files').select('id,category,file_name,size_bytes,version_no,storage_path,uploaded_at,uploader:uploaded_by(display_name)').eq('job_id', id).order('uploaded_at', { ascending: false }),
    sb.from('job_holds').select('id,kind,note,raised_at,resolved_at,resolution_note,raiser:raised_by(display_name),resolver:resolved_by(display_name)').eq('job_id', id).order('raised_at', { ascending: false }),
    sb.from('job_handoffs').select('id,note,status,created_at,from_department_id,to_department_id,sender:from_employee_id(display_name)').eq('job_id', id).order('created_at', { ascending: false })
  ]);
  if (error || !j) return shell('jobs', '<div class="card"><h2>You don\'t have access</h2><p class="note">This job doesn\'t exist or isn\'t available to you.</p><a href="#/jobs">Back to jobs</a></div>');

  const mgr = me.manager_role, fd = me.front_desk, owner = j.current_assignee_id === me.id;
  const acts = [];
  const move = (to, label, cls = '', needReason = false) => acts.push({ to, label, cls, needReason });
  if (!isClosed(j)) {
    if (!j.current_assignee_id && !(mgr || fd)) acts.push({ accept: true, label: 'Accept job' });
    if (j.lifecycle_status === 'New' && (mgr || fd)) move('Queued', 'Release to production');
    if (j.lifecycle_status === 'Queued' && (owner || mgr)) move('In Production', 'Start', 'primary', !owner);
    if (j.lifecycle_status === 'In Production' && (owner || mgr)) { move('Finishing', 'Send to finishing', '', !owner); move('Ready for Collection', 'Mark ready', 'primary', !owner); }
    if (j.lifecycle_status === 'Finishing' && (owner || mgr)) move('Ready for Collection', 'Mark ready', 'primary', !owner);
    if (j.lifecycle_status === 'Ready for Collection' && (mgr || fd)) move('Collected', 'Mark collected', 'primary');
  }
  const idx = ['New', 'Queued', 'In Production', 'Finishing', 'Ready for Collection', 'Collected'].indexOf(j.lifecycle_status);
  const blocked = j.lifecycle_status === 'Queued' && j.artwork_required && !j.approved_file_id
    ? '<p class="note">Artwork must be uploaded and approved by a manager before this job can start.</p>' : '';
  const openHolds = (holds || []).filter((h) => !h.resolved_at);
  const pending = (hand || []).find((h) => h.status === 'Pending');
  const deptName = (id_) => depts.find((d) => d.id === id_)?.name || 'another department';
  const approved = (files || []).find((f) => f.id === j.approved_file_id);
  const newerThanApproval = approved && (files || []).some((f) => f.category !== 'Supporting Document' && f.uploaded_at > approved.uploaded_at);
  const size = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

  const histHtml = (hist || []).map((h) => {
    const who = h.actor?.display_name || 'System';
    const name = { 'job.created': 'created the job', 'job.assigned': 'changed the owner or department', 'job.unassigned': 'removed the owner', 'job.details_changed': 'changed the details',
      'file.uploaded': 'uploaded a file', 'job.artwork_approved': 'approved artwork', 'job.artwork_approval_withdrawn': 'withdrew artwork approval',
      'job.problem_raised': 'reported a problem', 'job.problem_resolved': 'resolved a problem', 'job.handoff_sent': 'sent a handoff',
      'job.handoff_accepted': 'accepted a handoff', 'job.handoff_cancelled': 'cancelled a handoff' }[h.action]
      || (h.action.startsWith('job.status_') ? `changed status: ${esc(h.before?.lifecycle_status)} → <b>${esc(h.after?.lifecycle_status)}</b>` : esc(h.action));
    return `<li><div>${window.pgAvatar(who, 20)} <b>${esc(who)}</b> ${name}${h.action === 'file.uploaded' && h.after ? ` — ${esc(h.after.file_name)} (${esc(h.after.category)})` : ''}${h.action === 'job.handoff_sent' && h.after ? ` — <i>${esc(h.after.note)}</i>` : ''}${h.reason ? ` — <i>${esc(h.reason)}</i>` : ''}</div><div class="when">${esc(fmt(h.created_at))}</div></li>`;
  }).join('') || '<li class="note">No history yet.</li>';

  shell('jobs', `<p><a href="#/jobs">← All jobs</a> · <a href="#/chat/job/${j.id}">Job chat</a></p>
    <div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="margin:0">#${j.job_number} · ${esc(j.customer_name)}</h2>
      <div><span class="badge st ${isClosed(j) ? 'done' : ''}">${esc(j.lifecycle_status)}</span>${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}${isLate(j) ? '<span class="badge late">Overdue</span>' : ''}</div></div>
      <p>${esc(j.description)}</p>
      <dl class="kv"><dt>Department</dt><dd>${esc(j.departments?.name || '—')}</dd><dt>Owner</dt><dd>${j.assignee ? window.pgAvatar(j.assignee.display_name, 22) + ' ' + esc(j.assignee.display_name) : 'Unassigned'}</dd>
        <dt>Due</dt><dd>${esc(fmt(j.due_at))}</dd><dt>Quantity</dt><dd>${j.quantity}</dd><dt>Product</dt><dd>${esc(j.product || '—')}</dd><dt>Size</dt><dd>${esc(j.size || '—')}</dd>
        <dt>Material</dt><dd>${esc(j.material || '—')}</dd><dt>Finishing</dt><dd>${esc(j.finishing || '—')}</dd><dt>Customer phone</dt><dd>${esc(j.customer_phone || '—')}</dd>
        <dt>Artwork</dt><dd>${j.artwork_required ? (approved ? 'Approved for Print: ' + esc(approved.file_name) + ' (v' + approved.version_no + ')' : 'Required — not yet approved') : 'Not required'}</dd></dl>
      ${blocked}<div class="err" id="je"></div>
      <div class="actions" id="acts">${acts.map((a, i) => `<button class="${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}
        ${!isClosed(j) && (mgr || fd) ? '<button id="asg">Assign…</button><button id="edt">Edit details</button>' : ''}
        ${mgr && !isClosed(j) ? '<button id="cnl" class="danger">Cancel job</button>' : ''}
        ${mgr && idx > 0 && !isClosed(j) ? '<button id="back">Move back…</button>' : ''}
        ${mgr && isClosed(j) ? '<button id="reopen">Reopen…</button>' : ''}</div></div>
    <div id="j3">
    ${pending ? `<div class="card notice"><h3 style="margin-top:0">Handoff waiting</h3>
      <p>${esc(pending.sender?.display_name || 'Someone')} sent this job from <b>${esc(deptName(pending.from_department_id))}</b> to <b>${esc(deptName(pending.to_department_id))}</b>: <i>${esc(pending.note)}</i></p>
      <div class="actions">${(me.manager_role || inDept(pending.to_department_id)) ? `<button class="primary" data-act="accept" data-id="${pending.id}">Accept job</button>` : ''}
      ${(mgr || fd || pending.sender?.display_name === me.display_name) ? `<button data-act="cancelhand" data-id="${pending.id}">Cancel handoff</button>` : ''}</div></div>` : ''}
    <div class="card"><h3 style="margin-top:0">Problems${openHolds.length ? ` <span class="badge late">${openHolds.length} open</span>` : ''}</h3>
      ${(holds || []).length ? `<ul class="hist">${holds.map((h) => `<li><div><b>${esc(h.kind)}</b> — ${esc(h.note)} <span class="sub">raised by ${esc(h.raiser?.display_name || '')}</span>
        ${h.resolved_at ? `<div class="sub">Resolved by ${esc(h.resolver?.display_name || '')}: ${esc(h.resolution_note || '')}</div>` : `<div class="actions"><button data-act="resolve" data-id="${h.id}">Resolve…</button></div>`}</div>
        <div class="when">${esc(fmt(h.raised_at))}</div></li>`).join('')}</ul>` : '<p class="note">No problems on this job.</p>'}
      ${openHolds.length ? '<p class="note">While a problem is open, this job cannot move forward.</p>' : ''}
      ${!isClosed(j) ? '<div class="actions"><button data-act="raise">Report a problem…</button></div>' : ''}</div>
    <div class="card"><h3 style="margin-top:0">Files</h3>
      ${newerThanApproval ? '<p class="err">A newer file was uploaded after the approved artwork. A manager should check which one to approve.</p>' : ''}
      ${(files || []).length ? `<ul class="hist">${files.map((f) => `<li><div><b>${esc(f.file_name)}</b> <span class="badge st">v${f.version_no}</span><span class="badge">${esc(f.category)}</span>${f.id === j.approved_file_id ? '<span class="badge ok">Approved for Print</span>' : ''}
        <div class="sub">${esc(size(f.size_bytes))} · ${esc(f.uploader?.display_name || '')} · ${esc(fmt(f.uploaded_at))}</div>
        <div class="actions"><button data-act="dl" data-path="${esc(f.storage_path)}">Open</button>
        ${mgr && !isClosed(j) && f.category !== 'Supporting Document' && f.id !== j.approved_file_id ? `<button class="primary" data-act="approve" data-id="${f.id}">Approve for Print</button>` : ''}</div></div></li>`).join('')}</ul>` : '<p class="note">No files yet.</p>'}
      ${mgr && j.approved_file_id && !isClosed(j) ? '<div class="actions"><button data-act="unapprove">Withdraw approval…</button></div>' : ''}
      ${!isClosed(j) ? `<form id="upf" class="uploadbox"><div class="grid2"><label>File<input type="file" name="file" required></label>
        <label>Type<select name="cat"><option>Customer Original</option><option>Artwork Revision</option>${(mgr || fd) ? '<option>Production Approved</option>' : ''}<option>Supporting Document</option></select></label></div>
        <div class="note">Files are private to staff who can see this job. Up to 100 MB. They are kept permanently; a new upload becomes a new version.</div>
        <div class="err" id="ue"></div><div class="actions"><button class="primary" id="ub" type="submit">Upload</button></div></form>` : ''}</div>
    ${!isClosed(j) && !pending && (owner || mgr || fd) ? `<div class="card"><h3 style="margin-top:0">Hand off</h3><p class="note">Send this job to another department. They must accept it.</p>
      <div class="actions"><button data-act="handoff">Hand off to another department…</button></div></div>` : ''}
    </div>
    <div id="jobtasks"></div>
    <div class="card"><h3 style="margin-top:0">History</h3><ul class="hist">${histHtml}</ul></div>`);
  if (window.jobTasks) window.jobTasks(id);

  const run = async (p) => {
    try { await p; viewJob(id); }
    catch (e) {
      const m = friendly(e);
      document.getElementById('je').textContent = e.code === '40001' || /version conflict/.test(m) ? 'Someone else just changed this job. It has been refreshed — please check and try again.' : m;
      if (e.code === '40001' || /version conflict/.test(m)) setTimeout(() => viewJob(id), 1500);
    }
  };
  const reasonDlg = (title) => ask(title, '<label>Reason<textarea name="reason" rows="2" required></textarea></label>', 'Confirm');
  document.getElementById('acts').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.i !== undefined) {
      const a = acts[b.dataset.i];
      if (a.accept) return run(call('assign_job', { p_job: id, p_version: j.version, p_assignee: me.id }));
      let reason = null;
      if (a.needReason) { const r = await reasonDlg('Manager override — why?'); if (!r) return; reason = r.reason; }
      return run(call('transition_job', { p_job: id, p_version: j.version, p_to: a.to, p_reason: reason }));
    }
    if (b.id === 'cnl') { const r = await reasonDlg('Cancel this job — why?'); if (r) run(call('transition_job', { p_job: id, p_version: j.version, p_to: 'Cancelled', p_reason: r.reason })); }
    if (b.id === 'reopen') {
      const r = await ask('Reopen job', `<label>Reopen to<select name="to"><option>Queued</option><option>New</option>${j.lifecycle_status === 'Collected' ? '<option>Ready for Collection</option>' : ''}</select></label><label>Reason<textarea name="reason" rows="2" required></textarea></label>`, 'Reopen');
      if (r) run(call('transition_job', { p_job: id, p_version: j.version, p_to: r.to, p_reason: r.reason }));
    }
    if (b.id === 'back') {
      const prior = STATUSES.slice(0, idx);
      const r = await ask('Move job back', `<label>Move to<select name="to">${prior.map((s) => `<option>${s}</option>`).join('')}</select></label><label>Reason<textarea name="reason" rows="2" required></textarea></label>`, 'Move');
      if (r) run(call('transition_job', { p_job: id, p_version: j.version, p_to: r.to, p_reason: r.reason }));
    }
    if (b.id === 'asg') {
      const { data: staff } = await sb.rpc('department_staff', { p_dept: j.current_department_id });
      const r = await ask('Assign job', `<label>Department<select name="dept">${depts.map((d) => `<option value="${d.id}" ${d.id === j.current_department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
        <label>Owner<select name="who"><option value="">Unassigned</option>${(staff || []).map((s) => `<option value="${s.employee_id}" ${s.employee_id === j.current_assignee_id ? 'selected' : ''}>${esc(s.display_name)}</option>`).join('')}</select></label>
        <p class="note">To assign someone in a different department, pick that department first, save, then assign the person.</p>`, 'Save');
      if (r) run(call('assign_job', { p_job: id, p_version: j.version, p_assignee: r.dept === j.current_department_id ? (r.who || null) : null, p_dept: r.dept }));
    }
    if (b.id === 'edt') {
      const loc = new Date(new Date(j.due_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
      const r = await ask('Edit details', `<label>Customer<input name="customer" value="${esc(j.customer_name)}" required></label><label>Phone<input name="phone" value="${esc(j.customer_phone || '')}"></label>
        <label>Description<textarea name="desc" rows="2" required>${esc(j.description)}</textarea></label>
        <div class="grid2"><label>Product<input name="product" value="${esc(j.product || '')}"></label><label>Quantity<input name="qty" type="number" min="1" value="${j.quantity}" required></label>
        <label>Size<input name="size" value="${esc(j.size || '')}"></label><label>Material<input name="material" value="${esc(j.material || '')}"></label></div>
        <label>Finishing<input name="finishing" value="${esc(j.finishing || '')}"></label>
        <div class="grid2"><label>Due<input name="due" type="datetime-local" value="${loc}" required></label><label>Priority<select name="priority">${['Normal', 'Rush', 'Low'].map((p) => `<option ${p === j.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
        <label>Reason (required if you change the due date or priority)<input name="reason"></label>`, 'Save');
      if (r) run(call('update_job_details', { p_job: id, p_version: j.version, p_customer: r.customer, p_phone: r.phone, p_desc: r.desc, p_product: r.product, p_qty: Number(r.qty), p_size: r.size, p_material: r.material, p_finishing: r.finishing, p_due: new Date(r.due).toISOString(), p_priority: r.priority, p_reason: r.reason }));
    }
  };

  const inline = (title, body, ok) => ask(title, body, ok);
  const upf = document.getElementById('upf');
  if (upf) upf.onsubmit = async (e) => {
    e.preventDefault();
    const file = upf.file.files[0]; const ub = document.getElementById('ub'); const ue = document.getElementById('ue');
    ue.textContent = '';
    if (!file) return;
    if (file.size > 104857600) return (ue.textContent = 'That file is over 100 MB.');
    ub.disabled = true; ub.textContent = 'Uploading…';
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
    const path = `${id}/${crypto.randomUUID()}-${safe}`;
    try {
      const up = await sb.storage.from('job-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (up.error) throw up.error;
      await call('register_file', { p_job: id, p_category: upf.cat.value, p_name: file.name, p_mime: file.type || null, p_size: file.size, p_path: path });
      viewJob(id);
    } catch (err) { ue.textContent = friendly(err); ub.disabled = false; ub.textContent = 'Upload'; }
  };
  const j3 = document.getElementById('j3');
  j3.onclick = async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act, bid = b.dataset.id;
    if (act === 'dl') {
      const { data, error: er } = await sb.storage.from('job-files').createSignedUrl(b.dataset.path, 120);
      if (er) return (document.getElementById('je').textContent = friendly(er));
      return window.open(data.signedUrl, '_blank', 'noopener');
    }
    if (act === 'approve') return run(call('approve_artwork', { p_job: id, p_version: j.version, p_file: bid }));
    if (act === 'unapprove') { const r = await reasonDlg('Withdraw artwork approval — why?'); if (r) run(call('withdraw_artwork_approval', { p_job: id, p_version: j.version, p_reason: r.reason })); }
    if (act === 'raise') {
      const r = await ask('Report a problem', `<label>What kind?<select name="kind">${['Missing artwork', 'Waiting on customer', 'Material shortage', 'Machine problem', 'Quality problem', 'Other'].map((k) => `<option>${k}</option>`).join('')}</select></label>
        <label>Details<textarea name="note" rows="3" required></textarea></label><p class="note">The job cannot move forward until this is resolved.</p>`, 'Report');
      if (r) run(call('raise_hold', { p_job: id, p_kind: r.kind, p_note: r.note }));
    }
    if (act === 'resolve') { const r = await ask('Resolve problem', '<label>How was it resolved?<textarea name="note" rows="2" required></textarea></label>', 'Resolve'); if (r) run(call('resolve_hold', { p_hold: bid, p_note: r.note })); }
    if (act === 'handoff') {
      const others = depts.filter((d) => d.id !== j.current_department_id);
      const r = await ask('Hand off job', `<label>Send to<select name="to">${others.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
        <label>Handoff note (what is done, what comes next)<textarea name="note" rows="3" required></textarea></label>`, 'Send handoff');
      if (r) run(call('handoff_job', { p_job: id, p_to_dept: r.to, p_note: r.note }));
    }
    if (act === 'accept') return run(call('accept_handoff', { p_handoff: bid, p_version: j.version }));
    if (act === 'cancelhand') return run(call('cancel_handoff', { p_handoff: bid }));
  };
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { me = null; } });
start();
