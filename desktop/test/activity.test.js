'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../../docs/activitylogic.js');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

// ---- fixtures shaped like real audit_events rows (checked against the database in supabase/tests/activity_history_test.sql)
const P = { mgr: 'p-mgr', fd: 'p-fd', bin: 'p-bin', nov: 'p-nov' };
const NAMES = { [P.mgr]: 'Maria Manager', [P.fd]: 'Fiona FrontDesk', [P.bin]: 'Ben Bindery', [P.nov]: 'Nina Novelty' };
const DEPTS = { d1: 'Front Desk', d2: 'Novelty', d3: 'Bindery', d4: 'Managers' };
const ctx = (job) => ({ job, nameOf: (id) => NAMES[id] || '', deptName: (id) => DEPTS[id] || '' });
const J0 = { id: 'job1', job_number: 1042, customer_name: 'Acme Ltd', customer_phone: '555-0100', description: 'Flyers', product: 'Flyers', quantity: 500, size: 'A5', material: '150gsm', finishing: 'None',
  due_at: '2026-11-20T10:00:00Z', priority: 'Normal', lifecycle_status: 'New', current_department_id: 'd2', current_assignee_id: null, artwork_required: true, approved_file_id: null, version: 1, created_by: P.fd, created_at: '2026-11-10T09:00:00Z' };
let nid = 0;
const t = (min) => new Date(Date.UTC(2026, 10, 10, 9, 0, 0) + min * 60000).toISOString();
function rowEv(action, minute, actor, before, after, reason) { return { id: ++nid, action, created_at: t(minute), actor_id: actor, actor: { display_name: NAMES[actor] || null }, before, after, reason: reason || null }; }
const bump = (o, patch) => ({ ...o, ...patch, version: o.version + 1 });

function lifeStory() {
  const evs = []; let cur = { ...J0 };
  evs.push(rowEv('job.created', 0, P.fd, null, cur));
  let n = bump(cur, { current_assignee_id: P.nov }); evs.push(rowEv('job.assigned', 5, P.fd, cur, n)); cur = n;
  n = bump(cur, { lifecycle_status: 'Queued' }); evs.push(rowEv('job.status_queued', 10, P.fd, cur, n)); cur = n;
  n = bump(cur, { lifecycle_status: 'In Production' }); evs.push(rowEv('job.status_in_production', 60, P.nov, cur, n)); cur = n;
  n = bump(cur, { priority: 'Rush', due_at: '2026-11-18T10:00:00Z', quantity: 600 }); evs.push(rowEv('job.details_changed', 90, P.mgr, cur, n, 'Customer needs them sooner')); cur = n;
  evs.push(rowEv('job.problem_raised', 100, P.nov, null, { id: 'h1', job_id: 'job1', kind: 'Material', note: 'Paper stock is short by 50 sheets', raised_by: P.nov, resolved_at: null }, 'Material'));
  evs.push(rowEv('job.problem_resolved', 120, P.fd, { id: 'h1', job_id: 'job1', kind: 'Material', note: 'Paper stock is short by 50 sheets', raised_by: P.nov, resolved_at: null }, { id: 'h1', job_id: 'job1', kind: 'Material', note: 'Paper stock is short by 50 sheets', raised_by: P.nov, resolved_at: t(120), resolution_note: 'More paper delivered' }, 'More paper delivered'));
  evs.push(rowEv('file.uploaded', 130, P.fd, null, { id: 'f1', job_id: 'job1', category: 'Artwork Revision', file_name: 'flyer.pdf', storage_path: 'job1/f1.pdf', version_no: 2 }));
  n = bump(cur, { approved_file_id: 'f1' }); evs.push(rowEv('job.artwork_approved', 140, P.fd, cur, n, 'Approved for Print: flyer.pdf (v2)')); cur = n;
  const hand = { id: 'ho1', job_id: 'job1', from_department_id: 'd2', to_department_id: 'd3', from_employee_id: P.nov, note: 'Please fold and trim', status: 'Pending' };
  evs.push(rowEv('job.handoff_sent', 200, P.nov, null, hand));
  n = bump(cur, { current_department_id: 'd3', current_assignee_id: P.bin });
  evs.push(rowEv('job.handoff_accepted', 230, P.bin, hand, { ...hand, status: 'Accepted' }));      // the handoff row ...
  evs.push(rowEv('job.handoff_accepted', 230, P.bin, cur, n)); cur = n;                          // ... and the job row, same moment
  n = bump(cur, { lifecycle_status: 'Ready for Collection' }); evs.push(rowEv('job.status_ready_for_collection', 300, P.bin, cur, n)); cur = n;
  n = bump(cur, { lifecycle_status: 'Collected' }); evs.push(rowEv('job.status_collected', 400, P.fd, cur, n)); cur = n;
  return { evs, job: cur };
}

