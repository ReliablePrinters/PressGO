'use strict';
// PressGO keyboard shortcuts (screen part). The rules, and the table of shortcuts, are in shortcutslogic.js and are tested.
//  - Go to a page: press G, then H (Home), W (My work), J (Jobs), T (Tasks), M (Messages), A (Alerts) or S (Settings).
//  - "?" lists the shortcuts. Ctrl/Cmd+K (search) lives in search.js. Esc closes the open window, search or phone menu.
//  - In the PressGO Windows app only, Ctrl+Shift+M/A/J/T also work (see shortcutslogic.js for why not in a browser).
// Nothing here is needed to use PressGO: every shortcut has a button or link, so a phone or a mouse loses nothing.
(function (root) {
  const L = root.pgShortcutLogic;
  if (!L) return;
  const doc = root.document;
  const platform = L.platformOf(root.navigator);
  const desktop = () => !!root.pressgoDesktop;
  const currentMe = () => (typeof me !== 'undefined' ? me : null);
  // a box inside a window that has just closed is not "being typed in" (the browser can take a moment to move focus away from it)
  const typingNow = (el) => !!el && !(el.closest && el.closest('dialog:not([open])')) && L.isTypingTarget(el);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let prefs = { letters: true }, prefsFor = null;
  let state = { pending: false, at: 0 };
  let timer = null, bar = null, helpDlg = null;

  // the person's own choice (kept on this computer); the page says whether letter shortcuts are on so the hints can hide
  function applyPrefs() { doc.documentElement.setAttribute('data-keys', prefs.letters ? 'on' : 'off'); }
  function syncPrefs() {
    const m = currentMe(), id = m ? m.id : null;
    if (id === prefsFor) return;
    prefsFor = id; prefs = L.loadPrefs(root.localStorage, id); applyPrefs();
  }
  function setLetters(on) { prefs.letters = !!on; L.savePrefs(root.localStorage, prefsFor, prefs); applyPrefs(); if (!on) hideBar(); }

  // ---- the little "Go to" reminder shown for a moment after G
  function showBar() {
    if (!bar) {
      bar = doc.createElement('div');
      bar.id = 'kbgo'; bar.className = 'kbgo'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
      doc.body.appendChild(bar);
    }
    bar.innerHTML = '<b>Go to</b>' + L.NAV.map((n) => `<span><kbd>${esc(n.key.toUpperCase())}</kbd> ${esc(n.label)}</span>`).join('');
    bar.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { state = { pending: false, at: 0 }; hideBar(); }, L.SEQUENCE_MS);
  }
  function hideBar() { clearTimeout(timer); if (bar) bar.hidden = true; }

  function go(nav) {
    hideBar();
    if (root.location.hash === nav.hash && typeof route === 'function') route(); else root.location.hash = nav.hash;
  }

  // ---- the reference (used by Settings and by the "?" window)
  const keycaps = (keys) => keys.map((k) => (k === 'then' ? '<span class="kbthen">then</span>' : `<kbd>${esc(k)}</kbd>`)).join(' ');
  function tableHtml() {
    const rows = L.reference({ platform, desktop: desktop() });
    const groups = [];
    for (const r of rows) { let g = groups.find((x) => x.name === r.group); if (!g) groups.push(g = { name: r.group, rows: [] }); g.rows.push(r); }
    return groups.map((g) => `<div class="kbgroup"><h4>${esc(g.name)}</h4><dl class="kbtable">${g.rows.map((r) => `<div class="kbrow${r.tag === 'letters' && !prefs.letters ? ' off' : ''}"><dt>${esc(r.label)}</dt><dd>${keycaps(r.keys)}</dd></div>`).join('')}</dl></div>`).join('');
  }

  function openHelp() {
    if (doc.querySelector('dialog[open]')) return;
    if (!helpDlg) {
      helpDlg = doc.createElement('dialog');
      helpDlg.id = 'kbhelp'; helpDlg.className = 'kbhelp'; helpDlg.setAttribute('aria-label', 'Keyboard shortcuts');
      doc.body.appendChild(helpDlg);
      helpDlg.addEventListener('click', (e) => { if (e.target === helpDlg) helpDlg.close(); });
    }
    helpDlg.innerHTML = `<div class="dh"><h3>Keyboard shortcuts</h3><p>${prefs.letters ? 'Press G, then a letter, to jump to a page.' : 'Letter shortcuts are switched off. Search and Esc still work.'}</p></div>
      <div class="db">${tableHtml()}</div>
      <div class="df"><a class="btn-link" href="#/settings/keyboard" id="kbset">Shortcut settings</a><button type="button" class="primary" id="kbx">Close</button></div>`;
    helpDlg.querySelector('#kbx').onclick = () => helpDlg.close();
    helpDlg.querySelector('#kbset').onclick = () => helpDlg.close();
    helpDlg.showModal();
  }

  // ---- Settings > Keyboard
  function panel(el) {
    syncPrefs();
    el.innerHTML = `<p class="note" style="margin-top:0">Shortcuts are an extra. Every page is also reachable from the menu, so nothing needs a keyboard.</p>
      <label class="opt" style="margin-bottom:14px"><input type="checkbox" id="kb-letters" ${prefs.letters ? 'checked' : ''}><span><b>Letter shortcuts</b><span class="hint">Press G, then a letter, to go to a page, and ? to see this list. Switch off if you use speech input or a screen reader and these keys get in the way. Search (${esc(L.searchKeys(platform).join('+'))}) and Esc always work.</span></span></label>
      <div id="kb-table">${tableHtml()}</div>
      <p class="note kbnote">${esc(L.appChordNote)}</p>
      <p class="note kbnote">Shortcuts are ignored while you are typing in a box, and while a window is open that needs your keys.</p>`;
    const cb = el.querySelector('#kb-letters');
    cb.onchange = () => { setLetters(cb.checked); el.querySelector('#kb-table').innerHTML = tableHtml(); if (root.pgToast) root.pgToast(cb.checked ? 'Letter shortcuts are on.' : 'Letter shortcuts are off.'); };
  }

  // the small hint beside a navigation item (hidden on phones, touch screens and when letters are off, by CSS)
  const hintHtml = (id) => { const h = L.hint(id); return h ? `<kbd class="kbhint" aria-hidden="true" title="Shortcut: G then ${esc(h.slice(2))}">${esc(h)}</kbd>` : ''; };

  // ---- the key handler (one listener for the whole app)
  doc.addEventListener('keydown', (e) => {
    syncPrefs();
    const m = currentMe();
    const ctx = { signedIn: !!(m && doc.getElementById('appbox')), modalOpen: !!doc.querySelector('dialog[open]'),
      typing: typingNow(e.target) || typingNow(doc.activeElement), lettersOn: prefs.letters, desktop: desktop(), now: Date.now() };
    const r = L.decide(e, ctx, state);
    state = r.state;
    if (r.action === 'pending') showBar();
    else if (r.action === 'cancel') hideBar();
    else if (r.action === 'go') { e.preventDefault(); go(r.nav); }
    else if (r.action === 'help') { e.preventDefault(); hideBar(); openHelp(); }
    else if (!state.pending) hideBar();
  });

  // Esc closes the phone menu (windows and search close themselves)
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || doc.querySelector('dialog[open]')) return;
    const box = doc.getElementById('appbox');
    if (box && box.classList.contains('nav-open')) { box.classList.remove('nav-open'); const b = doc.getElementById('burger'); if (b) b.focus(); e.preventDefault(); }
  });
  root.addEventListener('blur', () => { state = { pending: false, at: 0 }; hideBar(); });

  root.pgShortcuts = { panel, hintHtml, openHelp, go, platform, _state: () => ({ ...state }), _prefs: () => ({ ...prefs }), setLetters };
})(window);
