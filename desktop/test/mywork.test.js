'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../docs/myworklogic.js');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

const NOW = Date.parse('2026-11-16T12:00:00Z');
const H = 36e5;
const at = (hoursFromNow) => new Date(NOW + hoursFromNow * H).toISOString();
const D = { nov: 'dept-nov', bin: 'dept-bin', fd: 'dept-fd', mgr: 'dept-mgr' };
const PEOPLE = {
  mgr: { id: 'p-mgr', manager_role: true, front_desk: false },
  fd: { id: 'p-fd', manager_role: false, front_desk: true },
  nov: { id: 'p-nov', manager_role: false, front_desk: false },
  bin: { id: 'p-bin', manager_role: false, front_desk: false },
};
const inDeptOf = (who) => { const m = { mgr: [D.mgr], fd: [D.fd], nov: [D.nov], bin: [D.bin] }[who]; return (id) => !!id && m.includes(id); };
let n = 1000;
function job(over) { n++; return { id: 'j' + n, job_number: n, customer_name: 'Cust ' + n, description: 'd' + n, due_at: at(48), priority: 'Normal', lifecycle_status: 'In Production', current_department_id: D.nov, current_assignee_id: null, created_by: 'p-fd', artwork_required: false, approved_file_id: null, ...over }; }
const base = (who, o) => ({ me: PEOPLE[who], now: NOW, inDept: inDeptOf(who), jobs: [], holds: [], handoffs: [], tasks: [], convs: [], artworkFiles: [], pictures: [], activity: [], ...o });
const ids = (list) => list.map((i) => i.id);
const everyJobId = (r) => [...r.attention, ...r.approvals, ...r.desk, ...r.jobs].filter((i) => i.kind === 'job').map((i) => i.id);

test('production staff: their own jobs, with overdue and problems pulled to the top once', () => {
  const late = job({ current_assignee_id: 'p-nov', due_at: at(-6) });
  const prob = job({ current_assignee_id: 'p-nov' });
  const calm = job({ current_assignee_id: 'p-nov', due_at: at(100) });
  const others = job({ current_assignee_id: 'p-bin', due_at: at(-100) });                 // someone else's, overdue: not theirs
  const r = M.build(base('nov', { jobs: [late, prob, calm, others], holds: [{ id: 'h1', job_id: prob.id, kind: 'Material shortage', note: 'short by 50 sheets' }] }));
  assert.deepStrictEqual(ids(r.attention), [prob.id, late.id], 'a problem outranks an overdue job; both are theirs');
  const l = r.attention.find((i) => i.id === late.id);
  assert.deepStrictEqual(l.reasons.map((x) => x.type), ['overdue'], 'overdue, shown as a reason on the one row');
  const both = M.build(base('nov', { jobs: [{ ...late, priority: 'Rush' }], holds: [{ id: 'h2', job_id: late.id, kind: 'Other', note: 'x' }] })).attention;
  assert.strictEqual(both.length, 1, 'overdue AND a problem: still one row');
  assert.deepStrictEqual(both[0].reasons.map((x) => x.type).sort(), ['overdue', 'problem', 'rush']);
  assert.deepStrictEqual(ids(r.jobs), [calm.id], 'the rest of their jobs');
  assert.strictEqual(r.counts.jobs, 3, 'three jobs are theirs');
  assert.strictEqual(r.counts.mineElsewhere, 2);
  assert.ok(!ids(r.attention).includes(others.id) && !everyJobId(r).includes(others.id), 'another person\'s overdue job is not on this page');
  assert.deepStrictEqual(r.approvals, []); assert.deepStrictEqual(r.desk, []);
  assert.strictEqual(r.roles.approver, false);
});

test('a job is never listed twice, whatever it needs', () => {
  const j = job({ current_assignee_id: 'p-mgr', due_at: at(-5), artwork_required: true, lifecycle_status: 'New' });
  const r = M.build(base('mgr', { jobs: [j], holds: [{ id: 'h', job_id: j.id, kind: 'Other', note: 'n' }], handoffs: [{ id: 'ho', job_id: j.id, to_department_id: D.mgr, note: 'please' }],
    artworkFiles: [{ id: 'f1', job_id: j.id, category: 'Artwork Revision', file_name: 'a.pdf', version_no: 1, uploaded_at: at(-10) }] }));
  assert.deepStrictEqual(everyJobId(r), [j.id], 'one row in one section');
  assert.strictEqual(r.attention.length, 1);
  const types = r.attention[0].reasons.map((x) => x.type);
  for (const t of ['overdue', 'problem', 'handoff', 'artwork']) assert.ok(types.includes(t), t + ' is a chip on that row');
  assert.ok(!types.includes('release'), 'the front desk reason stays in the front desk queue');
  assert.strictEqual(r.approvals.length, 0, 'the approval is a chip, not a second row');
  assert.strictEqual(r.desk.length, 0);
});