test('a whole job life reads as one clean timeline: who, what, when', () => {
  const { evs, job } = lifeStory();
  const { entries, gaps, hasLog } = A.build(evs.slice().reverse(), ctx(job));          // order of the input does not matter
  assert.strictEqual(gaps.length, 0);
  assert.ok(hasLog);
  assert.deepStrictEqual(entries.map((e) => e.verb), [
    'created the job', 'assigned the job to Nina Novelty', 'released the job to production', 'started production', 'changed the job details', 'reported a problem', 'resolved a problem',
    'uploaded flyer.pdf', 'approved the artwork for print', 'handed the job off to Bindery', 'accepted the handoff to Bindery', 'marked the job ready for collection', 'marked the job collected']);
  assert.deepStrictEqual(entries.map((e) => e.actor), ['Fiona FrontDesk', 'Fiona FrontDesk', 'Fiona FrontDesk', 'Nina Novelty', 'Maria Manager', 'Nina Novelty', 'Fiona FrontDesk', 'Fiona FrontDesk', 'Fiona FrontDesk', 'Nina Novelty', 'Ben Bindery', 'Ben Bindery', 'Fiona FrontDesk']);
  assert.deepStrictEqual(entries.map((e) => e.at), entries.map((e) => e.at).slice().sort(), 'oldest first');
  assert.strictEqual(entries[3].at, t(60), 'the time is the recorded time');
});

test('old and new values are shown, with names instead of ids', () => {
  const { evs, job } = lifeStory();
  const { entries } = A.build(evs, ctx(job));
  const by = (v) => entries.find((e) => e.verb === v);
  assert.deepStrictEqual(by('started production').chips, [{ label: 'Status', from: 'Queued', to: 'In Production', status: true }]);
  const d = by('changed the job details');
  assert.deepStrictEqual(d.chips.map((c) => c.label + ':' + c.from + '>' + c.to).filter((x) => !x.startsWith('Due')), ['Quantity:500>600', 'Priority:Normal>Rush']);
  assert.ok(d.chips.some((c) => c.label === 'Due' && c.from !== c.to));
  assert.strictEqual(d.reason, 'Customer needs them sooner');
  assert.deepStrictEqual(by('assigned the job to Nina Novelty').chips, [{ field: 'current_assignee_id', label: 'Owner', from: 'Nobody', to: 'Nina Novelty' }]);
  const acc = by('accepted the handoff to Bindery');
  assert.deepStrictEqual(acc.chips.map((c) => c.label + ':' + c.from + '>' + c.to), ['Owner:Nina Novelty>Ben Bindery', 'Department:Novelty>Bindery']);
  assert.strictEqual(by('reported a problem').quote, 'Paper stock is short by 50 sheets');
  assert.strictEqual(by('resolved a problem').quote, 'More paper delivered');
  assert.deepStrictEqual(by('uploaded flyer.pdf').chips, [{ label: 'Type', value: 'Artwork Revision' }, { label: 'Version', value: 'v2' }]);
  assert.deepStrictEqual(by('approved the artwork for print').extra, [{ label: 'File', value: 'flyer.pdf (v2)' }]);
});

test('one real event never shows twice: accepting a handoff leaves two audit rows and one entry', () => {
  const { evs, job } = lifeStory();
  assert.strictEqual(evs.filter((e) => e.action === 'job.handoff_accepted').length, 2);
  const { entries } = A.build(evs, ctx(job));
  assert.strictEqual(entries.filter((e) => e.action === 'job.handoff_accepted').length, 1);
  assert.strictEqual(A.dedupe([{ id: 1, action: 'x', created_at: t(0) }, { id: 1, action: 'x', created_at: t(0) }]).length, 1, 'the same record twice');
  const onlyHandoffRow = evs.filter((e) => e.action !== 'job.handoff_accepted' || A.rowShape(e) !== 'job');
  assert.strictEqual(A.build(onlyHandoffRow, ctx(job)).entries.filter((e) => e.action === 'job.handoff_accepted').length, 1, 'if only the handoff row exists it is kept');
});

