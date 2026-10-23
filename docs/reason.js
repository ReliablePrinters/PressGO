'use strict';
// PressGO: checking the "reason" a person types before a risky action (for now: deleting a job).
// A reason that is empty, or made only of spaces, tabs, line breaks or invisible characters, is not a reason.
// The database refuses a blank reason too (migration 0017); this gives the person a clear message first, and makes sure
// the text that is sent is the trimmed text. Pure function, exported so it can be tested without a browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgReason = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MESSAGE = 'Please give a real reason';
  const MAX = 500;   // the same limit as delete_job()

  // Characters that look like nothing, listed by code number so this file contains no invisible characters:
  // 160 no-break space, 8203-8205 zero-width space / non-joiner / joiner, 8288 word joiner, 65279 byte-order mark.
  const INVISIBLE = [160, 8203, 8204, 8205, 8288, 65279].map((c) => String.fromCharCode(c)).join('');
  const ONLY_NOTHING = new RegExp('^[\\s' + INVISIBLE + ']*$');
  const EDGES = new RegExp('^[\\s' + INVISIBLE + ']+|[\\s' + INVISIBLE + ']+$', 'g');

  // -> { ok, value, message }. `value` is the text with spaces and invisible characters trimmed from both ends; send it only
  // when `ok` is true. A reason longer than the limit is REJECTED (ok is false, `message` says it is too long): it is never
  // cut short, so nothing the person typed is silently dropped.
  function check(raw) {
    const text = raw == null ? '' : String(raw);
    if (ONLY_NOTHING.test(text)) return { ok: false, value: '', message: MESSAGE };
    const value = text.replace(EDGES, '');
    if (value.length > MAX) return { ok: false, value, message: 'That reason is too long (' + MAX + ' characters at most)' };
    return { ok: true, value, message: '' };
  }

  // Make a text box refuse to submit while its reason is not real, using the browser's own validation message
  // (so the dialog simply stays open and the message appears next to the box).
  function guard(box) {
    const run = () => box.setCustomValidity(check(box.value).message);
    box.addEventListener('input', run);
    run();
    return run;
  }

  return { MESSAGE, MAX, check, guard };
});
