'use strict';
const sb = window.supabase.createClient(PRESSGO.url, PRESSGO.key, { db: { schema: 'pressgo' } });
const $app = document.getElementById('app');
const dlg = document.getElementById('dlg');
let me = null;            // my employee record
let depts = [];           // active departments
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
    f.onsubmit = () => resolve(Object.fromEntries(new FormData(f)));
    dlg.onclose = () => resolve(null);
    dlg.showModal();
  });
}
async function call(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
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
  window.onhashchange = route;
  route();
}
function showLogin(msg = '') {
  $app.innerHTML = `<div class="center card"><h2>PressGO</h2><p class="note">Staff sign-in. Your manager must invite your email address first.</p>
    <form id="lf"><label>Email<input name="email" type="email" required autocomplete="username"></label>
    <label>Password<input name="password" type="password" required minlength="8" autocomplete="current-password"></label>
    <div class="err" id="lerr">${esc(msg)}</div>
    <div class="actions"><button class="primary" type="submit">Sign in</button><button type="button" id="su">Create login</button></div></form>
    <p class="note">First time? Choose “Create login”, confirm the email we send you, then sign in.</p></div>`;
  const f = document.getElementById('lf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) return (document.getElementById('lerr').textContent = error.message);
    start();
  };
  document.getElementById('su').onclick = async () => {
    if (!f.reportValidity()) return;
    const { error } = await sb.auth.signUp({ email: f.email.value.trim(), password: f.password.value, options: { emailRedirectTo: location.href.split('#')[0] } });
    document.getElementById('lerr').textContent = error ? error.message : 'Check your email and click the confirmation link, then sign in.';
  };
}
function showBlocked(session, why) {
  $app.innerHTML = `<div class="center card"><h2>No access yet</h2><p>${esc(why)}</p>
    <p class="note">Signed in as ${esc(session.user.email)}. Ask a manager to add this email address, then sign in again.</p>
    <button id="so">Sign out</button></div>`;
  document.getElementById('so').onclick = async () => { await sb.auth.signOut(); showLogin(); };
}

// ---------------------------------------------------------------- shell + routing
function shell(active, inner) {
  $app.innerHTML = `<header class="top"><h1>PressGO</h1>
    <nav><a href="#/jobs" class="${active === 'jobs' ? 'on' : ''}">Jobs</a>${canCreate() ? `<a href="#/new" class="${active === 'new' ? 'on' : ''}">+ New job</a>` : ''}</nav>
    <span class="me">${esc(me.display_name)}${me.manager_role ? ' · Manager' : ''}${me.front_desk ? ' · Front Desk' : ''}</span>
    <button id="so">Sign out</button></header><main>${inner}</main>`;
  document.getElementById('so').onclick = async () => { await sb.auth.signOut(); me = null; showLogin(); };
}
function route() {
  const h = location.hash || '#/jobs';
  if (h === '#/new') return canCreate() ? viewNew() : (location.hash = '#/jobs');
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
          <div class="sub">${esc(j.departments?.name || 'No department')} · ${j.assignee ? esc(j.assignee.display_name) : 'Unassigned'}</div></div>
        <div>${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}${isLate(j) ? '<span class="badge late">Overdue</span>' : ''}<span class="sub">Due ${esc(fmt(j.due_at))}</span></div>
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

// ---------------------------------------------------------------- job detail
async function viewJob(id) {
  shell('jobs', '<p class="note">Loading…</p>');
  const [{ data: j, error }, { data: hist }] = await Promise.all([
    sb.from('jobs').select('*,departments:current_department_id(name),assignee:current_assignee_id(display_name)').eq('id', id).maybeSingle(),
    sb.from('audit_events').select('id,action,reason,created_at,before,after,actor:actor_id(display_name)').eq('job_id', id).order('created_at', { ascending: false }).order('id', { ascending: false })
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
    ? '<p class="note">Artwork must be uploaded and approved before this job can start (file approval arrives in the next build phase).</p>' : '';

  const histHtml = (hist || []).map((h) => {
    const who = h.actor?.display_name || 'System';
    const name = { 'job.created': 'created the job', 'job.assigned': 'changed the owner or department', 'job.unassigned': 'removed the owner', 'job.details_changed': 'changed the details' }[h.action]
      || (h.action.startsWith('job.status_') ? `changed status: ${esc(h.before?.lifecycle_status)} → <b>${esc(h.after?.lifecycle_status)}</b>` : esc(h.action));
    return `<li><div><b>${esc(who)}</b> ${name}${h.reason ? ` — <i>${esc(h.reason)}</i>` : ''}</div><div class="when">${esc(fmt(h.created_at))}</div></li>`;
  }).join('') || '<li class="note">No history yet.</li>';

  shell('jobs', `<p><a href="#/jobs">← All jobs</a></p>
    <div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><h2 style="margin:0">#${j.job_number} · ${esc(j.customer_name)}</h2>
      <div><span class="badge st ${isClosed(j) ? 'done' : ''}">${esc(j.lifecycle_status)}</span>${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}${isLate(j) ? '<span class="badge late">Overdue</span>' : ''}</div></div>
      <p>${esc(j.description)}</p>
      <dl class="kv"><dt>Department</dt><dd>${esc(j.departments?.name || '—')}</dd><dt>Owner</dt><dd>${j.assignee ? esc(j.assignee.display_name) : 'Unassigned'}</dd>
        <dt>Due</dt><dd>${esc(fmt(j.due_at))}</dd><dt>Quantity</dt><dd>${j.quantity}</dd><dt>Product</dt><dd>${esc(j.product || '—')}</dd><dt>Size</dt><dd>${esc(j.size || '—')}</dd>
        <dt>Material</dt><dd>${esc(j.material || '—')}</dd><dt>Finishing</dt><dd>${esc(j.finishing || '—')}</dd><dt>Customer phone</dt><dd>${esc(j.customer_phone || '—')}</dd>
        <dt>Artwork</dt><dd>${j.artwork_required ? (j.approved_file_id ? 'Approved' : 'Required — not yet approved') : 'Not required'}</dd></dl>
      ${blocked}<div class="err" id="je"></div>
      <div class="actions" id="acts">${acts.map((a, i) => `<button class="${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}
        ${!isClosed(j) && (mgr || fd) ? '<button id="asg">Assign…</button><button id="edt">Edit details</button>' : ''}
        ${mgr && !isClosed(j) ? '<button id="cnl" class="danger">Cancel job</button>' : ''}
        ${mgr && idx > 0 && !isClosed(j) ? '<button id="back">Move back…</button>' : ''}
        ${mgr && isClosed(j) ? '<button id="reopen">Reopen…</button>' : ''}</div></div>
    <div class="card"><h3 style="margin-top:0">History</h3><ul class="hist">${histHtml}</ul></div>`);

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
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { me = null; } });
start();
