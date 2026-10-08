'use strict';
// PressGO Home (my work + manager dashboard), Tasks and Alerts.
// Uses helpers from app.js (sb, me, depts, inDept, esc, fmt, isClosed, isLate, shell, ask, call, alert2, friendly, STATUSES).
(function () {
  // helpers come from app.js, which loads after this file, so they are looked up when a screen is drawn
  const ic = (n) => window.pgUI.ic(n);
  const stBadge = (j) => window.pgUI.stBadge(j);
  const emptyState = (...a) => window.pgUI.emptyState(...a);

  const people = async () => (await sb.from('employees').select('id,display_name').eq('active', true).order('display_name')).data || [];
  const jobLink = (j) => (j ? `<a href="#/job/${j.id || j.job_id}">#${j.job_number} ${esc(j.customer_name)}</a>` : '');
  const due = (d) => (d ? `Due ${esc(fmt(d))}` : 'No due date');
  const overdueTask = (t) => t.due_at && !t.done_at && new Date(t.due_at) < new Date();

  function jobRow(j, extra = '') {
    return `<a class="job" href="#/job/${j.id}">
      <div><div class="num">#${j.job_number}</div>${stBadge(j)}</div>
      <div><b>${esc(j.customer_name)}</b> — ${esc(j.description)}<div class="sub">${esc(j.departments?.name || 'No department')} · ${j.assignee ? window.pgAvatar(j.assignee.display_name, 18) + ' ' + esc(j.assignee.display_name) : 'Unassigned'}</div></div>
      <div>${extra}${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}${isLate(j) ? '<span class="badge late">Overdue</span>' : ''}${window.pgUI.dueCell(j)}</div></a>`;
  }
  const shortDue = (d) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const taskRow = (t) => {
    const late = overdueTask(t);
    return `<div class="trow ${t.done_at ? 'isdone' : ''} ${late ? 'late' : ''}"><div class="tmain"><b>${esc(t.title)}</b>${t.note ? `<div class="sub">${esc(t.note)}</div>` : ''}
      <div class="tmeta">${t.job ? `<a class="tag" href="#/job/${t.job_id}">#${t.job.job_number} ${esc(t.job.customer_name)}</a>` : ''}${t.assignee ? `<span class="who2">${window.pgAvatar(t.assignee.display_name, 18)} ${esc(t.assignee.display_name)}</span>` : ''}</div></div>
      <div class="tside">${t.done_at ? '<span class="badge ok">Done</span>' : `${t.due_at ? `<span class="badge ${late ? 'late' : ''}">${late ? 'Overdue · ' : ''}${esc(shortDue(t.due_at))}</span>` : '<span class="note">No due date</span>'}<button class="sm" data-done="${t.id}">Done</button>`}</div></div>`;
  };
  function wireTasks(root, redraw) {
    root.querySelectorAll('button[data-done]').forEach((b) => {
      b.onclick = async () => { b.disabled = true; try { await call('set_task_done', { p_task: b.dataset.done, p_done: true }); window.pgToast('Task marked done.'); } catch (e) { window.pgToast(friendly(e), 'error'); } redraw(); };
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
      window.pgToast('Task added.');
      return true;
    } catch (e) { window.pgToast(friendly(e), 'error'); return false; }
  }

  // ---------------------------------------------------------------- Home
  window.viewHome = async function () {
    shell('home', window.pgUI.LOADING);
    const [jr, hr, fr, tr, cr] = await Promise.all([
      sb.from('jobs').select('id,job_number,customer_name,description,due_at,priority,lifecycle_status,current_department_id,current_assignee_id,assignee:current_assignee_id(display_name),departments:current_department_id(name)').order('due_at'),
      sb.from('job_holds').select('id,job_id,kind,note').is('resolved_at', null),
      sb.from('job_handoffs').select('id,job_id,to_department_id,note').eq('status', 'Pending'),
      sb.from('tasks').select(TASK_SELECT).is('done_at', null).order('due_at', { ascending: true, nullsFirst: false }),
      sb.rpc('my_conversations')]);
    const err = jr.error || hr.error || fr.error || tr.error;
    if (err) return shell('home', `<div class="err-box">${esc(friendly(err))}</div>`);
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
    const stat = (n, label, href, hot, icon = 'jobs') => `<a class="stat ${hot && n ? 'hot' : ''}" href="${href}"><span class="si">${ic(icon)}</span><span><b>${n}</b><span class="l">${label}</span></span></a>`;
    const todayStr = new Date().toDateString();
    const dueToday = (me.manager_role ? active : mine).filter((j) => new Date(j.due_at).toDateString() === todayStr && j.lifecycle_status !== 'Ready for Collection');

    const hour = new Date().getHours();
    let out = `<div class="pagehead"><div><h2 class="hi" style="margin:0">${window.pgAvatar(me.display_name, 40)} ${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${esc(me.display_name)}</h2>
      <div class="sub">${esc(new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}${dueToday.length ? ` · ${dueToday.length} due today` : ''}</div></div>
      <div class="actions" style="margin:0">${canCreate() ? `<button class="primary" id="qnj">${ic('plus')} New job</button>` : ''}<button id="qnt">${ic('tasks')} New task</button></div></div>
      <div class="sect" style="margin-top:0"><h3>Needs attention</h3></div><div class="stats">
      ${stat(mineOverdue, 'My overdue jobs', '#/jobs', true, 'alert')}${stat(waiting.length, 'Waiting for me to accept', '#/jobs', true, 'swap')}${stat(myProblems.length, 'Open problems', '#/jobs', true, 'flag')}${stat(unread, 'Unread chat messages', '#/chat', true, 'chat')}
      ${stat(mine.length, 'My open jobs', '#/jobs', false, 'jobs')}${stat(myTasks.length, 'My open tasks', '#/tasks', false, 'tasks')}</div>`;

    if (waiting.length) out += `<div class="card notice"><h3>Waiting for you to accept</h3>${waiting.map((h) => jobRow(byId.get(h.job_id), `<span class="badge st">${esc(h.note)}</span>`)).join('')}</div>`;
    out += `<div class="two"><div>${dueToday.length ? `<div class="card"><h3>${ic('clock')} Due today <span class="count right">${dueToday.length}</span></h3>${dueToday.slice(0, 8).map((j) => jobRow(j)).join('')}</div>` : ''}<div class="card"><h3>My jobs</h3>${mine.length ? mine.map((j) => jobRow(j, holdJobs.has(j.id) ? '<span class="badge late">Problem</span>' : '')).join('') : emptyState('jobs', 'Nothing assigned to you', 'New work will show up here.')}</div></div>
      <div><div class="card"><h3>My tasks</h3><div id="ht">${myTasks.length ? myTasks.map((t) => taskRow(t)).join('') : '<p class="note">No open tasks. You are all caught up.</p>'}</div></div>
      ${myProblems.length ? `<div class="card"><h3>Open problems</h3>${myProblems.map((h) => `<div class="row"><div>${jobLink(byId.get(h.job_id))}<div class="sub"><b>${esc(h.kind)}</b> — ${esc(h.note)}</div></div></div>`).join('')}</div>` : ''}</div></div>`;

    if (me.manager_role) {
      const counts = STATUSES.filter((s) => s !== 'Collected' && s !== 'Cancelled').map((s) => [s, active.filter((j) => j.lifecycle_status === s).length]);
      const overdue = active.filter(isLate);
      const unassigned = active.filter((j) => !j.current_assignee_id);
      const load = new Map();
      active.forEach((j) => { const k = j.assignee?.display_name || 'Unassigned'; load.set(k, (load.get(k) || 0) + 1); });
      const rush = active.filter((j) => j.priority === 'Rush');
      const sc = { 'New': 'var(--s-new)', 'Queued': 'var(--s-queued)', 'In Production': 'var(--s-prod)', 'Finishing': 'var(--s-fin)', 'Ready for Collection': 'var(--s-ready)' };
      const maxLoad = Math.max(1, ...load.values());
      out += `<div class="sect"><h3>Shop overview</h3></div><div class="stats">
        ${stat(active.length, 'Active jobs', '#/jobs', false, 'jobs')}${stat(overdue.length, 'Overdue', '#/jobs', true, 'alert')}${stat(rush.length, 'Rush jobs', '#/jobs', false, 'flag')}
        ${stat(unassigned.length, 'Unassigned', '#/jobs', true, 'user')}${stat(holds.length, 'Open problems', '#/jobs', true, 'flag')}${stat(hands.length, 'Handoffs waiting', '#/jobs', false, 'swap')}</div>
        <div class="card"><h3>Jobs by stage</h3><div class="pipe" role="img" aria-label="Jobs by stage">${counts.filter(([, n]) => n).map(([s, n]) => `<i style="flex:${n};background:${sc[s]}" title="${esc(s)}: ${n}"></i>`).join('')}</div>
          <div class="legend">${counts.map(([s, n]) => `<span style="--c:${sc[s]}">${esc(s)} <b>${n}</b></span>`).join('')}</div></div>
        <div class="two"><div class="card"><h3>Overdue</h3>${overdue.length ? overdue.slice(0, 8).map((j) => jobRow(j)).join('') : emptyState('clock', 'Nothing overdue', 'Every active job is on schedule.')}</div>
        <div><div class="card"><h3>Workload</h3>${[...load.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="bar"><span>${esc(k)}</span><div class="bt"><i style="width:${Math.round(n / maxLoad * 100)}%"></i></div><b>${n}</b></div>`).join('') || '<p class="note">No active jobs.</p>'}</div>
        ${unassigned.length ? `<div class="card"><h3>Unassigned</h3>${unassigned.slice(0, 6).map((j) => jobRow(j)).join('')}</div>` : ''}</div></div>`;
    }
    shell('home', out);
    wireTasks(document.getElementById('ht') || document, () => window.viewHome());
    document.getElementById('qnt').onclick = async () => { if (await newTask()) window.viewHome(); };
    const qnj = document.getElementById('qnj'); if (qnj) qnj.onclick = () => { location.hash = '#/new'; };
  };

  // ---------------------------------------------------------------- Tasks
  window.viewTasks = async function () {
    shell('tasks', window.pgUI.LOADING);
    const { data, error } = await sb.from('tasks').select(TASK_SELECT).order('due_at', { ascending: true, nullsFirst: false }).limit(300);
    if (error) return shell('tasks', `<div class="err-box">${esc(friendly(error))}</div>`);
    const open = (data || []).filter((t) => !t.done_at);
    const mine = open.filter((t) => t.assigned_to === me.id);
    const other = open.filter((t) => t.assigned_to !== me.id);
    const done = (data || []).filter((t) => t.done_at).slice(-15).reverse();
    const group = (title, arr, emptyIcon, emptyTitle, emptyHint) => `<div class="sect"><h3>${title} <span class="count">${arr.length}</span></h3></div><div class="card flush">${arr.length ? arr.map((t) => taskRow(t)).join('') : emptyState(emptyIcon, emptyTitle, emptyHint)}</div>`;
    shell('tasks', `<div class="pagehead"><div><h2>Tasks</h2><div class="sub">${mine.length} open for you${mine.filter(overdueTask).length ? ` · <b style="color:var(--bad)">${mine.filter(overdueTask).length} overdue</b>` : ''}</div></div><button class="primary" id="nt">${ic('plus')} New task</button></div>
      ${group('For me', mine, 'tasks', 'You are all caught up', 'Tasks assigned to you will show up here.')}
      ${other.length ? group(me.manager_role ? 'Everyone else' : 'Tasks I set or can see', other) : ''}
      ${done.length ? group('Recently done', done) : ''}`);
    wireTasks(document.querySelector('main'), () => window.viewTasks());
    document.getElementById('nt').onclick = async () => { if (await newTask()) window.viewTasks(); };
  };

  // tasks card on a job page
  window.jobTasks = async function (jobId) {
    const box = document.getElementById('jobtasks');
    if (!box) return;
    const draw = async () => {
      const { data } = await sb.from('tasks').select(TASK_SELECT).eq('job_id', jobId).order('created_at', { ascending: false });
      box.innerHTML = `<div class="card"><h3>Tasks <button id="jt" class="sm right">+ Task</button></h3>${(data || []).map((t) => taskRow(t)).join('') || '<p class="note">No tasks for this job yet.</p>'}</div>`;
      wireTasks(box, draw);
      document.getElementById('jt').onclick = async () => { if (await newTask(jobId)) draw(); };
    };
    draw();
  };

  // ---------------------------------------------------------------- Alerts
  window.viewAlerts = async function () {
    shell('alerts', window.pgUI.LOADING);
    const { data, error } = await sb.from('notifications').select('id,kind,title,job_id,created_at,read_at').order('created_at', { ascending: false }).limit(100);
    if (error) return shell('alerts', `<div class="err-box">${esc(friendly(error))}</div>`);
    const list = data || [];
    const KIND = { assigned: ['user', 'Assigned'], handoff: ['swap', 'Handoff'], problem: ['alert', 'Problem'], task: ['tasks', 'Task'], approved: ['check', 'Approved'] };
    const unreadN = list.filter((n) => !n.read_at).length;
    const item = (n) => { const k = KIND[n.kind] || ['bell', 'Alert']; const inner = `<span class="ai ${esc(n.kind)}">${ic(k[0])}</span><span class="am"><b>${esc(n.title)}</b><span class="sub">${esc(k[1])}</span></span><span class="at" title="${esc(fmt(n.created_at))}">${esc(window.pgUI.rel(n.created_at))}</span>`;
      return n.job_id ? `<a class="arow ${n.read_at ? '' : 'unread'}" href="#/job/${n.job_id}" data-n="${n.id}">${inner}</a>` : `<div class="arow ${n.read_at ? '' : 'unread'}">${inner}</div>`; };
    shell('alerts', `<div class="pagehead"><div><h2>Alerts</h2><div class="sub">${unreadN ? `${unreadN} new` : 'You are all caught up'}</div></div><button id="mr">Mark all as read</button></div>
      <div class="card flush">${list.length ? list.map(item).join('') : emptyState('bell', 'No alerts yet', 'You will see new assignments, handoffs, problems and tasks here.')}</div>`);
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
    const tx = el.querySelector('.tx') || el; tx.textContent = count ? `Alerts (${count})` : 'Alerts';
    if (!alertTimer) alertTimer = setInterval(() => { if (me) window.alertBadge(); }, 30000);
  };
})();