test('precedence: attention, then approvals, then the front desk queue, then assigned jobs', () => {
  const a = job({ lifecycle_status: 'New', artwork_required: true, current_assignee_id: 'p-fd' });                    // needs approval (and is New, and is mine)
  const b = job({ lifecycle_status: 'New', current_assignee_id: 'p-fd' });                                           // to release (and mine)
  const c = job({ lifecycle_status: 'Queued', current_assignee_id: 'p-fd' });                                        // just mine
  const files = [{ id: 'f', job_id: a.id, category: 'Artwork Revision', file_name: 'x.pdf', version_no: 2, uploaded_at: at(-1) }];
  const r = M.build(base('fd', { jobs: [a, b, c], artworkFiles: files }));
  assert.deepStrictEqual(ids(r.approvals), [a.id]);
  assert.deepStrictEqual(ids(r.desk), [b.id]);
  assert.deepStrictEqual(ids(r.jobs), [c.id]);
  assert.ok(r.approvals[0].reasons.some((x) => x.type === 'artwork'), 'the approval is why it is there');
  assert.strictEqual(r.counts.jobs, 3);
});

test('departments: problems and handoffs of another department do not appear', () => {
  const novJob = job({ current_department_id: D.nov, current_assignee_id: null });
  const holds = [{ id: 'h', job_id: novJob.id, kind: 'Other', note: 'n' }];
  const handoffs = [{ id: 'ho', job_id: novJob.id, to_department_id: D.nov, note: 'go' }];
  const forNov = M.build(base('nov', { jobs: [novJob], holds, handoffs }));
  assert.strictEqual(forNov.attention.length, 1);
  assert.deepStrictEqual(forNov.attention[0].reasons.map((x) => x.type).sort(), ['handoff', 'problem']);
  const forBin = M.build(base('bin', { jobs: [novJob], holds, handoffs }));       // (the database would not even return this job to them)
  assert.deepStrictEqual(forBin.attention, [], 'not their department, not their job: nothing');
  const forMgr = M.build(base('mgr', { jobs: [novJob], holds, handoffs }));
  assert.strictEqual(forMgr.attention.length, 1, 'a manager answers for every department');
});

test('overdue work: managers see all of it, everyone else only their own; ready jobs are never overdue', () => {
  const mineLate = job({ current_assignee_id: 'p-fd', due_at: at(-3) });
  const otherLate = job({ current_assignee_id: 'p-nov', due_at: at(-60) });
  const ready = job({ lifecycle_status: 'Ready for Collection', due_at: at(-60) });
  assert.deepStrictEqual(ids(M.build(base('mgr', { jobs: [mineLate, otherLate, ready] })).attention).sort(), [mineLate.id, otherLate.id].sort());
  assert.deepStrictEqual(ids(M.build(base('fd', { jobs: [mineLate, otherLate, ready] })).attention), [mineLate.id]);
  assert.ok(!M.isLate(ready, NOW));
  assert.strictEqual(M.lateText(at(-3), NOW), '3h overdue');
  assert.strictEqual(M.lateText(at(-72), NOW), '3d overdue');
  assert.strictEqual(M.lateText(at(-0.1), NOW), '1h overdue');
});

test('due today is a nudge for your own jobs only', () => {
  const t0 = new Date(NOW); const today = new Date(NOW); today.setHours(t0.getHours() + 2 > 23 ? 23 : t0.getHours() + 2, 59, 0, 0);
  const mine = job({ current_assignee_id: 'p-nov', due_at: today.toISOString() });
  const theirs = job({ current_assignee_id: 'p-bin', due_at: today.toISOString() });
  if (today.getTime() < NOW) return;                       // (guard: never fails near midnight)
  const r = M.build(base('nov', { jobs: [mine, theirs] }));
  assert.deepStrictEqual(ids(r.attention), [mine.id]);
  assert.strictEqual(r.attention[0].reasons[0].type, 'today');
});

