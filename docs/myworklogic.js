'use strict';
// PressGO My Work: the rules that decide what lands on one person's "My work" page.
// Pure functions only (no screen, no network) so desktop/test/mywork.test.js can check every rule without a browser.
//
// What a person may SEE is decided by the database (every list below is fetched with their own login, so jobs, tasks, problems and
// handoffs they may not open are never in the input). These rules only decide where each thing goes on the page, in what order, and
// that nothing appears twice.
//
// One job appears in ONE job section: Needs attention, else Pending approvals, else Front desk queue, else Assigned jobs.
// All the reasons it has are shown as chips on that one row. Tasks, messages and activity are different kinds of thing and have their own sections.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgMyWork = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const LIMITS = { attention: 6, approvals: 5, desk: 4, jobs: 6, tasks: 5, messages: 5, activity: 6, activityMax: 12 };
  const RECENT_DAYS = 7;
  const HOUR = 36e5;

  const isClosed = (j) => j.lifecycle_status === 'Collected' || j.lifecycle_status === 'Cancelled';
  const isLate = (j, now) => !isClosed(j) && j.lifecycle_status !== 'Ready for Collection' && new Date(j.due_at).getTime() < now;
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const dueMs = (j) => (j && j.due_at ? new Date(j.due_at).getTime() : Infinity);

  function lateText(due, now) {
    const h = Math.max(1, Math.round((now - new Date(due).getTime()) / HOUR));
    return h < 48 ? `${h}h overdue` : `${Math.round(h / 24)}d overdue`;
  }

  // ---- the reasons a job is on the page
  const WEIGHT = { problem: 50, handoff: 45, overdue: 40, today: 25, artwork: 20, rush: 10, release: 4, collect: 4 };
  function reasonsFor(j, ctx) {
    const { me, now, holds, handoffs, inDept } = ctx;
    const mgr = !!me.manager_role, approver = !!(me.manager_role || me.front_desk);
    const mine = j.current_assignee_id === me.id;
    const attention = [], approval = [], desk = [];

    if (isLate(j, now) && (mine || mgr)) attention.push({ type: 'overdue', tone: 'bad', text: lateText(j.due_at, now), weight: WEIGHT.overdue + Math.min(20, ((now - new Date(j.due_at).getTime()) / HOUR) / 12) });
    else if (mine && j.lifecycle_status !== 'Ready for Collection' && sameDay(j.due_at, now)) attention.push({ type: 'today', tone: 'warn', text: 'Due today', weight: WEIGHT.today });

    for (const h of holds) {
      if (h.job_id !== j.id) continue;
      if (mgr || mine || inDept(j.current_department_id)) attention.push({ type: 'problem', tone: 'bad', text: `${h.kind}: ${clip(h.note, 70)}`, weight: WEIGHT.problem });
    }
    for (const h of handoffs) {
      if (h.job_id !== j.id) continue;
      if (mgr || inDept(h.to_department_id)) attention.push({ type: 'handoff', tone: 'warn', text: h.note ? `Waiting for you to accept: ${clip(h.note, 60)}` : 'Waiting for you to accept', weight: WEIGHT.handoff, handoffId: h.id });
    }
    if (approver && j.artwork_required) {
      const files = (ctx.artworkByJob.get(j.id) || []).filter((f) => f.category !== 'Supporting Document');
      if (files.length) {
        const newest = files.slice().sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
        const approved = j.approved_file_id ? files.find((f) => f.id === j.approved_file_id) : null;
        if (!j.approved_file_id) approval.push({ type: 'artwork', tone: 'info', text: `Artwork waiting for approval: ${clip(newest.file_name, 40)} (v${newest.version_no})`, weight: WEIGHT.artwork });
        else if (approved && new Date(newest.uploaded_at) > new Date(approved.uploaded_at) && newest.id !== approved.id) approval.push({ type: 'artwork', tone: 'info', text: `New artwork since approval: ${clip(newest.file_name, 40)} (v${newest.version_no})`, weight: WEIGHT.artwork });
      }
    }
    if (mgr || me.front_desk) {
      if (j.lifecycle_status === 'New') desk.push({ type: 'release', tone: 'info', text: 'Ready to release to production', weight: WEIGHT.release, group: 'release' });
      if (j.lifecycle_status === 'Ready for Collection') desk.push({ type: 'collect', tone: 'info', text: 'Ready for the customer to collect', weight: WEIGHT.collect, group: 'collect' });
    }
    return { attention, approval, desk, mine };
  }

  const scoreOf = (reasons, j) => {
    const ws = reasons.map((r) => r.weight);
    return Math.max(0, ...ws) + 0.1 * ws.reduce((a, b) => a + b, 0) + (j && j.priority === 'Rush' ? WEIGHT.rush : 0);
  };

  // ---- the page
  // input: { me, now, inDept(deptId), jobs, holds, handoffs, tasks, convs, artworkFiles, pictures, activity }
  //   jobs: open jobs the person can see; holds: unresolved problems; handoffs: pending handoffs; tasks: open tasks;
  //   convs: my_conversations rows; artworkFiles: job_files of the jobs that need a look; pictures: chat pictures not yet approved;
  //   activity: ready-made entries { key, jobId, at, actor, verb } about the person's jobs, made by other people
  function build(input) {
    const me = input.me, now = input.now != null ? Number(input.now) : Date.now();
    const inDept = input.inDept || (() => false);
    const approver = !!(me.manager_role || me.front_desk), deskRole = approver;
    const jobs = (input.jobs || []).filter((j) => j && !isClosed(j));
    const jobIds = new Set(jobs.map((j) => j.id));
    const holds = (input.holds || []).filter((h) => jobIds.has(h.job_id));
    const handoffs = (input.handoffs || []).filter((h) => jobIds.has(h.job_id));
    const artworkByJob = new Map();
    for (const f of input.artworkFiles || []) { if (!artworkByJob.has(f.job_id)) artworkByJob.set(f.job_id, []); artworkByJob.get(f.job_id).push(f); }
    const ctx = { me, now, holds, handoffs, inDept, artworkByJob };

    const attention = [], approvals = [], desk = [], assigned = [];
    let mineCount = 0, mineElsewhere = 0;
    for (const j of jobs) {
      const r = reasonsFor(j, ctx);
      if (r.mine) mineCount++;
      const rush = j.priority === 'Rush' ? [{ type: 'rush', tone: 'bad', text: 'Rush', weight: WEIGHT.rush }] : [];
      const base = { kind: 'job', id: j.id, job: j, href: '#/job/' + j.id };
      if (r.attention.length) {
        const reasons = [...r.attention, ...rush, ...r.approval];      // (the front desk reason is shown only in the front desk queue: the row is already here for a more urgent one)
        attention.push({ ...base, section: 'attention', reasons, score: scoreOf(r.attention, j) });
        if (r.mine) mineElsewhere++;
      } else if (r.approval.length) {
        approvals.push({ ...base, section: 'approvals', reasons: [...r.approval, ...rush], score: scoreOf(r.approval, j) });
        if (r.mine) mineElsewhere++;
      } else if (r.desk.length && deskRole) {
        desk.push({ ...base, section: 'desk', group: r.desk[0].group, reasons: [...r.desk, ...rush], score: scoreOf(r.desk, j) });
        if (r.mine) mineElsewhere++;
      } else if (r.mine) {
        assigned.push({ ...base, section: 'jobs', reasons: rush, score: rush.length ? WEIGHT.rush : 0 });
      }
    }

    // tasks: overdue ones need attention (once), the rest are plain tasks
    const myTasks = (input.tasks || []).filter((t) => t && !t.done_at && t.assigned_to === me.id);
    const taskItems = [];
    for (const t of myTasks) {
      const late = t.due_at && new Date(t.due_at).getTime() < now;
      const item = { kind: 'task', id: t.id, task: t, href: t.job_id ? '#/job/' + t.job_id : '#/tasks', reasons: [] };
      if (late) {
        item.reasons = [{ type: 'overdue-task', tone: 'bad', text: lateText(t.due_at, now), weight: 38 }];
        item.score = 38 + Math.min(20, ((now - new Date(t.due_at).getTime()) / HOUR) / 12);
        item.section = 'attention';
        attention.push(item);
      } else { item.section = 'tasks'; taskItems.push(item); }
    }
    attention.sort((a, b) => b.score - a.score || dueMs(a.job || a.task) - dueMs(b.job || b.task));
    approvals.sort((a, b) => dueMs(a.job) - dueMs(b.job));
    desk.sort((a, b) => dueMs(a.job) - dueMs(b.job));
    assigned.sort((a, b) => b.score - a.score || dueMs(a.job) - dueMs(b.job));
    taskItems.sort((a, b) => (a.task.due_at ? new Date(a.task.due_at).getTime() : Infinity) - (b.task.due_at ? new Date(b.task.due_at).getTime() : Infinity));

    // chat pictures waiting for approval (only people who can approve; never your own)
    const pictures = approver
      ? (input.pictures || []).filter((p) => p && p.author_id !== me.id).slice().sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
        .map((p) => ({ kind: 'picture', id: p.id, picture: p, section: 'approvals', href: p.href, reasons: [{ type: 'picture', tone: 'info', text: 'Picture waiting for approval' }] }))
      : [];
    const approvalItems = [...approvals, ...pictures];

    // unread conversations
    const unreadConvs = (input.convs || []).filter((c) => c && Number(c.unread) > 0)
      .sort((a, b) => new Date(b.last_at || 0) - new Date(a.last_at || 0))
      .map((c) => ({ kind: 'conversation', id: c.id, conv: c, href: c.href, unread: Number(c.unread) }));
    const unreadTotal = unreadConvs.reduce((a, c) => a + c.unread, 0);

    // recent activity on my jobs by other people, newest first, within a week
    const cutoff = now - RECENT_DAYS * 24 * HOUR;
    const seen = new Set();
    const activity = (input.activity || []).filter((a) => a && new Date(a.at).getTime() >= cutoff && !seen.has(a.key) && seen.add(a.key))
      .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, LIMITS.activityMax);

    const counts = { attention: attention.length, approvals: approvalItems.length, desk: desk.length, jobs: mineCount, tasks: myTasks.length, unread: unreadTotal, unreadChats: unreadConvs.length, activity: activity.length, mineElsewhere };
    const allClear = !attention.length && !approvalItems.length && !desk.length && !assigned.length && !taskItems.length && !unreadConvs.length;
    return { attention, approvals: approvalItems, desk, jobs: assigned, tasks: taskItems, messages: unreadConvs, activity, counts, allClear,
      roles: { manager: !!me.manager_role, frontDesk: !!me.front_desk, approver, deskRole } };
  }

  // a plain sentence for the top of the page and for screen readers
  function summary(res) {
    const c = res.counts, bits = [];
    if (c.attention) bits.push(`${c.attention} need${c.attention === 1 ? 's' : ''} attention`);
    if (res.roles.approver && c.approvals) bits.push(`${c.approvals} to approve`);
    bits.push(`${c.jobs} job${c.jobs === 1 ? '' : 's'}`);
    bits.push(`${c.tasks} task${c.tasks === 1 ? '' : 's'}`);
    if (c.unread) bits.push(`${c.unread} unread message${c.unread === 1 ? '' : 's'}`);
    return bits.join(' · ');
  }

  // the part of the list to show now (the first few, or everything once someone asks for more)
  const take = (list, limit, expanded) => ({ items: expanded ? list : list.slice(0, limit), more: expanded ? 0 : Math.max(0, list.length - limit) });

  return { LIMITS, RECENT_DAYS, isClosed, isLate, lateText, reasonsFor, build, summary, take, scoreOf };
});
