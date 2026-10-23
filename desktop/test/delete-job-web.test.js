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
  assert.ok(block.includes("call('delete_job', { p_job: id, p_version: j.version, p_reason: why.value })"), 'goes through the checked database function, with the TRIMMED reason');
  assert.ok(!block.includes('p_reason: r.reason'), 'the raw, untrimmed text is never sent');
  assert.ok(block.includes('window.pgReason.guard(dlg.querySelector(\'[name=reason]\'))'), 'the reason box is guarded so the dialog stays open on a blank reason');
  assert.ok(block.indexOf('window.pgReason.check(r.reason)') < block.indexOf("call('delete_job'"), 'the reason is checked again in code before anything is sent');
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

// ---- the reason rule (docs/reason.js): regression tests for "a reason made only of spaces"
const reason = require('../../docs/reason.js');

test('reason: empty, spaces-only and invisible-only reasons are refused with "Please give a real reason"', () => {
  const blanks = ['', ' ', '     ', '\t', '\n', ' \r\n ', '\u00a0', '\u00a0 \u00a0', '\u200b', '\ufeff', ' \u200b\u200c\u200d\u2060 ', '\u2003\u2009', null, undefined];
  for (const b of blanks) {
    const r = reason.check(b);
    assert.equal(r.ok, false, JSON.stringify(b));
    assert.equal(r.message, 'Please give a real reason');
    assert.equal(r.value, '');
  }
  assert.equal(reason.MESSAGE, 'Please give a real reason');
});

test('reason: a normal reason is accepted and the TRIMMED text is what is returned', () => {
  assert.deepEqual(reason.check('Entered twice by mistake'), { ok: true, value: 'Entered twice by mistake', message: '' });
  assert.equal(reason.check('   Entered twice   ').value, 'Entered twice', 'spaces around it are removed');
  assert.equal(reason.check('\n\tDuplicate order\u00a0').value, 'Duplicate order', 'tabs, line breaks and non-breaking spaces too');
  assert.equal(reason.check('two  words\nand a second line').value, 'two  words\nand a second line', 'inside the text is left alone');
  assert.equal(reason.check('x').ok, true, 'a single character is still a reason');
  assert.equal(reason.check(12345).value, '12345', 'not a string: still handled');
});

test('reason: length limit matches the database (500), counted after trimming', () => {
  assert.equal(reason.MAX, 500);
  assert.ok(/length\(v_reason\) > 500/.test(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0017_delete_job.sql'), 'utf8')), 'delete_job() uses the same limit');
  assert.equal(reason.check('a'.repeat(500)).ok, true);
  assert.equal(reason.check('  ' + 'a'.repeat(500) + '  ').ok, true, 'spaces around do not count');
  const long = reason.check('a'.repeat(501));
  assert.equal(long.ok, false);
  assert.match(long.message, /too long/);
});

test('reason: guard() makes the text box refuse a blank reason, live, and accept a real one', () => {
  const listeners = {};
  let validity = null, value = '';
  const box = { get value() { return value; }, setCustomValidity: (m) => { validity = m; }, addEventListener: (t, f) => { listeners[t] = f; } };
  reason.guard(box);
  assert.equal(validity, 'Please give a real reason', 'an empty box is refused straight away');
  value = '   '; listeners.input();
  assert.equal(validity, 'Please give a real reason', 'only spaces: still refused');
  value = '  duplicate  '; listeners.input();
  assert.equal(validity, '', 'a real reason clears the message (the browser then allows the form to submit)');
  value = ' \n '; listeners.input();
  assert.equal(validity, 'Please give a real reason', 'deleting the text again refuses it again');
});

test('the screen loads reason.js before app.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="reason.js"></script>'));
  assert.ok(html.indexOf('reason.js') < html.indexOf('app.js'));
});
