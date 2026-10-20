'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const paste = require('../../docs/pastefile.js');

const ROOT = path.join(__dirname, '..', '..');
const img = (type = 'image/png', bytes = 1000, name = 'image.png') => new File([new Uint8Array(bytes)], name, { type });
// a File that claims to be huge without allocating that much memory
const bigFile = (type, size) => Object.defineProperty(new File([new Uint8Array(1)], 'big.png', { type }), 'size', { value: size });

// a fake form that records its listeners, and fake paste events
function rig(opts = {}) {
  const listeners = [];
  const el = { addEventListener: (t, f) => listeners.push([t, f]), removeEventListener: (t, f) => { const i = listeners.findIndex((l) => l[0] === t && l[1] === f); if (i >= 0) listeners.splice(i, 1); } };
  let t = 1_000_000;
  const staged = [], rejected = [];
  let busy = false;
  const off = paste.wire(el, { onFile: (f) => staged.push(f), onReject: (m) => rejected.push(m), isBusy: () => busy, now: () => t, ...opts });
  const fire = (clipboardData) => {
    const ev = { clipboardData, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.filter((l) => l[0] === 'paste').forEach((l) => l[1](ev));
    return ev;
  };
  return { el, listeners, staged, rejected, fire, off, advance: (ms) => { t += ms; }, setBusy: (v) => { busy = v; } };
}
const clip = (files = [], items = []) => ({ files, items });

test('imageFromClipboard: finds a picture among files, ignores everything else', () => {
  const p = img();
  assert.equal(paste.imageFromClipboard(clip([p])), p);
  assert.equal(paste.imageFromClipboard(clip([new File(['x'], 'a.txt', { type: 'text/plain' }), p])), p);
  assert.equal(paste.imageFromClipboard(clip([new File(['x'], 'a.pdf', { type: 'application/pdf' })])), null);
  assert.equal(paste.imageFromClipboard(clip([])), null);
  assert.equal(paste.imageFromClipboard(null), null);
  assert.equal(paste.imageFromClipboard(undefined), null);
  assert.equal(paste.imageFromClipboard({}), null);
});

test('imageFromClipboard: falls back to clipboard items (a copied screenshot)', () => {
  const p = img('image/jpeg');
  assert.equal(paste.imageFromClipboard(clip([], [{ kind: 'file', type: 'image/jpeg', getAsFile: () => p }])), p);
  assert.equal(paste.imageFromClipboard(clip([], [{ kind: 'string', type: 'text/plain', getAsFile: () => null }])), null);
  assert.equal(paste.imageFromClipboard(clip([], [{ kind: 'file', type: 'application/zip', getAsFile: () => img('application/zip') }])), null);
  assert.equal(paste.imageFromClipboard(clip([], [{ kind: 'file', type: 'image/png', getAsFile: () => null }])), null);
});

test('pasteName: readable, unique per second, extension comes from the type', () => {
  const d = new Date(2026, 9, 20, 14, 5, 9);
  assert.equal(paste.pasteName('image/png', d), 'pasted-image-20261020-140509.png');
  assert.equal(paste.pasteName('image/jpeg', d), 'pasted-image-20261020-140509.jpg');
  assert.equal(paste.pasteName('image/webp', d), 'pasted-image-20261020-140509.webp');
  assert.equal(paste.pasteName('text/html', d), 'pasted-image-20261020-140509.png', 'never an unexpected extension');
});

test('no pasted name can end in an extension the server blocks', () => {
  const blocked = ['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'vbs', 'js', 'jar', 'ps1', 'sh', 'dll'];   // the list in register_file()
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0003_files_holds_handoffs.sql'), 'utf8');
  for (const e of blocked) assert.ok(sql.includes(`'${e}'`), `register_file still blocks .${e}`);
  for (const ext of Object.values(paste.IMAGE_TYPES)) assert.ok(!blocked.includes(ext), ext);
});

test('check: type and size rules', () => {
  assert.equal(paste.check(img('image/png', 1)).ok, true);
  assert.equal(paste.check(img('image/jpeg', 5_000_000)).ok, true);
  assert.equal(paste.check(bigFile('image/png', paste.MAX_BYTES)).ok, true, 'exactly 100 MB is allowed, like every other file');
  assert.equal(paste.check(bigFile('image/png', paste.MAX_BYTES + 1)).ok, false);
  assert.match(paste.check(bigFile('image/png', paste.MAX_BYTES + 1)).error, /100 MB/);
  assert.equal(paste.check(img('image/png', 0)).ok, false, 'empty');
  assert.equal(paste.check(img('image/svg+xml', 100)).ok, false, 'svg can carry script');
  assert.equal(paste.check(img('image/tiff', 100)).ok, false);
  assert.equal(paste.check(img('application/x-msdownload', 100)).ok, false);
  assert.equal(paste.check(img('', 100)).ok, false);
  assert.equal(paste.check(null).ok, false);
});

test('the size limit matches the one the server enforces', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0003_files_holds_handoffs.sql'), 'utf8');
  assert.ok(sql.includes(String(paste.MAX_BYTES)), 'register_file / the bucket use the same 100 MB figure');
});

test('guard: the same picture twice in a moment is accepted once; later or different is fine', () => {
  const g = paste.makeGuard(1500);
  const a = img('image/png', 1234);
  assert.equal(g.accept(a, 1000), true);
  assert.equal(g.accept(a, 1001), false, 'repeated event');
  assert.equal(g.accept(img('image/png', 1234), 2000), false, 'still inside the window');
  assert.equal(g.accept(img('image/png', 1234), 2600), true, 'a deliberate second paste later');
  assert.equal(g.accept(img('image/png', 999), 2601), true, 'a different picture');
  assert.equal(g.accept(img('image/jpeg', 999), 2602), true, 'different type');
});

test('wire: a pasted picture becomes ONE named file for the normal upload box', () => {
  const r = rig();
  const ev = r.fire(clip([img('image/png', 4242, 'image.png')]));
  assert.equal(ev.defaultPrevented, true);
  assert.equal(r.staged.length, 1);
  assert.equal(r.staged[0].type, 'image/png');
  assert.equal(r.staged[0].size, 4242);
  assert.match(r.staged[0].name, /^pasted-image-\d{8}-\d{6}\.png$/);
  assert.deepEqual(r.rejected, []);
});

test('wire: pasting text (or anything that is not a picture) is left completely alone', () => {
  const r = rig();
  const ev = r.fire(clip([], [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]));
  assert.equal(ev.defaultPrevented, false);
  const ev2 = r.fire(clip([new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })]));
  assert.equal(ev2.defaultPrevented, false);
  assert.equal(r.staged.length, 0);
  assert.equal(r.rejected.length, 0);
});