test('urgency order: problem, handoff, overdue; rush breaks ties; then the earlier deadline', () => {
  const prob = job({ current_assignee_id: 'p-mgr', due_at: at(20) });
  const hand = job({ current_assignee_id: null, due_at: at(20) });
  const late = job({ current_assignee_id: 'p-mgr', due_at: at(-5) });
  const lateRush = job({ current_assignee_id: 'p-mgr', due_at: at(-5), priority: 'Rush' });
  const lateOld = job({ current_assignee_id: 'p-mgr', due_at: at(-200) });
  const r = M.build(base('mgr', { jobs: [late, lateRush, lateOld, hand, prob],
    holds: [{ id: 'h', job_id: prob.id, kind: 'k', note: 'n' }], handoffs: [{ id: 'ho', job_id: hand.id, to_department_id: D.mgr, note: '' }] }));
  const order = ids(r.attention);
  const before = (a, b, why) => assert.ok(order.indexOf(a.id) < order.indexOf(b.id), why);
  before(prob, hand, 'a problem outranks a handoff waiting');
  before(hand, late, 'a handoff waiting outranks a job that is only a few hours overdue');
  before(lateRush, late, 'rush before the same lateness without rush');
  before(lateOld, late, 'much later is more urgent');
});

test('approvals: only people who can approve; artwork and chat pictures; never your own', () => {
  const j = job({ artwork_required: true, lifecycle_status: 'Queued' });
  const files = [{ id: 'f1', job_id: j.id, category: 'Artwork Revision', file_name: 'logo.pdf', version_no: 1, uploaded_at: at(-9) }, { id: 'f2', job_id: j.id, category: 'Supporting Document', file_name: 'notes.docx', version_no: 1, uploaded_at: at(-1) }];
  const pics = [{ id: 'm1', author_id: 'p-nov', sent_at: at(-5), href: '#/chat/c/m1' }, { id: 'm2', author_id: 'p-fd', sent_at: at(-8), href: '#/chat/c/m2' }, { id: 'm3', author_id: 'p-bin', sent_at: at(-20), href: '#/chat/c/m3' }];
  const fd = M.build(base('fd', { jobs: [j], artworkFiles: files, pictures: pics }));
  assert.deepStrictEqual(ids(fd.approvals), [j.id, 'm3', 'm1'], 'artwork first, then pictures oldest first; their own picture (m2) is left out');
  assert.match(fd.approvals[0].reasons[0].text, /logo\.pdf \(v1\)/, 'a supporting document is not artwork');
  const prod = M.build(base('nov', { jobs: [j], artworkFiles: files, pictures: pics }));
  assert.deepStrictEqual(prod.approvals, [], 'production staff cannot approve');
  // already approved: nothing to do, until newer artwork arrives
  const approved = { ...j, approved_file_id: 'f1' };
  assert.deepStrictEqual(M.build(base('mgr', { jobs: [approved], artworkFiles: files })).approvals, []);
  const newer = [...files, { id: 'f3', job_id: j.id, category: 'Artwork Revision', file_name: 'logo.pdf', version_no: 2, uploaded_at: at(-2) }];
  const again = M.build(base('mgr', { jobs: [approved], artworkFiles: newer }));
  assert.match(again.approvals[0].reasons[0].text, /New artwork since approval: logo\.pdf \(v2\)/);
  // no artwork uploaded yet: a different problem, not an approval
  assert.deepStrictEqual(M.build(base('mgr', { jobs: [j], artworkFiles: [] })).approvals, []);
  // artwork not required
  assert.deepStrictEqual(M.build(base('mgr', { jobs: [{ ...j, artwork_required: false }], artworkFiles: files })).approvals, []);
});

test('front desk queue: new jobs to release, finished jobs to collect, for desk roles only', () => {
  const newJob = job({ lifecycle_status: 'New', due_at: at(30) });
  const readyJob = job({ lifecycle_status: 'Ready for Collection', due_at: at(10) });
  const prod = job({ lifecycle_status: 'In Production' });
  for (const who of ['fd', 'mgr']) {
    const r = M.build(base(who, { jobs: [newJob, readyJob, prod] }));
    assert.deepStrictEqual(r.desk.map((i) => i.group).sort(), ['collect', 'release'], who);
    assert.deepStrictEqual(ids(r.jobs), [], 'not assigned to them, so not in assigned jobs');
  }
  assert.deepStrictEqual(M.build(base('nov', { jobs: [newJob, readyJob], })).desk, [], 'production staff have no desk queue');
});

