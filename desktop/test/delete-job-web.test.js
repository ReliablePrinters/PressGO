'use strict';
// The real rules for deleting a job are enforced (and tested) in the database: supabase/tests/0017_delete_job_test.sql.
// These checks only make sure the screen asks for the right things and shows the button under the same conditions.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const app = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');
const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0017_delete_job.sql'), 'utf8');

test('the Delete job button is shown to a manager, or to the creator while the job has not started', () => {
  const m = app.match(/const canDelete = (.*);/);
  assert.ok(m, 'canDelete rule found');
  assert.ok(m[1].includes('!!mgr'), 'managers');
  assert.ok(m[1].includes('j.created_by === me.id'), 'the creator');
  const screen = [...m[1].matchAll(/'([A-Za-z ]+)'/g)].map((x) => x[1]).sort();
  const server = (sql.match(/not in \('New', 'Queued', 'Cancelled'\)/) ? ['Cancelled', 'New', 'Queued'] : []);
  assert.deepEqual(screen, server, 'the statuses on screen are the statuses the database allows the creator to delete');
  assert.ok(app.includes('<button id="deljob" class="danger">Delete job…</button>'), 'clearly labelled');
});

test('the confirmation names the job, asks for a reason and for the job number', () => {
  const i = app.indexOf("if (b.id === 'deljob')");
  assert.ok(i > 0);
  const block = app.slice(i, app.indexOf("if (b.id === 'reopen')"));
  assert.ok(block.includes("ask('Delete this job?'"));
  assert.ok(block.includes('#${j.job_number} · ${esc(j.customer_name)}'), 'identifies the job being deleted');
  assert.ok(block.includes('name="reason"') && block.includes('required'), 'a reason is required');
  assert.ok(block.includes('name="confirm"') && block.includes('pattern="${j.job_number}"'), 'the job number must be typed');
  assert.ok(block.includes("String(r.confirm || '').trim() !== String(j.job_number)"), 'checked again in code');
  assert.ok(block.includes("call('delete_job', { p_job: id, p_version: j.version, p_reason: r.reason })"), 'goes through the checked database function');
  assert.ok(!/\.delete\(\)|from\('jobs'\)\.delete/.test(app), 'the app never deletes table rows directly');
});

test('the dialog is drawn as a danger dialog', () => {
  assert.ok(/danger = \/\^\(cancel this job\|delete this job\|/.test(app));
});

test('migration 0017: the rules the screen relies on are in the database function', () => {
  assert.ok(sql.includes('is_manager() or o.created_by = me'), 'creator or manager');
  assert.ok(sql.includes('a reason is required to delete a job'));
  assert.ok(sql.includes('security definer'), 'runs with checks inside the function, table writes stay closed');
  assert.ok(/revoke execute on function pressgo\.delete_job\(uuid, integer, text\) from public, anon/.test(sql));
  assert.ok(!/delete from pressgo\.jobs|delete from jobs/.test(sql.replace(/--.*$/gm, '')), 'nothing is ever erased');
});
