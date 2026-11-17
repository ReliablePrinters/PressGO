'use strict';
// PressGO job activity: turns the database's own audit records (audit_events) into a readable timeline.
// Pure functions only (no screen, no network) so desktop/test/activity.test.js can check every rule without a browser.
//
// Nothing here makes up history. Every entry comes from a real audit record. When the records have gaps (older jobs, or changes made
// outside the app) the timeline says so with a marker, and the only entry that is not from the audit log, "created", is built from the
// job's own created_at / created_by columns and labelled as coming from the job record.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgActivity = Object.assign(root.pgActivity || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUS_ORDER = ['New', 'Queued', 'In Production', 'Finishing', 'Ready for Collection', 'Collected'];
  const DETAIL_FIELDS = [['customer_name', 'Customer'], ['customer_phone', 'Phone'], ['description', 'Description'], ['product', 'Product'], ['quantity', 'Quantity'],
    ['size', 'Size'], ['material', 'Material'], ['finishing', 'Finishing'], ['due_at', 'Due'], ['priority', 'Priority'], ['artwork_required', 'Artwork required']];
  const LABEL = Object.fromEntries(DETAIL_FIELDS);
  const CATEGORIES = [['all', 'All'], ['progress', 'Progress'], ['people', 'People'], ['details', 'Details'], ['files', 'Files & approvals'], ['problems', 'Problems']];

  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const blank = (v) => v === null || v === undefined || v === '';
  function same(field, a, b) {
    if (blank(a) && blank(b)) return true;
    if (blank(a) || blank(b)) return false;
    if (field === 'due_at') return new Date(a).getTime() === new Date(b).getTime();
    return String(a) === String(b);
  }
  const clip = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  // ---- what kind of row is this? (audit rows from several tables share one log; the shape of the saved copy tells them apart)
  function rowShape(ev) {
    const o = (isObj(ev.after) && ev.after) || (isObj(ev.before) && ev.before) || {};
    if ('lifecycle_status' in o && 'job_number' in o) return 'job';
    if ('storage_path' in o && 'file_name' in o) return 'file';
    if ('raised_by' in o || ('kind' in o && 'note' in o)) return 'hold';
    if ('to_department_id' in o) return 'handoff';
    if ('message_id' in o) return 'picture';
    return 'other';
  }

  // ---- the same real-world event can leave more than one audit row.
  // Accepting a handoff updates the handoff AND moves the job in one step, so both rows carry the same action and moment.
  // Keep the job row (it holds the department and owner change); drop the handoff row.
  const PREFER_JOB_ROW = new Set(['job.handoff_accepted']);
  function dedupe(events) {
    const seenId = new Set();
    let list = (events || []).filter((e) => e && !seenId.has(e.id) && seenId.add(e.id));
    const jobRowAt = new Set(list.filter((e) => PREFER_JOB_ROW.has(e.action) && rowShape(e) === 'job').map((e) => e.action + '|' + e.created_at));
    list = list.filter((e) => !(PREFER_JOB_ROW.has(e.action) && rowShape(e) !== 'job' && jobRowAt.has(e.action + '|' + e.created_at)));
    return list;
  }
  const byTime = (a, b) => (new Date(a.created_at) - new Date(b.created_at)) || (Number(a.id) - Number(b.id));

  // ---- values as people read them
  function makeFmt(ctx) {
    const nameOf = (ctx && ctx.nameOf) || (() => '');
    const deptName = (ctx && ctx.deptName) || (() => '');
    const when = (iso) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };
    return {
      value(field, v) {
        if (field === 'lifecycle_status') return blank(v) ? 'New' : String(v);
        if (field === 'current_assignee_id') return blank(v) ? 'Nobody' : (nameOf(v) || 'Someone');
        if (field === 'current_department_id') return blank(v) ? 'No department' : (deptName(v) || 'Another department');
        if (field === 'due_at') return blank(v) ? 'None' : when(v);
        if (field === 'artwork_required') return v ? 'Yes' : 'No';
        return blank(v) ? 'None' : clip(v, 60);
      },
      when,
    };
  }

  // ---- changes between two saved copies of the job
  function changesOf(before, after, fields, fmt) {
    const out = [];
    for (const [f, label] of fields) {
      if (!isObj(before) || !isObj(after) || same(f, before[f], after[f])) continue;
      out.push({ field: f, label, from: fmt.value(f, before[f]), to: fmt.value(f, after[f]) });
    }
    return out;
  }
  const OWNER_DEPT = [['current_assignee_id', 'Owner'], ['current_department_id', 'Department']];
  const STATUS = [['lifecycle_status', 'Status']];
  const ALL_FIELDS = [...STATUS, ...OWNER_DEPT, ...DETAIL_FIELDS];

  const moveVerb = (from, to) => {
    if (to === 'Cancelled') return 'cancelled the job';
    if (to === 'Collected') return 'marked the job collected';
    if (to === 'Ready for Collection') return 'marked the job ready for collection';
    if (to === 'Queued' && (from === 'New' || !from)) return 'released the job to production';
    if (to === 'In Production' && from === 'Queued') return 'started production';
    if (to === 'Finishing') return 'sent the job to finishing';
    const a = STATUS_ORDER.indexOf(from), b = STATUS_ORDER.indexOf(to);
    return a >= 0 && b >= 0 && b < a ? `moved the job back to ${to}` : `moved the job to ${to}`;
  };

  // ---- one audit row -> one timeline entry (or null when the row records no visible change)
  function entryFor(ev, ctx, fmt) {
    const shape = rowShape(ev);
    const a = isObj(ev.after) ? ev.after : null, b = isObj(ev.before) ? ev.before : null;
    const act = String(ev.action || '');
    const e = { key: 'e' + ev.id, id: ev.id, at: ev.created_at, actorId: ev.actor_id || null, actor: (ev.actor && ev.actor.display_name) || (ev.actor_id && ctx.nameOf && ctx.nameOf(ev.actor_id)) || '',
      kind: 'other', category: 'details', verb: '', chips: [], quote: '', reason: '', extra: [], action: act, source: 'log' };
    const reason = blank(ev.reason) ? '' : String(ev.reason);

    if (act === 'job.created' || act === 'jobs.insert') {
      e.kind = 'created'; e.category = 'progress'; e.verb = 'created the job';
      if (a) {
        if (!blank(a.current_department_id)) e.extra.push({ label: 'Department', value: fmt.value('current_department_id', a.current_department_id) });
        if (!blank(a.current_assignee_id)) e.extra.push({ label: 'Owner', value: fmt.value('current_assignee_id', a.current_assignee_id) });
        if (a.priority && a.priority !== 'Normal') e.extra.push({ label: 'Priority', value: a.priority });
        if (!blank(a.due_at)) e.extra.push({ label: 'Due', value: fmt.value('due_at', a.due_at) });
      }
      return e;
    }
    if (act.startsWith('job.status_')) {
      const from = b ? b.lifecycle_status : '', to = a ? a.lifecycle_status : '';
      e.kind = 'status'; e.category = 'progress'; e.verb = moveVerb(from, to);
      e.chips = [{ label: 'Status', from, to, status: true }];
      e.reason = reason;
      return e;
    }
    if (act === 'job.assigned' || act === 'job.unassigned' || act === 'job.handoff_accepted') {
      const ch = changesOf(b, a, OWNER_DEPT, fmt);
      const owner = ch.find((c) => c.field === 'current_assignee_id'), dept = ch.find((c) => c.field === 'current_department_id');
      e.kind = act === 'job.handoff_accepted' ? 'handoff' : 'owner'; e.category = 'people'; e.chips = ch; e.reason = act === 'job.handoff_accepted' ? '' : reason;
      if (act === 'job.handoff_accepted') {
        e.verb = dept ? `accepted the handoff to ${dept.to}` : 'accepted the handoff';
      } else if (owner && dept) { e.verb = 'reassigned the job'; }
      else if (owner) {
        const was = b && !blank(b.current_assignee_id), now = a && !blank(a.current_assignee_id);
        e.verb = !now ? 'removed the owner' : !was ? `assigned the job to ${owner.to}` : `reassigned the job to ${owner.to}`;
      } else if (dept) { e.verb = `moved the job to ${dept.to}`; e.kind = 'department'; }
      else if (!b || !a) { e.verb = act === 'job.unassigned' ? 'removed the owner' : 'assigned the job'; }
      else { return null; }                                   // no owner or department change: nothing to show
      return e;
    }
    if (act === 'job.details_changed') {
      const ch = changesOf(b, a, DETAIL_FIELDS, fmt);
      if (!ch.length) return null;
      e.kind = 'details'; e.category = 'details'; e.chips = ch; e.reason = reason;
      const names = ch.map((c) => c.label.toLowerCase());
      e.verb = ch.length === 1 ? `changed the ${names[0]}` : 'changed the job details';
      return e;
    }
    if (act === 'job.deleted') { e.kind = 'delete'; e.category = 'progress'; e.verb = 'deleted the job'; e.reason = reason; return e; }
    if (act === 'file.uploaded') {
      e.kind = 'file'; e.category = 'files'; e.verb = `uploaded ${a && a.file_name ? a.file_name : 'a file'}`;
      if (a) { if (a.category) e.chips.push({ label: 'Type', value: a.category }); if (a.version_no) e.chips.push({ label: 'Version', value: 'v' + a.version_no }); }
      return e;
    }
    if (act === 'job.artwork_approved' || act === 'job.artwork_approval_withdrawn') {
      const ok = act === 'job.artwork_approved';
      e.kind = 'artwork'; e.category = 'files'; e.verb = ok ? 'approved the artwork for print' : 'withdrew the artwork approval';
      e.reason = ok ? '' : reason;
      if (ok && reason) e.extra.push({ label: 'File', value: reason.replace(/^Approved for Print:\s*/i, '') });
      return e;
    }
    if (act === 'job.picture_approved' || act === 'job.picture_approval_withdrawn') {
      const ok = act === 'job.picture_approved';
      e.kind = 'picture'; e.category = 'files'; e.verb = ok ? 'approved a picture' : 'took back a picture approval';
      if (a && a.file_name) e.extra.push({ label: 'File', value: a.file_name });
      return e;
    }
    if (act === 'job.problem_raised') {
      e.kind = 'problem'; e.category = 'problems'; e.verb = 'reported a problem';
      if (a && a.kind) e.chips.push({ label: 'Kind', value: a.kind });
      e.quote = a && a.note ? String(a.note) : '';
      return e;
    }
    if (act === 'job.problem_resolved') {
      e.kind = 'problem'; e.category = 'problems'; e.verb = 'resolved a problem';
      if (b && b.kind) e.chips.push({ label: 'Kind', value: b.kind });
      e.quote = (a && a.resolution_note) || reason || '';
      return e;
    }
    if (act === 'job.handoff_sent' || act === 'job.handoff_cancelled') {
      const o = a || b || {};
      e.kind = 'handoff'; e.category = 'people';
      if (act === 'job.handoff_sent') {
        e.verb = `handed the job off to ${fmt.value('current_department_id', o.to_department_id)}`;
        if (!blank(o.from_department_id)) e.chips.push({ label: 'Department', from: fmt.value('current_department_id', o.from_department_id), to: fmt.value('current_department_id', o.to_department_id) });
        e.quote = o.note ? String(o.note) : '';
      } else e.verb = 'cancelled the handoff';
      return e;
    }
    // anything else (an older or unknown action name, or a change made outside the app): describe only what really changed
    if (shape === 'job') {
      const ch = changesOf(b, a, ALL_FIELDS, fmt);
      if (!ch.length) return null;                           // a save that changed nothing a person cares about
      e.chips = ch; e.reason = reason;
      const st = ch.find((c) => c.field === 'lifecycle_status');
      if (st) { e.kind = 'status'; e.category = 'progress'; e.verb = moveVerb(st.from, st.to); }
      else if (ch.some((c) => OWNER_DEPT.some(([f]) => f === c.field))) { e.kind = 'owner'; e.category = 'people'; e.verb = 'changed the owner or department'; }
      else { e.kind = 'details'; e.category = 'details'; e.verb = ch.length === 1 ? `changed the ${ch[0].label.toLowerCase()}` : 'changed the job details'; }
      return e;
    }
    if (shape === 'file') { e.kind = 'file'; e.category = 'files'; e.verb = `uploaded ${a && a.file_name ? a.file_name : 'a file'}`; return e; }
    if (shape === 'hold') { e.kind = 'problem'; e.category = 'problems'; e.verb = a && a.resolved_at ? 'resolved a problem' : 'reported a problem'; e.quote = (a && (a.resolution_note || a.note)) || ''; return e; }
    if (shape === 'handoff') { e.kind = 'handoff'; e.category = 'people'; e.verb = 'updated a handoff'; return e; }
    e.verb = 'made a change'; e.reason = reason;            // unknown: say so plainly rather than guess
    return e;
  }

  // ---- gaps: the job row carries a version number that goes up by one with every saved change.
  // If the saved copies do not chain together, some changes were never recorded. Count them; never invent them.
  function findGaps(jobEvents, job) {
    const gaps = [];
    const rows = jobEvents.filter((e) => isObj(e.after) && Number.isFinite(Number(e.after.version))).sort(byTime);
    if (!rows.length) return { gaps, rows };
    const first = rows[0];
    const firstBefore = isObj(first.before) && Number.isFinite(Number(first.before.version)) ? Number(first.before.version) : 0;
    if (firstBefore > 1) gaps.push({ where: 'start', missing: firstBefore - 1, until: first.created_at });
    for (let i = 1; i < rows.length; i++) {
      const prevAfter = Number(rows[i - 1].after.version);
      const curBefore = isObj(rows[i].before) ? Number(rows[i].before.version) : NaN;
      if (Number.isFinite(curBefore) && curBefore > prevAfter) gaps.push({ where: 'between', missing: curBefore - prevAfter, from: rows[i - 1].created_at, until: rows[i].created_at });
    }
    const last = rows[rows.length - 1];
    if (job && Number.isFinite(Number(job.version)) && Number(job.version) > Number(last.after.version)) gaps.push({ where: 'end', missing: Number(job.version) - Number(last.after.version), from: last.created_at });
    return { gaps, rows };
  }

  // ---- the whole timeline, oldest first
  // events: audit_events rows for ONE job (id, action, reason, created_at, actor_id, actor{display_name}, before, after)
  // ctx: { job, nameOf(id), deptName(id) }
  function build(events, ctx) {
    ctx = ctx || {};
    const fmt = makeFmt(ctx);
    const job = ctx.job || null;
    const list = dedupe(events).sort(byTime);
    const entries = [];
    for (const ev of list) { const e = entryFor(ev, ctx, fmt); if (e) entries.push(e); }

    // the job record itself says who created it and when; use it only if the log has no creation entry
    const jobRows = list.filter((e) => rowShape(e) === 'job');
    const hasCreated = entries.some((e) => e.kind === 'created');
    if (!hasCreated && job && job.created_at) {
      entries.push({ key: 'record-created', id: 'record', at: job.created_at, actorId: job.created_by || null, actor: (job.created_by && ctx.nameOf && ctx.nameOf(job.created_by)) || '',
        kind: 'created', category: 'progress', verb: 'created the job', chips: [], quote: '', reason: '', extra: [], action: 'record', source: 'record' });
    }

    const { gaps } = findGaps(jobRows, job);
    const noLog = !jobRows.length && job && Number(job.version) > 1;
    for (const g of gaps) {
      const text = g.missing === 1 ? 'One change to this job was not recorded' : `${g.missing} changes to this job were not recorded`;
      const when = g.where === 'start' ? `before ${fmt.when(g.until)}` : g.where === 'between' ? (fmt.when(g.from) === fmt.when(g.until) ? `around ${fmt.when(g.from)}` : `between ${fmt.when(g.from)} and ${fmt.when(g.until)}`) : `after ${fmt.when(g.from)}`;
      const at = g.where === 'start' ? new Date(new Date(g.until).getTime() - 1).toISOString() : g.where === 'between' ? g.until : new Date(new Date(g.from).getTime() + 1).toISOString();
      entries.push({ key: 'gap-' + g.where + '-' + (g.until || g.from), id: 'gap', type: 'gap', at, kind: 'gap', category: 'all', verb: text, detail: when, chips: [], quote: '', reason: '', extra: [], source: 'gap' });
    }
    if (noLog) {
      entries.push({ key: 'gap-none', id: 'gap', type: 'gap', at: new Date(new Date(job.created_at || 0).getTime() + 1).toISOString(), kind: 'gap', category: 'all',
        verb: 'No detailed history was kept for this job', detail: `It has been changed ${Number(job.version) - 1} time${Number(job.version) - 1 === 1 ? '' : 's'} since it was created.`, chips: [], quote: '', reason: '', extra: [], source: 'gap' });
    }
    entries.sort((x, y) => (new Date(x.at) - new Date(y.at)) || ((x.type === 'gap') - (y.type === 'gap')) || (Number(x.id) || 0) - (Number(y.id) || 0));
    return { entries, gaps, hasLog: jobRows.length > 0 };
  }

  // ---- what to show: newest N (so the latest is always visible), in the order asked for, filtered by type
  function select(entries, o) {
    o = o || {};
    const filter = o.filter || 'all', newestFirst = o.order !== 'oldest', limit = o.expanded ? Infinity : (o.limit || 8);
    let list = entries.filter((e) => filter === 'all' || (e.type !== 'gap' && e.category === filter));
    const total = list.length;
    const shown = list.slice(Math.max(0, list.length - limit));       // keep the newest
    return { items: newestFirst ? shown.slice().reverse() : shown, hidden: total - shown.length, total };
  }

  // ---- group by calendar day (in the viewer's own time zone)
  function dayKey(iso, offsetMinutes) {
    const d = new Date(new Date(iso).getTime() - (offsetMinutes || 0) * 60000);
    return d.toISOString().slice(0, 10);
  }
  function groupByDay(items, o) {
    o = o || {};
    const off = o.offsetMinutes != null ? o.offsetMinutes : (typeof Date !== 'undefined' ? new Date().getTimezoneOffset() : 0);
    const now = o.now ? new Date(o.now) : new Date();
    const today = dayKey(now.toISOString(), off), yest = dayKey(new Date(now.getTime() - 864e5).toISOString(), off);
    const fmtDay = o.fmtDay || ((key) => new Date(key + 'T12:00:00Z').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));
    const groups = [];
    for (const it of items) {
      const k = dayKey(it.at, off);
      let g = groups[groups.length - 1];
      if (!g || g.key !== k) { g = { key: k, label: k === today ? 'Today' : k === yest ? 'Yesterday' : fmtDay(k), items: [] }; groups.push(g); }
      g.items.push(it);
    }
    return groups;
  }

  // the same entries for audit records of SEVERAL jobs at once (used by My Work); each keeps the job it belongs to
  function describe(events, ctx) {
    ctx = ctx || {};
    const fmt = makeFmt(ctx);
    const out = [];
    for (const ev of dedupe(events).sort(byTime)) { const e = entryFor(ev, ctx, fmt); if (!e) continue; e.jobId = ev.job_id || null; out.push(e); }
    return out;
  }

  // "Last activity" for the top of the job page: the newest real entry
  function latest(entries) { for (let i = entries.length - 1; i >= 0; i--) if (entries[i].type !== 'gap') return entries[i]; return null; }
  const summary = (e) => (e ? `${e.actor || 'Someone'} ${e.verb}` : '');
  // which people's names the timeline needs to look up (owners, raisers, creators) so the screen can fetch them in one go
  function idsNeeded(events, job) {
    const ids = new Set();
    for (const ev of events || []) {
      for (const o of [ev && ev.before, ev && ev.after]) {
        if (!isObj(o)) continue;
        for (const k of ['current_assignee_id', 'created_by', 'raised_by', 'from_employee_id']) if (typeof o[k] === 'string') ids.add(o[k]);
      }
      if (ev && ev.actor_id && !(ev.actor && ev.actor.display_name)) ids.add(ev.actor_id);
    }
    if (job && job.created_by) ids.add(job.created_by);
    return [...ids];
  }

  return { STATUS_ORDER, DETAIL_FIELDS, CATEGORIES, rowShape, dedupe, same, build, describe, select, groupByDay, dayKey, findGaps, latest, summary, idsNeeded, moveVerb, entryFor, clip };
});