test('wire: repeated paste events never stage the same picture twice', () => {
  const r = rig();
  const p = img('image/png', 777);
  r.fire(clip([p])); r.fire(clip([p])); r.advance(10); r.fire(clip([img('image/png', 777)]));
  assert.equal(r.staged.length, 1);
  r.advance(5000);
  r.fire(clip([img('image/png', 777)]));
  assert.equal(r.staged.length, 2, 'a deliberate paste a few seconds later replaces the file in the box (the box holds one file)');
});

test('wire: nothing is staged while an upload is running', () => {
  const r = rig();
  r.setBusy(true);
  const ev = r.fire(clip([img('image/png', 500)]));
  assert.equal(ev.defaultPrevented, true, 'the paste is swallowed, not inserted anywhere else');
  assert.equal(r.staged.length, 0);
  r.setBusy(false); r.advance(5000);
  r.fire(clip([img('image/png', 500)]));
  assert.equal(r.staged.length, 1);
});

test('wire: too big or unsupported pictures are refused with a message, never staged', () => {
  const r = rig();
  r.fire(clip([bigFile('image/png', paste.MAX_BYTES + 5)]));
  assert.equal(r.staged.length, 0);
  assert.match(r.rejected[0], /100 MB/);
  r.advance(5000);
  r.fire(clip([img('image/svg+xml', 100, 'x.svg')]));
  assert.equal(r.staged.length, 0);
  assert.equal(r.rejected.length, 2);
});

test('wire: the returned function removes the listener', () => {
  const r = rig();
  assert.equal(r.listeners.length, 1);
  r.off();
  assert.equal(r.listeners.length, 0);
});

test('app.js wires the paste box into the existing upload form without replacing its parts', () => {
  const app = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');
  assert.ok(app.includes('<input type="file" name="file" required>'), 'the normal file picker is still there');
  assert.ok(app.includes('<select name="cat">'), 'the file type choice is still there');
  assert.ok(/id="ub" type="submit">Upload</.test(app), 'the Upload button is still there');
  assert.ok(app.includes("sb.storage.from('job-files').upload("), 'still uploads to the private bucket');
  assert.ok(app.includes("call('register_file'"), 'still registered through register_file');
  assert.ok(app.includes('window.pgPaste.wire(upf'), 'the paste handler is attached to the upload form');
  assert.ok(app.includes('if (uploading) return;'), 'a second submit while uploading is ignored');
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="pastefile.js"></script>'));
});