test('tasks: your open tasks only; overdue ones need attention (once); the rest are listed by due date', () => {
  const tasks = [
    { id: 't1', title: 'A', assigned_to: 'p-nov', due_at: at(-4), job_id: null },
    { id: 't2', title: 'B', assigned_to: 'p-nov', due_at: at(30), job_id: 'jx' },
    { id: 't3', title: 'C', assigned_to: 'p-nov', due_at: null },
    { id: 't4', title: 'D', assigned_to: 'p-nov', due_at: at(5) },
    { id: 't5', title: 'someone else', assigned_to: 'p-bin', due_at: at(-9) },
    { id: 't6', title: 'done', assigned_to: 'p-nov', done_at: at(-1), due_at: at(-9) },
  ];
  const r = M.build(base('nov', { tasks }));
  assert.deepStrictEqual(ids(r.attention), ['t1']);
  assert.strictEqual(r.attention[0].kind, 'task');
  assert.strictEqual(r.attention[0].href, '#/tasks');
  assert.deepStrictEqual(ids(r.tasks), ['t4', 't2', 't3'], 'soonest first, no date last');
  assert.strictEqual(r.tasks[1].href, '#/job/jx', 'a task tied to a job opens the job');
  assert.strictEqual(r.counts.tasks, 4);
});

test('unread messages: only conversations with unread, newest first, with a total', () => {
  const convs = [{ id: 'c1', unread: 2, last_at: at(-5) }, { id: 'c2', unread: 0, last_at: at(-1) }, { id: 'c3', unread: '3', last_at: at(-1) }, null];
  const r = M.build(base('nov', { convs: convs.map((c) => c && { ...c, href: '#/chat/' + c.id }) }));
  assert.deepStrictEqual(ids(r.messages), ['c3', 'c1']);
  assert.strictEqual(r.counts.unread, 5);
  assert.strictEqual(r.counts.unreadChats, 2);
  assert.strictEqual(r.messages[0].href, '#/chat/c3');
});

test('recent activity: last 7 days, newest first, no repeats, capped', () => {
  const act = (k, hrs) => ({ key: k, jobId: 'j', at: at(hrs), actor: 'X', verb: 'v' });
  const list = [act('a', -2), act('b', -200), act('a', -2), act('c', -50), act('d', -1), ...Array.from({ length: 20 }, (_, i) => act('z' + i, -3 - i))];
  const r = M.build(base('nov', { activity: list }));
  assert.ok(!ids(r.activity).includes('b'), 'older than a week is dropped');
  assert.strictEqual(r.activity.filter((a) => a.key === 'a').length, 1);
  assert.strictEqual(r.activity[0].key, 'd');
  assert.strictEqual(r.activity.length, M.LIMITS.activityMax);
  assert.deepStrictEqual(r.activity.map((a) => a.at), r.activity.map((a) => a.at).slice().sort().reverse());
});

test('closed jobs are ignored, and an empty page is "all caught up"', () => {
  const done = job({ lifecycle_status: 'Collected', current_assignee_id: 'p-nov', due_at: at(-100) });
  const r = M.build(base('nov', { jobs: [done], holds: [{ id: 'h', job_id: done.id, kind: 'k', note: 'n' }] }));
  assert.deepStrictEqual(everyJobId(r), []);
  assert.ok(r.allClear);
  assert.strictEqual(r.counts.jobs, 0);
  assert.ok(!M.build(base('nov', { jobs: [job({ current_assignee_id: 'p-nov' })] })).allClear);
  assert.ok(!M.build(base('nov', { convs: [{ id: 'c', unread: 1, href: 'h' }] })).allClear, 'unread messages mean not all caught up');
});

