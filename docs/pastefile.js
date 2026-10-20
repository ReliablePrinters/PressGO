'use strict';
// PressGO: paste a copied image (Ctrl+V) into the job file upload form.
// This only PREPARES a file. The pasted image goes into the normal file box and then through the normal Upload button, the
// private storage bucket and register_file(), so every existing rule (who can see the job, 100 MB, blocked program files,
// versions, history) still applies. Pure functions are exported so they can be tested without a browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgPaste = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_BYTES = 100 * 1024 * 1024;   // the same limit as every other job file (register_file and the bucket)
  // Pictures only, and only kinds that are safe to show: no SVG (it can carry script). The file extension comes from this
  // table, never from the clipboard, so a pasted file can never get a blocked extension such as .exe.
  const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/avif': 'avif' };
  const DUPLICATE_WINDOW_MS = 1500;

  // the first picture on the clipboard, or null (text, files that are not pictures, nothing at all)
  function imageFromClipboard(cd) {
    if (!cd) return null;
    const pick = (list) => [...(list || [])].find((f) => f && typeof f.type === 'string' && f.type.startsWith('image/')) || null;
    const direct = pick(cd.files);
    if (direct) return direct;
    for (const it of [...(cd.items || [])]) {
      if (it && it.kind === 'file' && typeof it.type === 'string' && it.type.startsWith('image/')) {
        const f = it.getAsFile && it.getAsFile();
        if (f) return f;
      }
    }
    return null;
  }

  const pad = (n) => String(n).padStart(2, '0');
  function pasteName(mime, when) {
    const d = when instanceof Date ? when : new Date(when);
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `pasted-image-${stamp}.${IMAGE_TYPES[mime] || 'png'}`;
  }

  function check(file) {
    if (!file || typeof file.size !== 'number') return { ok: false, error: 'There is no picture to paste.' };
    if (!Object.prototype.hasOwnProperty.call(IMAGE_TYPES, file.type)) return { ok: false, error: 'That kind of picture cannot be pasted here. Save it as a file and use Choose file instead.' };
    if (file.size <= 0) return { ok: false, error: 'The pasted picture is empty.' };
    if (file.size > MAX_BYTES) return { ok: false, error: 'That picture is over 100 MB.' };
    return { ok: true, error: '' };
  }

  // One paste can reach the page more than once (a double key press, a repeated event). The same picture arriving again
  // within a moment is ignored, so it can never be staged (and so uploaded) twice.
  function makeGuard(windowMs = DUPLICATE_WINDOW_MS) {
    let last = null;
    return {
      accept(file, now) {
        const key = `${file.type}:${file.size}`;
        if (last && last.key === key && now - last.at < windowMs) return false;
        last = { key, at: now };
        return true;
      }
    };
  }

  // Listen for pastes on `el` (the upload form: it only hears a paste while something inside it has focus).
  // Anything that is not a picture is left alone, so pasting ordinary text still works wherever it did before.
  function wire(el, o) {
    const now = o.now || Date.now, guard = makeGuard(o.windowMs);
    const handler = (e) => {
      const raw = imageFromClipboard(e.clipboardData);
      if (!raw) return;
      e.preventDefault();
      if (o.isBusy && o.isBusy()) return;                 // an upload is already running
      if (!guard.accept(raw, now())) return;              // the same paste again
      const v = check(raw);
      if (!v.ok) { if (o.onReject) o.onReject(v.error); return; }
      const named = new File([raw], pasteName(raw.type, new Date(now())), { type: raw.type, lastModified: now() });
      o.onFile(named);
    };
    el.addEventListener('paste', handler);
    return () => el.removeEventListener('paste', handler);
  }

  return { MAX_BYTES, IMAGE_TYPES, DUPLICATE_WINDOW_MS, imageFromClipboard, pasteName, check, makeGuard, wire };
});
