'use strict';
// PressGO My Work: one page with what needs this person's attention.
// It reuses the queries Home, Tasks, Alerts and Chat already make, all with the signed-in person's own login, so the database decides
// what each person may see. No new database functions or tables. The rules for what goes where are in myworklogic.js (tested).
(function () {
  const M = window.pgMyWork;
  if (!M) return;
  const TASK_SELECT = 'id,title,note,due_at,done_at,job_id,assigned_to,created_by,job:job_id(job_number,customer_name)';
  const JOB_SELECT = 'id,job_number,customer_name,description,due_at,priority,lifecycle_status,current_department_id,current_assignee_id,created_by,artwork_required,approved_file_id,assignee:current_assignee_id(display_name),departments:current_department_id(name)';
  const ic = (n) => window.pgUI.ic(n);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rel = (d) => window.pgUI.rel(d);
  const shortDue = (d) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const convLabel = (c) => (c.type === 'direct' || c.type === 'job' ? c.name : '#' + String(c.name || '').replace(/^#\s*/, ''));

  // ---------------------------------------------------------------- data
  async function load() {
    const approver = !!(me.manager_role || me.front_desk);
    const [jr, hr, fr, tr, cr] = await Promise.all([
      sb.from('jobs').select(JOB_SELECT).order('due_at'),
      sb.from('job_holds').select('id,job_id,kind,note,raised_at').is('resolved_at', null),
      sb.from('job_handoffs').select('id,job_id,to_department_id,note,created_at').eq('status', 'Pending'),
      sb.from('tasks').select(TASK_SELECT).is('done_at', null).eq('assigned_to', me.id).order('due_at', { ascending: true, nullsFirst: false }),
      sb.rpc('my_conversations')]);
    const err = jr.error || hr.error || fr.error || tr.error || cr.error;
    if (err) throw err;
    const jobs = (jr.data || []).filter((j) => !isClosed(j));
    const convs = (cr.data || []).map((c) => ({ ...c, href: window.pgChat.chatHref(c.id) }));
    const convById = new Map(convs.map((c) => [c.id, c]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    // second round: things that depend on the first (all optional: a failure here must not hide the rest of the page)
    const since = new Date(Date.now() - M.RECENT_DAYS * 864e5).toISOString();
    const involved = jobs.filter((j) => j.current_assignee_id === me.id || j.created_by === me.id).map((j) => j.id).slice(0, 100);
    const artworkIds = approver ? jobs.filter((j) => j.artwork_required).map((j) => j.id).slice(0, 200) : [];
    const [filesR, picR, evR] = await Promise.all([
      artworkIds.length ? sb.from('job_files').select('id,job_id,category,file_name,version_no,uploaded_at').in('job_id', artworkIds) : { data: [] },
      approver ? sb.from('messages').select('id,conversation_id,author_id,attachment_name,sent_at,author:author_id(display_name)').not('attachment_path', 'is', null).is('hidden_at', null).is('approved_at', null).neq('author_id', me.id).order('sent_at', { ascending: true }).limit(30) : { data: [] },
      involved.length ? sb.from('audit_events').select('id,job_id,action,reason,created_at,before,after,actor_id,actor:actor_id(display_name)').in('job_id', involved).gte('created_at', since).neq('actor_id', me.id).order('created_at', { ascending: false }).limit(60) : { data: [] }]);
    const partial = [];
    if (filesR.error) partial.push('artwork approvals');
    if (picR.error) partial.push('picture approvals');
    if (evR.error) partial.push('recent activity');

    const pictures = (picR.data || []).filter((m) => convById.has(m.conversation_id)).map((m) => {
      const c = convById.get(m.conversation_id);
      return { id: m.id, author_id: m.author_id, author: (m.author && m.author.display_name) || 'Someone', name: m.attachment_name, sent_at: m.sent_at, convName: convLabel(c), href: window.pgChat.chatHref(m.conversation_id, m.id) };
    });

    let activity = [];
    if (!evR.error && (evR.data || []).length && window.pgActivity && window.pgActivity.describe) {
      const ctx = await window.pgActivity.context(evR.data, null);
      activity = window.pgActivity.describe(evR.data, ctx).filter((e) => e.jobId && jobById.has(e.jobId)).map((e) => ({
        key: e.key, jobId: e.jobId, job: jobById.get(e.jobId), at: e.at, actor: e.actor || 'System', verb: e.verb, chip: (e.chips && e.chips[0]) || null, href: '#/job/' + e.jobId }));
    }
    const res = M.build({ me, now: Date.now(), inDept, jobs, holds: hr.data || [], handoffs: fr.data || [], tasks: tr.data || [], convs, artworkFiles: filesR.data || [], pictures, activity });
    res.partial = partial;
    return res;
  }

  // ---------------------------------------------------------------- drawing
  const chip = (r) => `<span class="mw-chip tone-${esc(r.tone || 'info')}">${esc(r.text)}</span>`;
  const jobRow = (it) => {
    const j = it.job;
    const tone = it.reasons.some((r) => r.tone === 'bad') ? 'bad' : it.reasons.some((r) => r.tone === 'warn') ? 'warn' : '';
    const who = j.assignee ? esc(j.assignee.display_name) : 'Unassigned';
    return `<a class="mw-i" data-tone="${tone}" href="${esc(it.href)}">
      <span class="mw-n">#${esc(j.job_number)}</span>
      <span class="mw-m"><b>${esc(j.customer_name)}</b><span class="mw-s">${esc(j.description)}</span>
        <span class="mw-s">${esc((j.departments && j.departments.name) || 'No department')} · ${who} · Due ${esc(shortDue(j.due_at))}</span>
        ${it.reasons.length ? `<span class="mw-chips">${it.reasons.map(chip).join('')}</span>` : ''}</span>
      <span class="mw-r">${window.pgUI.stBadge(j)}</span></a>`;
  };
  const taskRow = (it) => {
    const t = it.task;
    return `<div class="mw-i mw-task" data-tone="${it.section === 'attention' ? 'bad' : ''}"><a class="mw-cover" href="${esc(it.href)}">
        <span class="mw-ico">${ic('tasks')}</span>
        <span class="mw-m"><b>${esc(t.title)}</b>${t.job ? `<span class="mw-s">#${esc(t.job.job_number)} ${esc(t.job.customer_name)}</span>` : ''}
          <span class="mw-chips">${it.reasons.length ? it.reasons.map(chip).join('') : t.due_at ? `<span class="mw-chip">Due ${esc(shortDue(t.due_at))}</span>` : '<span class="mw-chip">No due date</span>'}</span></span></a>
      <button type="button" class="sm" data-done="${esc(t.id)}" aria-label="Mark done: ${esc(t.title)}">Done</button></div>`;
  };
  const pictureRow = (it) => {
    const p = it.picture;
    return `<a class="mw-i" href="${esc(it.href)}"><span class="mw-ico">${ic('chat')}</span>
      <span class="mw-m"><b>${esc(p.author)} sent a picture</b><span class="mw-s">${esc(p.convName)}${p.name ? ' · ' + esc(p.name) : ''}</span><span class="mw-chips">${it.reasons.map(chip).join('')}</span></span>
      <span class="mw-r mw-time">${esc(rel(p.sent_at))}</span></a>`;
  };
  const convRow = (it) => {
    const c = it.conv;
    const mark = c.type === 'direct' ? ic('user') : c.type === 'job' ? ic('jobs') : '<b aria-hidden="true">#</b>';
    return `<a class="mw-i" href="${esc(it.href)}"><span class="mw-ico">${mark}</span>
      <span class="mw-m"><b>${esc(convLabel(c))}</b><span class="mw-s">${c.last_body ? esc((c.last_author ? c.last_author + ': ' : '') + String(c.last_body).replace(/\s+/g, ' ').slice(0, 90)) : 'No messages yet'}</span></span>
      <span class="mw-r"><span class="badge warn">${it.unread} new</span><span class="mw-time">${esc(rel(c.last_at))}</span></span></a>`;
  };
  const activityRow = (a) => `<a class="mw-i" href="${esc(a.href)}"><span class="mw-ico plain">${window.pgAvatar ? window.pgAvatar(a.actor, 28) : ''}</span>
      <span class="mw-m"><span class="mw-line"><b>${esc(a.actor)}</b> ${esc(a.verb)}</span><span class="mw-s">#${esc(a.job.job_number)} ${esc(a.job.customer_name)}</span>
        ${a.chip ? `<span class="mw-chips"><span class="mw-chip">${esc(a.chip.label)} ${a.chip.from !== undefined ? `<s>${esc(a.chip.from)}</s> → <b>${esc(a.chip.to)}</b>` : `<b>${esc(a.chip.value)}</b>`}</span></span>` : ''}</span>
      <span class="mw-r mw-time">${esc(rel(a.at))}</span></a>`;

  const rowFor = (it) => (it.kind === 'job' ? jobRow(it) : it.kind === 'task' ? taskRow(it) : it.kind === 'picture' ? pictureRow(it) : it.kind === 'conversation' ? convRow(it) : activityRow(it));
  const empty = (icon, title, hint, action) => `<div class="mw-empty">${window.pgUI.emptyState(icon, title, hint)}${action || ''}</div>`;

  // a section with "Show N more" that redraws just itself
  function section(id, title, list, limit, o) {
    o = o || {};
    return { id, title, list, limit, o, expanded: false };
  }
  function sectionHtml(s) {
    const { items, more } = M.take(s.list, s.limit, s.expanded);
    const count = s.o.count != null ? s.o.count : s.list.length;
    let body;
    if (!s.list.length) body = s.o.emptyHtml || '';
    else if (s.o.groups) body = s.o.groups(items);
    else body = items.map(rowFor).join('');
    return `<section class="card mw-sec ${s.o.cls || ''}" id="mw-${s.id}" aria-labelledby="mw-h-${s.id}">
      <h3 id="mw-h-${s.id}">${s.o.icon ? ic(s.o.icon) : ''} ${esc(s.title)} <span class="count">${count}</span></h3>${s.o.note ? `<p class="note mw-note">${esc(s.o.note)}</p>` : ''}
      <div class="mw-list">${body}</div>
      ${more ? `<button type="button" class="sm mw-more" data-more="${s.id}">Show ${more} more</button>` : ''}
      ${s.expanded && s.list.length > s.limit ? `<button type="button" class="sm ghost mw-more" data-less="${s.id}">Show fewer</button>` : ''}</section>`;
  }

  // plain words for a failed load (never the database's own message)
  const loadError = (e) => {
    const m = String((e && e.message) || e || '');
    if (/failed to fetch|network|load failed/i.test(m)) return 'Could not reach the server. Check your connection.';
    if (/jwt|expired|not signed in/i.test(m)) return 'Your sign-in has expired. Sign in again.';
    return 'My work could not be loaded. Please try again.';
  };

  window.viewMyWork = async function () {
    shell('mywork', window.pgUI.LOADING);
    let res;
    try { res = await load(); }
    catch (e) {
      shell('mywork', `<div class="pagehead"><div><h2>My work</h2></div></div><div class="err-box" role="alert"><span>${esc(loadError(e))}</span> <button type="button" id="mw-retry" class="sm">Try again</button></div>`);
      const r = document.getElementById('mw-retry'); if (r) r.onclick = () => window.viewMyWork();
      return;
    }
    const c = res.counts;
    const sections = {};
    sections.attention = section('attention', 'Needs attention', res.attention, M.LIMITS.attention, { icon: 'alert', cls: 'mw-hot' });
    sections.approvals = section('approvals', 'Pending approvals', res.approvals, M.LIMITS.approvals, { icon: 'check', note: 'Artwork and pictures waiting for you to approve.' });
    sections.desk = section('desk', 'Front desk queue', res.desk, M.LIMITS.desk, { icon: 'inbox', note: 'Jobs waiting for you to release them to production, or for the customer to collect.',
      groups: (items) => {
        const g = (k, label) => { const x = items.filter((i) => i.group === k); return x.length ? `<h4 class="mw-sub">${label}</h4>${x.map(jobRow).join('')}` : ''; };
        return g('release', 'To release') + g('collect', 'Ready to collect');
      } });
    sections.jobs = section('jobs', 'Assigned jobs', res.jobs, M.LIMITS.jobs, { icon: 'jobs', count: c.jobs,
      note: c.mineElsewhere ? `${c.mineElsewhere} of your ${c.jobs} job${c.jobs === 1 ? ' is' : 's are'} shown above, where it needs you.` : '',
      emptyHtml: empty('jobs', c.jobs ? 'The rest of your jobs are listed above' : 'No jobs are assigned to you', c.jobs ? 'They need your attention, so they are at the top.' : 'New work will show up here when it is assigned to you.', '<a class="btn-link" href="#/jobs">Browse all jobs</a>') });
    sections.tasks = section('tasks', 'Tasks', res.tasks, M.LIMITS.tasks, { icon: 'tasks', count: c.tasks - res.attention.filter((i) => i.kind === 'task').length,
      emptyHtml: empty('tasks', 'No other open tasks', 'Tasks assigned to you will show up here.', '<button type="button" class="sm" id="mw-nt">New task</button>') });
    sections.messages = section('messages', 'Unread messages', res.messages, M.LIMITS.messages, { icon: 'chat', count: c.unread,
      emptyHtml: empty('chat', 'No unread messages', 'You are up to date in every conversation you can see.') });
    sections.activity = section('activity', 'Recent activity', res.activity, M.LIMITS.activity, { icon: 'clock', note: 'Changes other people made to your jobs in the last 7 days.',
      emptyHtml: empty('clock', 'No recent updates', 'Changes to your jobs will show up here.') });
    const order = { left: [], right: [] };
    if (res.attention.length) order.left.push('attention');
    if (res.roles.approver && res.approvals.length) order.left.push('approvals');
    if (res.roles.deskRole && res.desk.length) order.left.push('desk');
    order.left.push('jobs');
    order.right.push('tasks', 'messages', 'activity');
    const col = (ids) => ids.map((id) => `<div data-slot="${id}">${sectionHtml(sections[id])}</div>`).join('');

    const clear = res.allClear ? `<div class="card mw-clear">${window.pgUI.emptyState('check', 'You are all caught up', 'Nothing needs your attention right now.')}</div>` : '';
    const partial = res.partial.length ? `<div class="err-box" role="status"><span>Some parts could not be loaded: ${esc(res.partial.join(', '))}.</span> <button type="button" id="mw-retry" class="sm">Try again</button></div>` : '';
    shell('mywork', `<div class="pagehead"><div><h2>My work</h2><div class="sub">${esc(M.summary(res))}</div></div><div class="actions" style="margin:0"><a class="btn-link" href="#/home">Home dashboard</a></div></div>
      ${partial}${clear}<div class="mw"><div class="mw-col">${col(order.left)}</div><div class="mw-col">${col(order.right)}</div></div>`);

    const main = document.querySelector('main');
    const redraw = (id) => { const slot = main.querySelector(`[data-slot="${id}"]`); if (slot) { slot.innerHTML = sectionHtml(sections[id]); wire(slot); } };
    function wire(el) {
      el.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => { sections[b.dataset.more].expanded = true; redraw(b.dataset.more); }; });
      el.querySelectorAll('[data-less]').forEach((b) => { b.onclick = () => { sections[b.dataset.less].expanded = false; redraw(b.dataset.less); }; });
      el.querySelectorAll('button[data-done]').forEach((b) => {
        b.onclick = async (ev) => {
          ev.preventDefault(); b.disabled = true;
          try { await call('set_task_done', { p_task: b.dataset.done, p_done: true }); window.pgToast('Task marked done.'); window.viewMyWork(); }
          catch (e) { window.pgToast(friendly(e), 'error'); b.disabled = false; }
        };
      });
      const nt = el.querySelector('#mw-nt'); if (nt) nt.onclick = () => { location.hash = '#/tasks'; };
    }
    wire(main);
    const rt = document.getElementById('mw-retry'); if (rt) rt.onclick = () => window.viewMyWork();
  };
})();