test('the summary sentence and "show more"', () => {
  const r = M.build(base('fd', { jobs: [job({ current_assignee_id: 'p-fd', due_at: at(-9) }), job({ current_assignee_id: 'p-fd' })], tasks: [{ id: 't', title: 'x', assigned_to: 'p-fd', due_at: at(9) }], convs: [{ id: 'c', unread: 3, href: 'h' }] }));
  assert.strictEqual(M.summary(r), '1 needs attention · 2 jobs · 1 task · 3 unread messages');
  assert.strictEqual(M.summary(M.build(base('nov', {}))), '0 jobs · 0 tasks');
  assert.deepStrictEqual(M.take([1, 2, 3, 4], 2, false), { items: [1, 2], more: 2 });
  assert.deepStrictEqual(M.take([1, 2, 3, 4], 2, true), { items: [1, 2, 3, 4], more: 0 });
  assert.deepStrictEqual(M.take([1], 5, false), { items: [1], more: 0 });
});

test('bad or partial input never breaks the page', () => {
  assert.doesNotThrow(() => M.build({ me: PEOPLE.nov }));
  assert.doesNotThrow(() => M.build(base('mgr', { jobs: [null, undefined], holds: [{ job_id: 'zz' }], handoffs: [{ job_id: 'zz' }], tasks: [null], convs: [null], pictures: [null], activity: [null] })));
});

// ---------------- wiring
test('My work is in the sidebar and routed, Home stays the default, and nothing is written except marking a task done', () => {
  const app = read('app.js'), html = read('index.html'), src = read('mywork.js'), css = read('style.css');
  assert.ok(app.includes("nav('#/my-work', 'mywork', 'My work', 'inbox')"));
  assert.ok(app.indexOf("nav('#/home'") < app.indexOf("nav('#/my-work'") && app.indexOf("nav('#/my-work'") < app.indexOf("nav('#/jobs'"), 'listed right after Home');
  assert.ok(app.includes("if (h === '#/my-work') return window.viewMyWork();"));
  assert.ok(app.includes("const h = location.hash || '#/home';") && app.includes('return viewJobs();'), 'unchanged: Home is still the landing page');
  const at2 = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at2('activity.js') < at2('myworklogic.js') && at2('myworklogic.js') < at2('mywork.js') && at2('mywork.js') < at2('app.js'));
  const tables = [...new Set([...src.matchAll(/from\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(tables, ['audit_events', 'job_files', 'job_handoffs', 'job_holds', 'jobs', 'messages', 'tasks'], 'only existing tables, read with the person\'s own login');
  assert.deepStrictEqual([...src.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]), ['my_conversations']);
  assert.deepStrictEqual([...src.matchAll(/call\('([a-z_]+)'/g)].map((m) => m[1]), ['set_task_done']);
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src));
  const block = css.slice(css.indexOf('18. My work'));
  assert.ok(block.length > 200 && !/#[0-9a-fA-F]{3,6}\b/.test(block), 'only shared colours');
  assert.ok(/\.mw\{display:grid;grid-template-columns:minmax\(0,1\.5fr\) minmax\(0,1fr\)/.test(block) && /@media\(max-width:1100px\)\{\.mw\{grid-template-columns:1fr\}\}/.test(block), 'two columns on a wide screen, one on a phone');
});

test('every item type links straight to its job, task list, chat or message', () => {
  const src = read('mywork.js'), logic = read('myworklogic.js');
  assert.ok(src.includes("href: window.pgChat.chatHref(m.conversation_id, m.id)"), 'a picture opens its exact message (Stage 2 link)');
  assert.ok(src.includes("window.pgChat.chatHref(c.id)"), 'a conversation opens the chat');
  assert.ok(logic.includes("href: '#/job/' + j.id") && logic.includes("t.job_id ? '#/job/' + t.job_id : '#/tasks'"), 'jobs open the job, tasks open their job or the task list');
  assert.ok(src.includes("href: '#/job/' + e.jobId"), 'activity opens the job');
});

test('every value is escaped before it reaches the page', () => {
  const src = read('mywork.js');
  const exprs = [...src.matchAll(/${([^}]*)}/g)].map((m) => m[1].trim());
  const rawRef = /^(j|t|p|c|a|it|r|e|g).[w.]+$/;
  const allowed = new Set(['it.unread', 'it.section', 'c.jobs', 'c.unread', 'it.reasons.length', 's.id', 's.list.length', 's.limit']);
  const bad = exprs.filter((e) => rawRef.test(e) && !allowed.has(e));
  assert.deepStrictEqual(bad, [], 'a data value is placed on the page without esc()');
  assert.ok(src.includes('esc(t.title)') && src.includes('esc(j.customer_name)') && src.includes('esc(p.author)') && src.includes('esc(a.actor)'), 'the user-written text is escaped');
});
