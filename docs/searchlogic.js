'use strict';
// PressGO global search: the small rules behind it (what counts as a query, how a match is highlighted, how the arrow keys move,
// when Ctrl+K is allowed to open it). Pure functions only (no screen, no network) so desktop/test/search.test.js can check every rule.
// What a person is ALLOWED to find is decided by the database, not here: every search goes through the signed-in person's own login,
// so jobs, conversations and messages they cannot open never come back at all.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgSearchLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_CHARS = 2;          // one letter matches half the shop
  const MAX_TOKENS = 4;         // "harbour menu cards" is three words; more than four adds nothing
  const LIMITS = { jobs: 8, people: 6, convs: 6, messages: 12 };

  const normalize = (q) => String(q == null ? '' : q).replace(/\s+/g, ' ').trim().slice(0, 80);
  const words = (q) => normalize(q).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, MAX_TOKENS);
  const ready = (q) => normalize(q).length >= MIN_CHARS && words(q).length > 0;

  // "1002", "#1002", "job 1002", "Job #1002" are all a job number
  function jobNumberOf(q) {
    const m = /^(?:job\s*)?#?\s*(\d{1,12})$/i.exec(normalize(q));
    return m ? Number(m[1]) : null;
  }

  // For LIKE queries: a literal % or _ typed by someone must not act as a wildcard.
  const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
  const likeFor = (word) => '%' + escapeLike(word) + '%';
  // Inside a PostgREST or(...) list, commas, brackets, quotes and wildcards are structure, so words used there are stripped of them.
  const orSafe = (word) => String(word).replace(/[,()"'\\%_*:]/g, '').trim();
  const orSafeWords = (q) => words(q).map(orSafe).filter((w) => /[\p{L}\p{N}]/u.test(w));

  // ---- highlighting: split text into plain and matched parts (matched = any query word, any case)
  function highlight(text, q) {
    const t = String(text == null ? '' : text);
    const ws = words(q).map((w) => w.toLowerCase());
    if (!t || !ws.length) return [{ t, hit: false }];
    const low = t.toLowerCase();
    const mark = new Array(t.length).fill(false);
    for (const w of ws) {
      let i = low.indexOf(w);
      while (i !== -1) { for (let k = i; k < i + w.length && k < mark.length; k++) mark[k] = true; i = low.indexOf(w, i + w.length); }
    }
    const parts = [];
    let cur = null;
    for (let i = 0; i < t.length; i++) {
      if (!cur || cur.hit !== mark[i]) { cur = { t: '', hit: mark[i] }; parts.push(cur); }
      cur.t += t[i];
    }
    return parts;
  }
  // a short preview of a long message, centred on the first match
  function snippet(body, q, o) {
    const before = (o && o.before) || 36, total = (o && o.total) || 140;
    const text = String(body == null ? '' : body).replace(/\s+/g, ' ').trim();
    const low = text.toLowerCase();
    const first = words(q).map((w) => low.indexOf(w.toLowerCase())).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    let start = first == null ? 0 : Math.max(0, first - before);
    if (start > 0) { const sp = text.indexOf(' ', start); if (sp !== -1 && sp - start < 12) start = sp + 1; }   // do not start in the middle of a word
    let end = Math.min(text.length, start + total);
    let out = text.slice(start, end);
    if (start > 0) out = '\u2026' + out;
    if (end < text.length) out += '\u2026';
    return highlight(out, q);
  }

  // ---- ranking
  const STATUS_RANK = { New: 0, Queued: 1, 'In Production': 2, Finishing: 3, 'Ready for Collection': 4, Collected: 6, Cancelled: 7 };
  function rankJobs(rows, q) {
    const n = jobNumberOf(q);
    const ws = words(q).map((w) => w.toLowerCase());
    const score = (j) => {
      let s = 0;
      if (n != null && Number(j.job_number) === n) s -= 1000;                       // the exact job number always comes first
      const cust = String(j.customer_name || '').toLowerCase();
      if (ws.length && cust.startsWith(ws[0])) s -= 20;                              // customer starts with what was typed
      s += STATUS_RANK[j.lifecycle_status] != null ? STATUS_RANK[j.lifecycle_status] : 5;   // open work before finished work
      if (j.priority === 'Rush') s -= 2;
      return s;
    };
    return rows.slice().sort((a, b) => score(a) - score(b) || new Date(a.due_at) - new Date(b.due_at) || Number(b.job_number) - Number(a.job_number));
  }
  function uniqueById(rows) { const seen = new Set(); return rows.filter((r) => r && !seen.has(r.id) && seen.add(r.id)); }
  const matchesAll = (text, q) => { const low = String(text || '').toLowerCase(); return words(q).every((w) => low.includes(w.toLowerCase())); };
  const filterConvs = (convs, q) => (convs || []).filter((c) => c && c.id && matchesAll(c.name, q)).slice(0, LIMITS.convs);
  // a person you already have a private chat with appears once, as that chat (it shows the last message)
  function dedupePeople(people, convs) {
    const direct = new Set((convs || []).filter((c) => c.type === 'direct').map((c) => String(c.name || '').toLowerCase()));
    return people.filter((p) => !direct.has(String(p.display_name || '').toLowerCase()));
  }
  const roleOf = (e) => [e && e.manager_role ? 'Manager' : '', e && e.front_desk ? 'Front Desk' : ''].filter(Boolean).join(' \u00b7 ') || 'Staff';

  // ---- results as groups, and the flat order the arrow keys walk through
  const GROUP_LABELS = { jobs: 'Jobs', people: 'People', convs: 'Conversations', messages: 'Messages' };
  const GROUP_ORDER = ['jobs', 'people', 'convs', 'messages'];
  function groupsOf(res) {
    return GROUP_ORDER.map((k) => ({ key: k, label: GROUP_LABELS[k], items: (res && res[k]) || [], error: !!(res && res.errors && res.errors[k]) }))
      .filter((g) => g.items.length || g.error);
  }
  const flatten = (groups) => groups.flatMap((g) => g.items);
  function move(index, delta, count) {
    if (!count) return -1;
    if (index < 0) return delta >= 0 ? 0 : count - 1;
    return (index + delta + count) % count;                     // wraps: Down on the last result goes to the first
  }
  function announce(state, count, q) {
    if (state === 'loading') return 'Searching';
    if (state === 'error') return 'Search failed';
    if (state === 'idle') return '';
    if (state === 'short') return 'Keep typing';
    return count ? count + (count === 1 ? ' result' : ' results') : 'No results for ' + normalize(q);
  }

  // ---- the shortcut
  // Typing in a text box, a text area, a drop-down or any editable area must never be hijacked.
  const NON_TEXT_INPUTS = ['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit'];
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toLowerCase();
    if (el.isContentEditable) return true;
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') return !NON_TEXT_INPUTS.includes(String(el.type || 'text').toLowerCase());
    return false;
  }
  // e = the key event; ctx = { signedIn, modalOpen, typing }
  function shouldOpen(e, ctx) {
    if (!e || !ctx || !ctx.signedIn || ctx.modalOpen) return false;
    if (String(e.key || '').toLowerCase() !== 'k') return false;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
    if (e.repeat || e.isComposing) return false;
    return !ctx.typing;
  }

  // ---- answers that arrive late must not overwrite newer ones
  function createGate() {
    let n = 0;
    return { next: () => ++n, isLatest: (id) => id === n, cancel: () => { n++; } };
  }

  function friendlyError(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/failed to fetch|network|load failed/i.test(m)) return 'Could not reach the server. Check your connection.';
    if (/jwt|not signed in|expired/i.test(m)) return 'Your sign-in has expired. Sign in again.';
    if (/timeout|canceling statement/i.test(m)) return 'The search took too long. Try fewer words.';
    return 'The search could not be completed.';
  }

  return { MIN_CHARS, MAX_TOKENS, LIMITS, normalize, words, ready, jobNumberOf, escapeLike, likeFor, orSafe, orSafeWords, highlight, snippet, rankJobs, uniqueById, matchesAll,
    filterConvs, dedupePeople, roleOf, GROUP_LABELS, GROUP_ORDER, groupsOf, flatten, move, announce, isTypingTarget, shouldOpen, createGate, friendlyError };
});
