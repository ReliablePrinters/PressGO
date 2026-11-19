'use strict';
// PressGO keyboard shortcuts: the single table of shortcuts and the rules for when one may fire.
// Pure functions only (no screen) so desktop/test/shortcuts.test.js can check every rule with real key-event shapes.
//
// Why these keys (checked against the browsers, see the Stage 8 report):
//  - Everywhere: Ctrl/Cmd+K (search), Esc, "?" (help) and "go to" sequences: press G, then a letter. No browser uses these.
//  - Only in the PressGO Windows app: Ctrl+Shift+M/A/J/T. In a browser those belong to the browser (Chrome: Ctrl+Shift+T reopens a
//    closed tab and cannot be captured at all, Ctrl+Shift+M switches user, Ctrl+Shift+J opens Developer Tools; Firefox uses
//    Ctrl+Shift+M/A/J too). The Windows app has no menu of its own, so there they conflict with nothing.
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module === 'object' ? require('./searchlogic.js') : root.pgSearchLogic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgShortcutLogic = api;
})(typeof self !== 'undefined' ? self : this, function (S) {
  // id = the nav item it belongs to; key = the letter after G; chord = the Windows-app letter (with Ctrl+Shift)
  const NAV = [
    { id: 'home', label: 'Home', hash: '#/home', key: 'h', chord: null },
    { id: 'mywork', label: 'My work', hash: '#/my-work', key: 'w', chord: null },
    { id: 'jobs', label: 'Jobs', hash: '#/jobs', key: 'j', chord: 'j' },
    { id: 'tasks', label: 'Tasks', hash: '#/tasks', key: 't', chord: 't' },
    { id: 'messages', label: 'Messages', hash: '#/chat', key: 'm', chord: 'm' },
    { id: 'alerts', label: 'Alerts', hash: '#/alerts', key: 'a', chord: 'a' },
    { id: 'settings', label: 'Settings', hash: '#/settings', key: 's', chord: null },
  ];
  const SEQUENCE_MS = 1500;                    // how long a G waits for its second key
  const byKey = (k) => NAV.find((n) => n.key === k);
  const byChord = (k) => NAV.find((n) => n.chord === k);
  const byId = (id) => NAV.find((n) => n.id === id);

  // ---- Windows or Mac? (only for what is shown on screen; the shortcuts themselves test the real key flags)
  function platformOf(nav) {
    const s = String((nav && (nav.platform || nav.userAgent)) || '');
    if (/mac|iphone|ipad|ipod/i.test(s)) return 'mac';
    if (/win/i.test(s)) return 'win';
    return 'other';
  }
  const modLabel = (platform) => (platform === 'mac' ? 'Cmd' : 'Ctrl');
  const modSymbol = (platform) => (platform === 'mac' ? '⌘' : 'Ctrl');
  const searchKeys = (platform) => (platform === 'mac' ? ['⌘', 'K'] : ['Ctrl', 'K']);

  // ---- typing protection: anything where a letter is text, plus widgets that use letters for their own navigation
  const WIDGET_ROLES = /^(textbox|searchbox|combobox|listbox|menu|menubar|menuitem|tree|grid|slider|spinbutton)$/i;
  function isTypingTarget(el) {
    if (!el) return false;
    if (S && S.isTypingTarget && S.isTypingTarget(el)) return true;
    const role = el.getAttribute && el.getAttribute('role');
    if (role && WIDGET_ROLES.test(role)) return true;
    const up = el.closest && el.closest('[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="combobox"],[role="listbox"],[role="menu"],[role="grid"],[role="tree"]');
    return !!up;
  }

  // ---- what a key press means
  // ev: { key, ctrlKey, metaKey, altKey, shiftKey, repeat, isComposing, defaultPrevented }
  // ctx: { signedIn, modalOpen, typing, lettersOn, desktop, now }
  // state: { pending: bool, at: ms }
  // returns { action: 'none'|'pending'|'cancel'|'go'|'help', nav?, via?, state }
  function decide(ev, ctx, state) {
    const none = { action: 'none', state: { pending: false, at: 0 } };
    const keep = { action: 'none', state: state || none.state };
    if (!ev || !ctx) return none;
    if (!ctx.signedIn || ctx.modalOpen || ctx.typing) return none;                 // typing, another window open, or signed out: never ours
    if (ev.repeat || ev.isComposing || ev.defaultPrevented) return keep;
    const key = String(ev.key || '');
    const lower = key.toLowerCase();
    const now = ctx.now != null ? ctx.now : Date.now();

    // Windows app only: Ctrl+Shift+letter (nothing else held)
    if (ctx.desktop && ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && lower.length === 1) {
      const n = byChord(lower);
      if (n) return { action: 'go', nav: n, via: 'chord', state: { pending: false, at: 0 } };
    }
    // everything below is a plain letter: no Ctrl / Cmd / Alt (Shift only for "?")
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return keep;
    if (!ctx.lettersOn) return none;

    const pending = !!(state && state.pending && now - state.at <= SEQUENCE_MS);
    if (key === 'Escape') return pending ? { action: 'cancel', state: { pending: false, at: 0 } } : none;
    if (key === '?') return { action: 'help', state: { pending: false, at: 0 } };
    if (key.length !== 1 || (ev.shiftKey && key !== '?')) return pending ? { action: 'cancel', state: { pending: false, at: 0 } } : keep;
    if (pending) {
      const n = byKey(lower);
      if (n) return { action: 'go', nav: n, via: 'sequence', state: { pending: false, at: 0 } };
      if (lower === 'g') return { action: 'pending', state: { pending: true, at: now } };      // G pressed again: start over
      return { action: 'cancel', state: { pending: false, at: 0 } };
    }
    if (lower === 'g') return { action: 'pending', state: { pending: true, at: now } };
    return none;
  }

  // ---- what to show
  // the small hint beside a navigation item, e.g. "G J" (empty when letters are off)
  function hint(id, o) {
    const n = byId(id);
    if (!n || !n.key || (o && o.lettersOn === false)) return '';
    return 'G ' + n.key.toUpperCase();
  }
  // the reference table (Settings, and the "?" window). keys: array of key caps; "then" separates the two steps of a sequence.
  function reference(o) {
    o = o || {};
    const platform = o.platform || 'win';
    const rows = [];
    rows.push({ group: 'Anywhere', label: 'Search jobs, people, chats and messages', keys: searchKeys(platform), tag: '' });
    rows.push({ group: 'Anywhere', label: 'Show this list of shortcuts', keys: ['?'], tag: 'letters' });
    rows.push({ group: 'Anywhere', label: 'Close the open window, search or menu', keys: ['Esc'], tag: '' });
    for (const n of NAV) rows.push({ group: 'Go to', label: n.label, keys: ['G', 'then', n.key.toUpperCase()], tag: 'letters', nav: n.id });
    if (o.desktop) for (const n of NAV.filter((x) => x.chord)) rows.push({ group: 'Windows app', label: n.label, keys: ['Ctrl', 'Shift', n.chord.toUpperCase()], tag: 'app', nav: n.id });
    return rows;
  }
  // the Windows-app chords are only worth listing for people who can use them
  const appChordNote = 'In the PressGO Windows app, Ctrl+Shift+M, A, J and T also open Messages, Alerts, Jobs and Tasks. In a web browser those keys belong to the browser, so PressGO leaves them alone.';

  // ---- the person's own choice: letter shortcuts on or off (WCAG 2.1.4: single-key shortcuts must be switchable)
  const PREF_KEY = (uid) => 'pressgo.keys.v1.' + (uid || 'anon');
  function loadPrefs(storage, uid) {
    try { const v = JSON.parse(storage.getItem(PREF_KEY(uid))); return { letters: !(v && v.letters === false) }; } catch (e) { return { letters: true }; }
  }
  function savePrefs(storage, uid, p) {
    try { storage.setItem(PREF_KEY(uid), JSON.stringify({ letters: !!(p && p.letters) })); return true; } catch (e) { return false; }
  }

  return { NAV, SEQUENCE_MS, byKey, byChord, byId, platformOf, modLabel, modSymbol, searchKeys, isTypingTarget, decide, hint, reference, appChordNote, PREF_KEY, loadPrefs, savePrefs };
});