test('records that change nothing a person cares about are left out; unknown ones are described plainly', () => {
  const noop = rowEv('job.details_changed', 1, P.fd, J0, bump(J0, {}));
  assert.strictEqual(A.build([noop], ctx(J0)).entries.filter((e) => e.action === 'job.details_changed').length, 0, 'an edit that saved the same values');
  const silent = rowEv('jobs.update', 2, null, J0, bump(J0, { updated_at: 'x' }));
  assert.strictEqual(A.build([silent], ctx(J0)).entries.filter((e) => e.action === 'jobs.update').length, 0);
  // a change made outside the app (SQL, no action name, no person): still shown, from what really changed
  const outside = rowEv('jobs.update', 3, null, J0, bump(J0, { lifecycle_status: 'Queued', priority: 'Rush' }));
  const e = A.build([outside], ctx(J0)).entries.find((x) => x.action === 'jobs.update');
  assert.strictEqual(e.verb, 'released the job to production');
  assert.deepStrictEqual(e.chips.map((c) => c.label), ['Status', 'Priority']);
  assert.strictEqual(e.actor, '', 'no person recorded: the screen says System');
  const odd = A.build([rowEv('something.new', 4, P.fd, null, { x: 1 })], ctx(J0)).entries.find((x) => x.action === 'something.new');
  assert.strictEqual(odd.verb, 'made a change', 'never guesses');
  // a legacy "jobs.insert" counts as the creation
  assert.strictEqual(A.build([rowEv('jobs.insert', 0, P.fd, null, J0)], ctx(J0)).entries[0].verb, 'created the job');
});

test('moving backwards, cancelling and unassigning use the right words', () => {
  assert.strictEqual(A.moveVerb('Finishing', 'In Production'), 'moved the job back to In Production');
  assert.strictEqual(A.moveVerb('Queued', 'Cancelled'), 'cancelled the job');
  const owned = bump(J0, { current_assignee_id: P.nov });
  const un = rowEv('job.unassigned', 1, P.mgr, owned, bump(owned, { current_assignee_id: null }));
  assert.strictEqual(A.build([un], ctx(J0)).entries.find((x) => x.action === 'job.unassigned').verb, 'removed the owner');
  const re = rowEv('job.assigned', 2, P.mgr, owned, bump(owned, { current_assignee_id: P.bin }));
  assert.strictEqual(A.build([re], ctx(J0)).entries.find((x) => x.action === 'job.assigned').verb, 'reassigned the job to Ben Bindery');
  const both = rowEv('job.assigned', 3, P.mgr, owned, bump(owned, { current_assignee_id: P.bin, current_department_id: 'd3' }));
  const e = A.build([both], ctx(J0)).entries.find((x) => x.action === 'job.assigned');
  assert.strictEqual(e.verb, 'reassigned the job');
  assert.deepStrictEqual(e.chips.map((c) => c.label), ['Owner', 'Department']);
  const dept = rowEv('job.assigned', 4, P.mgr, owned, bump(owned, { current_department_id: 'd3' }));
  assert.strictEqual(A.build([dept], ctx(J0)).entries.find((x) => x.action === 'job.assigned').verb, 'moved the job to Bindery');
});

// ---------------- older jobs: honest gaps, nothing invented
test('a complete history has no gap markers', () => {
  const { evs, job } = lifeStory();
  const r = A.build(evs, ctx(job));
  assert.strictEqual(r.entries.filter((e) => e.type === 'gap').length, 0);
});

test('missing changes are counted, never invented: start, middle and end', () => {
  const { evs, job } = lifeStory();
  // the middle: drop the "started production" and "details changed" records (two version numbers vanish)
  const middle = evs.filter((e) => e.action !== 'job.status_in_production' && e.action !== 'job.details_changed');
  const m = A.build(middle, ctx(job));
  const g = m.entries.filter((e) => e.type === 'gap');
  assert.strictEqual(g.length, 1);
  assert.match(g[0].verb, /^2 changes to this job were not recorded$/);
  assert.ok(!m.entries.some((e) => e.verb === 'started production'), 'the missing event is not reconstructed');
  // the start: the log begins after the job was already changed
  const start = A.build(evs.slice(3), ctx(job));
  assert.match(start.entries.find((e) => e.type === 'gap').verb, /changes to this job were not recorded/);
  assert.strictEqual(start.gaps[0].where, 'start');
  // the end: the job has been saved since the last record
  const end = A.build(evs.slice(0, 5), ctx({ ...job }));
  const eg = end.entries.filter((e) => e.type === 'gap');
  assert.strictEqual(eg.length, 1);
  assert.strictEqual(end.gaps[0].where, 'end');
  assert.strictEqual(A.build(evs.slice(0, 2), ctx({ ...J0, version: 3 })).gaps[0].missing, 1);
  assert.match(A.build(evs.slice(0, 2), ctx({ ...J0, version: 3 })).entries.find((e) => e.type === 'gap').verb, /^One change/);
});

