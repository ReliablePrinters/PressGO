'use strict';
// PressGO Home (my work + manager dashboard), Tasks and Alerts.
// Uses helpers from app.js (sb, me, depts, inDept, esc, fmt, isClosed, isLate, shell, ask, call, alert2, friendly, STATUSES).
(function () {
  const css = document.createElement('style');
  css.textContent = `
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;text-decoration:none;color:inherit}
.stat b{display:block;font-size:24px}.stat span{color:var(--mut);font-size:13px}
.stat.hot b{color:var(--bad)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:800px){.two{grid-template-columns:1fr}}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)}
.row:last-child{border:0}.row .sub{color:var(--mut);font-size:13px}
.row.unread{background:color-mix(in srgb,var(--brand) 8%,transparent);padding-left:8px;border-radius:6px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.card h3{margin:0 0 8px;font-size:16px}
`;
  document.head.appendChild(css);

  const people = async () => (await sb.from('employees').select('id,display_name').eq('active', true).order('display_name')).data || [];
  const jobLink = (j) => (j ? `<a href="#/job/${j.id || j.job_id}">#${j.job_number} ${esc(j.customer_name)}</a>` : '');
  const due = (d) => (d ? `Due ${esc(fmt(d))}` : 'No due date');
  const overdueTask = (t) => t.due_at && !t.done_at && new Date(t.due_at) < new Date();

  function jobRow(j, extra = '') {
    return `<a class="job" href="#/job/${j.id}">
      <div><div class="num">#${j.job_number}</div><span class="badge st">${esc(j.lifecycle_status)}</span></div>
      <div><b>${esc(j.customer_name)}</b> — ${esc(j.description)}<div class="sub">${esc(j.departments?.name || 'No department')} · ${j.assignee ? esc(j.assignee.display_name) : 'Unassigned'}</div></div>
      <div>${extra}${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}${isLate(j) ? '<span class="badge late">Overdue</span>' : ''}<span class="sub">${due(j.due_at)}</span></div></a>`;
  }
  const taskRow = (t, who) => `<div class="row"><div><b>${esc(t.title)}</b>${t.note ? `<div class="sub">${esc(t.note)}</div>` : ''}
      <div class="sub">${t.job ? jobLink({ id: t.job_id, ...t.job }) + ' · ' : ''}${who ? esc(who) + ' · ' : ''}<span style="${overdueTask(t) ? 'color:var(--bad)' : ''}">${due(t.due_at)}</span></div></div>
      ${t.done_at ? '<span class="badge ok">Done</span>' : `<button data-done="${t.id}">Done</button>`}</div>`;
  function wireTasks(root, redraw) {
    root.querySelectorAll('button[data-done]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; try { await call('set_task_done', { p_task: b.dataset.done, p_done: true }); } catch (e) { alert2(friendly(e)); } redraw(); };
    });
  }
  const TASK_SELECT = 'id,title,note,due_at,done_at,job_id,assigned_to,created_by,assignee:assigned_to(display_name),job:job_id(job_number,customer_name)';

  async function newTask(jobId) {
    const ppl = await people();
    const r = await ask('New task', `<label>What needs doing?<input name="title" required maxlength="200"></label>
      <label>Details (optional)<textarea name="note" rows="2"></textarea></label>
      <label>Who is it for?<select name="who">${ppl.map((p) => `<option value="${p.id}" ${p.id === me.id ? 'selected' : ''}>${esc(p.display_name)}${p.id === me.id ? ' (me)' : ''}</option>`).join('')}</select></label>
      <label>Due (optional)<input name="due" type="datetime-local"></label>`, 'Add task');
    if (!r) return false;
    try {
      await call('create_task', { p_title: r.title, p_note: r.note || null, p_assigned_to: r.who, p_due: r.due ? new Date(r.due).toISOString() : null, p_job: jobId || null });
      return true;
    } catch (e) { alert2(friendly(e)); return false; }
  }

  // ---------------------------------------------------------------- Home
  window.viewHome = async function () {
    shell('home', '<p class="note">Loading…</p>');
    const [jr, hr, fr, tr, cr] = await Promise.all([
      sb.from('jobs').select('id,job_number,customer_name,description,due_at,priority,lifecycle_status,current_department_id,current_assignee_id,assignee:current_assignee_id(display_name),departments:current_department_id(name)').order('due_at'),
      sb.from('job_holds').select('id,job_id,kind,note').is('resolved_at', null),
      sb.from('job_handoffs').select('id,job_id,to_department_id,note').eq('status', 'Pending'),
      sb.from('tasks').select(TASK_SELECT).is('done_at', null).order('due_at', { ascending: true, nullsFirst: false }),
      sb.rpc('my_conversations')]);
    const err = jr.error || hr.error || fr.error || tr.error;
    if (err) return shell('home', `<p class="err">${esc(friendly(err))}</p>`);
    const active = (jr.data || []).filter((j) => !isClosed(j));
    const byId = new Map(active.map((j) => [j.id, j]));
    const holds = (hr.data || []).filter((h) => byId.has(h.job_id));
    const holdJobs = new Set(holds.map((h) => h.job_id));
    const hands = (fr.data || []).filter((h) => byId.has(h.job_id));
    const mine = active.filter((j) => j.current_assignee_id === me.id);
    const myTasks = (tr.data || []).filter((t) => t.assigned_to === me.id);
    const waiting = hands.filter((h) => inDept(h.to_department_id));
    const myProblems = holds.filter((h) => { const j = byId.get(h.job_id); return j.current_assignee_id === me.id || inDept(j.current_department_id); });
    const unread = (cr.data || []).reduce((a, c) => a + Number(c.unread || 0), 0);
    const mineOverdue = mine.filter(isLate).length;
    const stat = (n, label, href, hot) => `<a class="stat ${hot && n ? 'hot' : ''}" href="${href}"><b>${n}</b><span>${label}</span></a>`;

    let out = `<h2>Hi ${esc(me.display_name)}</h2><div class="stats">
      ${stat(mine.length, 'My open jobs', '#/jobs')}${stat(mineOverdue, 'My overdue jobs', '#/jobs', true)}
      ${stat(waiting.length, 'Waiting for me to accept', '#/jobs', true)}${stat(myProblems.length, 'Open problems', '#/jobs', true)}
      ${stat(myTasks.length, 'My tasks', '#/tasks')}${stat(unread, 'Unread chat messages', '#/chat', true)}</div>`;

    if (waiting.length) out += `<div class="card notice"><h3>Waiting for you to accept</h3>${waiting.map((h) => jobRow(byId.get(h.job_id), `<span class="badge st">${esc(h.note)}</span>`)).join('')}</div>`;
    out += `<div class="two"><div><div class="card"><h3>My jobs</h3>${mine.length ? mine.map((j) => jobRow(j, holdJobs.has(j.id) ? '<span class="badge late">Problem</span>' : '')).join('') : '<p class="note">Nothing assigned to you right now.</p>'}</div></div>
      <div><div class="card"><h3>My tasks <button id="addtask" style="float:right">+ Task</button></h3><div id="ht">${myTasks.length ? myTasks.map((t) => taskRow(t)).join('') : '<p class="note">No open tasks.</p>'}</div></div>
      ${myProblems.length ? `<div class="card"><h3>Open problems</h3>${myProblems.map((h) => `<div class="row"><div>${jobLink(byId.get(h.job_id))}<div class="sub"><b>${esc(h.kind)}</b> — ${esc(h.note)}</div></div></div>`).join('')}</div>` : ''}</div></div>`;

    if (me.manager_role) {
      const counts = STATUSES.filter((s) => s !== 'Collected' && s !== 'Cancelled').map((s) => [s, active.filter((j) => j.lifecycle_status === s).length]);
      const overdue = active.filter(isLate);
      const unassigned = active.filter((j) => !j.current_assignee_id);
      const load = new Map();
      active.forEach((j) => { const k = j.assignee?.display_name || 'Unassigned'; load.set(k, (load.get(k) || 0) + 1); });
      const rush = active.filter((j) => j.priority === 'Rush');
      out += `<h2 style="margin-top:22px">Manager dashboard</h2><div class="stats">
        ${stat(active.length, 'Active jobs', '#/jobs')}${stat(overdue.length, 'Overdue', '#/jobs', true)}${stat(rush.length, 'Rush jobs', '#/jobs')}
        ${stat(unassigned.length, 'Unassigned', '#/jobs', true)}${stat(holds.length, 'Open problems', '#/jobs', true)}${stat(hands.length, 'Handoffs waiting', '#/jobs')}</div>
        <div class="card"><h3>Jobs by stage</h3><div class="chips">${counts.map(([s, n]) => `<span class="badge st">${esc(s)}: <b>${n}</b></span>`).join('')}</div></div>
        <div class="two"><div class="card"><h3>Overdue</h3>${overdue.length ? overdue.slice(0, 8).map((j) => jobRow(j)).join('') : '<p class="note">Nothing overdue.</p>'}</div>
        <div><div class="card"><h3>Workload</h3>${[...load.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="row"><span>${esc(k)}</span><b>${n}</b></div>`).join('') || '<p class="note">No active jobs.</p>'}</div>
        ${unassigned.length ? `<div class="card"><h3>Unassigned</h3>${unassigned.slice(0, 6).map((j) => jobRow(j)).join('')}</div>` : ''}</div></div>`;
    }
    shell('home', out);
    wireTasks(document.getElementById('ht') || document, () => window.viewHome());
    document.getElementById('addtask').onclick = async () => { if (await newTask()) window.viewHome(); };
  };

  // ---------------------------------------------------------------- Tasks
  window.viewTasks = async function () {
    shell('tasks', '<p class="note">Loading…</p>');
    const { data, error } = await sb.from('tasks').select(TASK_SELECT).order('due_at', { ascending: true, nullsFirst: false }).limit(300);
    if (error) return shell('tasks', `<p class="err">${esc(friendly(error))}</p>`);
    const open = (data || []).filter((t) => !t.done_at);
    const mine = open.filter((t) => t.assigned_to === me.id);
    const other = open.filter((t) => t.assigned_to !== me.id);
    const done = (data || []).filter((t) => t.done_at).slice(-15).reverse();
    shell('tasks', `<div class="toolbar"><h2 style="margin:0">Tasks</h2><span class="spacer"></span><button class="primary" id="nt">+ New task</button></div>
      <div class="card"><h3>For me</h3><div>${mine.map((t) => taskRow(t)).join('') || '<p class="note">Nothing for you.</p>'}</div></div>
      ${other.length ? `<div class="card"><h3>${me.manager_role ? 'Everyone else' : 'Tasks I set or can see'}</h3>${other.map((t) => taskRow(t, 'For ' + (t.assignee?.display_name || '?'))).join('')}</div>` : ''}
      ${done.length ? `<div class="card"><h3>Recently done</h3>${done.map((t) => taskRow(t, t.assignee?.display_name)).join('')}</div>` : ''}`);
    wireTasks(document.querySelector('main'), () => window.viewTasks());
    document.getElementById('nt').onclick = async () => { if (await newTask()) window.viewTasks(); };
  };

  // tasks card on a job page
  window.jobTasks = async function (jobId) {
    const box = document.getElementById('jobtasks');
    if (!box) return;
    const draw = async () => {
      const { data } = await sb.from('tasks').select(TASK_SELECT).eq('job_id', jobId).order('created_at', { ascending: false });
      box.innerHTML = `<div class="card"><h3>Tasks <button id="jt" style="float:right">+ Task</button></h3>${(data || []).map((t) => taskRow(t, 'For ' + (t.assignee?.display_name || '?'))).join('') || '<p class="note">No tasks for this job.</p>'}</div>`;
      wireTasks(box, draw);
      document.getElementById('jt').onclick = async () => { if (await newTask(jobId)) draw(); };
    };
    draw();
  };

  // ---------------------------------------------------------------- Alerts
  window.viewAlerts = async function () {
    shell('alerts', '<p class="note">Loading…</p>');
    const { data, error } = await sb.from('notifications').select('id,kind,title,job_id,created_at,read_at').order('created_at', { ascending: false }).limit(100);
    if (error) return shell('alerts', `<p class="err">${esc(friendly(error))}</p>`);
    const list = data || [];
    shell('alerts', `<div class="toolbar"><h2 style="margin:0">Alerts</h2><span class="spacer"></span><button id="mr">Mark all as read</button></div>
      <div class="card">${list.map((n) => `<div class="row ${n.read_at ? '' : 'unread'}"><div>${n.job_id ? `<a href="#/job/${n.job_id}" data-n="${n.id}">${esc(n.title)}</a>` : esc(n.title)}<div class="sub">${esc(fmt(n.created_at))}</div></div></div>`).join('') || '<p class="note">No alerts yet. You will see new assignments, handoffs, problems and tasks here.</p>'}</div>`);
    document.getElementById('mr').onclick = async () => { await call('mark_alerts_read', {}); window.viewAlerts(); };
    document.querySelectorAll('a[data-n]').forEach((a) => { a.onclick = () => { call('mark_alerts_read', { p_ids: [a.dataset.n] }); }; });
    await call('mark_alerts_read', {}).catch(() => {});
    window.alertBadge();
  };

  let alertTimer = null;
  window.alertBadge = async function () {
    const el = document.getElementById('alertlink');
    if (!el || !me) return;
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    el.textContent = count ? `Alerts (${count})` : 'Alerts';
    if (!alertTimer) alertTimer = setInterval(() => { if (me) window.alertBadge(); }, 30000);
  };
})();