test('a job with no log at all: created from the job record (labelled), plus an honest note', () => {
  const legacy = { ...J0, version: 4, lifecycle_status: 'In Production', created_by: P.fd };
  const r = A.build([], ctx(legacy));
  const created = r.entries.find((e) => e.kind === 'created');
  assert.strictEqual(created.source, 'record');
  assert.strictEqual(created.actor, 'Fiona FrontDesk');
  assert.strictEqual(created.at, legacy.created_at);
  const note = r.entries.find((e) => e.type === 'gap');
  assert.match(note.verb, /No detailed history was kept/);
  assert.match(note.detail, /changed 3 times/);
  assert.strictEqual(r.entries.length, 2, 'nothing else is made up');
  assert.strictEqual(r.hasLog, false);
  // a brand-new job with no log is just created, with no scary note
  const fresh = A.build([], ctx({ ...J0, version: 1 }));
  assert.deepStrictEqual(fresh.entries.map((e) => e.kind), ['created']);
});

test('a log that has its own creation entry does not add a second one', () => {
  const { evs, job } = lifeStory();
  assert.strictEqual(A.build(evs, ctx(job)).entries.filter((e) => e.kind === 'created').length, 1);
  assert.strictEqual(A.build(evs, ctx(job)).entries[0].source, 'log');
});

test('a log that starts mid-way (no creation record) gets the record-based creation plus a start marker', () => {
  const { evs, job } = lifeStory();
  const r = A.build(evs.slice(3), ctx(job));
  assert.strictEqual(r.entries.filter((e) => e.kind === 'created').length, 1);
  assert.strictEqual(r.entries.find((e) => e.kind === 'created').source, 'record');
  assert.ok(r.entries.some((e) => e.type === 'gap'));
});

test('names that cannot be looked up fall back to plain wording', () => {
  const ev = rowEv('job.assigned', 1, P.mgr, J0, bump(J0, { current_assignee_id: 'unknown-id' }));
  const e = A.build([ev], { job: J0 }).entries.find((x) => x.action === 'job.assigned');
  assert.strictEqual(e.chips[0].to, 'Someone');
  assert.strictEqual(e.chips[0].from, 'Nobody');
});

// ---------------- what is shown
test('newest first by default, with the latest always visible; "show earlier" reveals the rest', () => {
  const { evs, job } = lifeStory();
  const { entries } = A.build(evs, ctx(job));
  const s = A.select(entries, { limit: 8 });
  assert.strictEqual(s.items.length, 8);
  assert.strictEqual(s.items[0].verb, 'marked the job collected', 'the newest entry is first');
  assert.strictEqual(s.hidden, entries.length - 8);
  assert.strictEqual(s.total, entries.length);
  const all = A.select(entries, { limit: 8, expanded: true });
  assert.strictEqual(all.items.length, entries.length);
  assert.strictEqual(all.hidden, 0);
  const oldest = A.select(entries, { limit: 8, order: 'oldest' });
  assert.strictEqual(oldest.items[oldest.items.length - 1].verb, 'marked the job collected', 'oldest-first still keeps the newest in view, at the bottom');
  assert.strictEqual(A.latest(entries).verb, 'marked the job collected');
  assert.match(A.summary(A.latest(entries)), /^Fiona FrontDesk marked the job collected$/);
});

test('filters narrow the timeline and gap markers only appear under "All"', () => {
  const { evs, job } = lifeStory();
  const r = A.build(evs.filter((e) => e.action !== 'job.status_in_production'), ctx(job));
  const cat = (c) => A.select(r.entries, { filter: c, limit: 99 }).items.map((e) => e.category);
  assert.ok(cat('problems').length === 2 && cat('problems').every((c) => c === 'problems'));
  assert.ok(cat('files').every((c) => c === 'files') && cat('files').length === 2);
  assert.ok(cat('people').every((c) => c === 'people'));
  assert.ok(A.select(r.entries, { filter: 'all', limit: 99 }).items.some((e) => e.type === 'gap'));
  assert.ok(!A.select(r.entries, { filter: 'progress', limit: 99 }).items.some((e) => e.type === 'gap'));
});

test('days are grouped in the viewer\'s own time zone', () => {
  const now = '2026-11-16T15:00:00Z';
  const items = [{ at: '2026-11-16T14:00:00Z' }, { at: '2026-11-15T23:30:00Z' }, { at: '2026-11-15T01:00:00Z' }, { at: '2026-11-12T10:00:00Z' }];
  const g = A.groupByDay(items, { now, offsetMinutes: 0, fmtDay: (k) => 'D' + k });
  assert.deepStrictEqual(g.map((x) => x.label), ['Today', 'Yesterday', 'D2026-11-12']);
  assert.deepStrictEqual(g.map((x) => x.items.length), [1, 2, 1]);
  // a viewer 5 hours behind UTC (offset +300): 01:00 UTC on the 15th is still the 14th for them
  const g2 = A.groupByDay(items, { now, offsetMinutes: 300, fmtDay: (k) => 'D' + k });
  assert.deepStrictEqual(g2.map((x) => x.label), ['Today', 'Yesterday', 'D2026-11-14', 'D2026-11-12']);
});

test('which names the screen must look up', () => {
  const { evs, job } = lifeStory();
  const ids = A.idsNeeded(evs, job).sort();
  assert.deepStrictEqual(ids, [P.bin, P.fd, P.nov].sort(), 'owners, raisers, senders and the creator');
  assert.ok(A.idsNeeded([{ actor_id: 'x', actor: null }], null).includes('x'), 'an actor the join could not name');
});

// ---------------- the screen
test('every value is escaped before it reaches the page', () => {
  global.window = { pgActivity: A, pgAvatar: (n) => '<i>' + String(n).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';') + '</i>', pgIcon: () => '', pgUI: { rel: () => 'now' }, matchMedia: () => ({ matches: false }) };
  delete require.cache[require.resolve('../../docs/activity.js')];
  require('../../docs/activity.js');
  const e = { key: 'e1', id: 1, at: t(0), actor: '<img src=x onerror=alert(1)>', kind: 'problem', category: 'problems', verb: 'said <b>hi</b>', chips: [{ label: '<u>L</u>', from: '<s>a</s>', to: '"quoted"' }, { label: 'Status', from: '<x>', to: '<y>', status: true }],
    extra: [{ label: '<l>', value: '<v>' }], quote: '<script>alert(1)</script>', reason: '<em>r</em>', source: 'log' };
  const html = global.window.pgActivity._entryHtml(e, 0, { latestKey: 'e1', recent: false });
  for (const bad of ['<script', '<img src=x', '<b>hi', '<u>L', '<s>a', '<em>', '<x>', '<y>', '<l>', '<v>']) assert.ok(!html.includes(bad), 'unescaped: ' + bad);
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&quot;quoted&quot;'));
  assert.ok(html.includes('Latest') && html.includes('datetime='));
  delete global.window;
});

test('the Activity section is wired in, replaces the old list, and uses only shared colours', () => {
  const app = read('app.js'), html = read('index.html'), css = read('style.css'), src = read('activity.js');
  assert.ok(app.includes('window.pgActivity.card(') && app.includes('window.pgActivity.mount(') && app.includes('window.pgActivity.latestLine()'));
  assert.ok(!app.includes('histHtml'), 'the old one-line-per-record list is gone');
  assert.ok(/from\('audit_events'\)[^\n]*\.limit\(500\)/.test(app), 'reads the existing audit records, newest 500 at most');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('activitylogic.js') > 0 && at('activitylogic.js') < at('activity.js') && at('activity.js') < at('app.js'));
  const block = css.slice(css.indexOf('17. Job activity'));
  assert.ok(block.length > 100 && !/#[0-9a-fA-F]{3,6}\b/.test(block), 'no fixed colours in the timeline styles');
  const tables = [...src.matchAll(/from\('([a-z_]+)'\)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(tables, ['departments', 'employees'], 'activity.js reads only names; the records come from the job page query');
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(src), 'viewing activity never writes anything');
});
