'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../../docs/shortcutslogic.js');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const read = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

const ev = (key, o) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...o });
const ctx = (o) => ({ signedIn: true, modalOpen: false, typing: false, lettersOn: true, desktop: false, now: 10000, ...o });
const idle = { pending: false, at: 0 };
const press = (events, c) => { let st = idle; const out = []; for (const [e, now] of events) { const r = K.decide(e, ctx({ ...c, now }), st); st = r.state; out.push(r); } return out; };

test('G then a letter goes to that page, every page in the table', () => {
  for (const n of K.NAV) {
    const [a, b] = press([[ev('g'), 1000], [ev(n.key), 1400]]);
    assert.strictEqual(a.action, 'pending', 'G waits for a second key');
    assert.strictEqual(b.action, 'go'); assert.strictEqual(b.nav.id, n.id); assert.strictEqual(b.via, 'sequence');
  }
  assert.deepStrictEqual(K.NAV.map((n) => n.key + '>' + n.hash), ['h>#/home', 'w>#/my-work', 'j>#/jobs', 't>#/tasks', 'm>#/chat', 'a>#/alerts', 's>#/settings']);
  const [, caps] = press([[ev('g'), 1000], [ev('J'), 1300]]);                                     // caps lock
  assert.strictEqual(caps.action, 'go', 'capital letters (caps lock) work too');
});

test('the sequence times out, cancels on anything else, and G can be pressed again', () => {
  const late = press([[ev('g'), 1000], [ev('j'), 1000 + K.SEQUENCE_MS + 1]]);
  assert.strictEqual(late[1].action, 'none', 'too slow: a plain J does nothing');
  const wrong = press([[ev('g'), 1000], [ev('x'), 1200], [ev('j'), 1300]]);
  assert.strictEqual(wrong[1].action, 'cancel'); assert.strictEqual(wrong[2].action, 'none', 'after a wrong key nothing is waiting');
  const again = press([[ev('g'), 1000], [ev('g'), 1200], [ev('t'), 1300]]);
  assert.strictEqual(again[1].action, 'pending'); assert.strictEqual(again[2].action, 'go'); assert.strictEqual(again[2].nav.id, 'tasks');
  const esc = press([[ev('g'), 1000], [ev('Escape'), 1100], [ev('j'), 1200]]);
  assert.strictEqual(esc[1].action, 'cancel'); assert.strictEqual(esc[2].action, 'none');
  assert.strictEqual(press([[ev('Escape'), 1000]])[0].action, 'none', 'Esc with nothing waiting is left to the page');
  assert.strictEqual(press([[ev('j'), 1000]])[0].action, 'none', 'a bare letter does nothing');
});

test('typing, other windows and being signed out always win', () => {
  for (const c of [{ typing: true }, { modalOpen: true }, { signedIn: false }]) {
    for (const e of [ev('g'), ev('?', { shiftKey: true }), ev('m', { ctrlKey: true, shiftKey: true })]) {
      assert.strictEqual(K.decide(e, ctx({ ...c, desktop: true }), idle).action, 'none', JSON.stringify(c) + ' ' + e.key);
    }
  }
  // a half-typed sequence is dropped when a window opens
  assert.deepStrictEqual(K.decide(ev('j'), ctx({ modalOpen: true }), { pending: true, at: 9500 }).state, idle);
});

test('keys with a modifier are never the letter shortcuts, so browser and system shortcuts keep working', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.strictEqual(K.decide(ev('g', { [mod]: true }), ctx(), idle).action, 'none', mod + '+G');
    const st = { pending: true, at: 9800 };
    assert.notStrictEqual(K.decide(ev('j', { [mod]: true }), ctx(), st).action, 'go', mod + '+J after G');
  }
  assert.strictEqual(K.decide(ev('G', { shiftKey: true }), ctx(), idle).action, 'none', 'Shift+G is not G');
  assert.strictEqual(K.decide(ev('g', { repeat: true }), ctx(), idle).action, 'none', 'holding a key does nothing');
  assert.strictEqual(K.decide(ev('g', { isComposing: true }), ctx(), idle).action, 'none', 'text composition (IME) is left alone');
  assert.strictEqual(K.decide(ev('g', { defaultPrevented: true }), ctx(), idle).action, 'none', 'a key something else already handled');
  assert.strictEqual(K.decide(ev('k', { ctrlKey: true }), ctx({ desktop: true }), idle).action, 'none', 'Ctrl+K belongs to search, not here');
  assert.strictEqual(K.decide(ev('k', { metaKey: true }), ctx(), idle).action, 'none');
  assert.strictEqual(K.decide(ev('Tab'), ctx(), idle).action, 'none');
  assert.strictEqual(K.decide(ev('Enter'), ctx(), idle).action, 'none');
  assert.strictEqual(K.decide(ev(' '), ctx(), idle).action, 'none');
});

test('"?" shows the list of shortcuts', () => {
  assert.strictEqual(K.decide(ev('?', { shiftKey: true }), ctx(), idle).action, 'help');
  assert.strictEqual(K.decide(ev('?'), ctx(), idle).action, 'help', 'layouts that report ? without Shift');
  assert.strictEqual(K.decide(ev('?', { shiftKey: true }), ctx({ lettersOn: false }), idle).action, 'none', 'off means off');
  assert.strictEqual(K.decide(ev('?', { shiftKey: true, ctrlKey: true }), ctx(), idle).action, 'none');
});

test('letter shortcuts can be switched off (WCAG 2.1.4); search and Esc are not letters and stay', () => {
  const r = press([[ev('g'), 1000], [ev('j'), 1200]], { lettersOn: false });
  assert.strictEqual(r[0].action, 'none'); assert.strictEqual(r[1].action, 'none');
});

test('Windows app only: Ctrl+Shift+M, A, J and T', () => {
  const chord = (k, o) => K.decide(ev(k.toLowerCase(), { ctrlKey: true, shiftKey: true, ...o }), ctx({ desktop: true, ...(o && o._c) }), idle);
  assert.deepStrictEqual(['M', 'A', 'J', 'T'].map((k) => chord(k).nav && chord(k).nav.id), ['messages', 'alerts', 'jobs', 'tasks']);
  assert.strictEqual(chord('M').via, 'chord');
  assert.strictEqual(chord('J', {}).action, 'go');
  assert.strictEqual(K.decide(ev('J', { ctrlKey: true, shiftKey: true }), ctx({ desktop: true }), idle).nav.id, 'jobs', 'shifted capital letter');
  // not in a browser
  for (const k of ['m', 'a', 'j', 't']) assert.strictEqual(K.decide(ev(k, { ctrlKey: true, shiftKey: true }), ctx({ desktop: false }), idle).action, 'none', 'browser: Ctrl+Shift+' + k);
  // other letters, other modifiers
  assert.strictEqual(K.decide(ev('h', { ctrlKey: true, shiftKey: true }), ctx({ desktop: true }), idle).action, 'none');
  assert.strictEqual(K.decide(ev('j', { ctrlKey: true, shiftKey: true, altKey: true }), ctx({ desktop: true }), idle).action, 'none', 'AltGr (Ctrl+Alt) typing is never ours');
  assert.strictEqual(K.decide(ev('j', { ctrlKey: true }), ctx({ desktop: true }), idle).action, 'none', 'Ctrl+J alone is left to the system');
  assert.strictEqual(K.decide(ev('j', { metaKey: true, shiftKey: true }), ctx({ desktop: true }), idle).action, 'none');
  // chords work even with letter shortcuts off: they are not single-key shortcuts
  assert.strictEqual(K.decide(ev('t', { ctrlKey: true, shiftKey: true }), ctx({ desktop: true, lettersOn: false }), idle).action, 'go');
});

test('the shortcut table is consistent and uses no key a browser or the system needs', () => {
  const keys = K.NAV.map((n) => n.key), chords = K.NAV.filter((n) => n.chord).map((n) => n.chord);
  assert.strictEqual(new Set(keys).size, keys.length, 'no letter is used twice');
  assert.ok(!keys.includes('g'), 'G is the prefix');
  assert.deepStrictEqual(chords.sort(), ['a', 'j', 'm', 't'], 'exactly the four chords that were proposed');
  assert.ok(!keys.includes('k'), 'K stays Search');
  const app = read('app.js');
  for (const n of K.NAV) {
    if (n.id === 'jobs') continue;                                       // Jobs is the default screen
    assert.ok(app.includes(n.hash.startsWith('#/chat') ? "h.startsWith('#/chat')" : n.id === 'settings' ? 'parseSettingsHash' : `'${n.hash}'`), n.label + ' has a route');
  }
});

test('Windows and Mac are shown the right way', () => {
  assert.strictEqual(K.platformOf({ platform: 'MacIntel' }), 'mac');
  assert.strictEqual(K.platformOf({ platform: 'iPhone' }), 'mac');
  assert.strictEqual(K.platformOf({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), 'mac');
  assert.strictEqual(K.platformOf({ platform: 'Win32' }), 'win');
  assert.strictEqual(K.platformOf({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'win');
  assert.strictEqual(K.platformOf({ platform: 'Linux x86_64' }), 'other');
  assert.strictEqual(K.platformOf(null), 'other');
  assert.deepStrictEqual(K.searchKeys('mac'), ['⌘', 'K']);
  assert.deepStrictEqual(K.searchKeys('win'), ['Ctrl', 'K']);
  assert.deepStrictEqual(K.searchKeys('other'), ['Ctrl', 'K']);
  assert.strictEqual(K.modLabel('mac'), 'Cmd'); assert.strictEqual(K.modLabel('win'), 'Ctrl');
  const mac = K.reference({ platform: 'mac' }), win = K.reference({ platform: 'win' });
  assert.deepStrictEqual(mac.find((r) => /Search/.test(r.label)).keys, ['⌘', 'K']);
  assert.deepStrictEqual(win.find((r) => /Search/.test(r.label)).keys, ['Ctrl', 'K']);
  assert.ok(!mac.some((r) => r.keys.includes('Ctrl')), 'a Mac never sees Ctrl');
});

test('the reference lists everything, and the Windows-app group only where it works', () => {
  const web = K.reference({ platform: 'win', desktop: false }), app = K.reference({ platform: 'win', desktop: true });
  assert.deepStrictEqual([...new Set(web.map((r) => r.group))], ['Anywhere', 'Go to']);
  assert.deepStrictEqual([...new Set(app.map((r) => r.group))], ['Anywhere', 'Go to', 'Windows app']);
  assert.strictEqual(web.filter((r) => r.group === 'Go to').length, K.NAV.length);
  assert.deepStrictEqual(app.filter((r) => r.group === 'Windows app').map((r) => r.keys.join('+')), ['Ctrl+Shift+J', 'Ctrl+Shift+T', 'Ctrl+Shift+M', 'Ctrl+Shift+A']);
  assert.ok(web.some((r) => r.keys.join('') === 'Esc') && web.some((r) => r.keys[0] === '?'));
  assert.match(K.appChordNote, /Windows app/);
  assert.strictEqual(K.hint('jobs'), 'G J');
  assert.strictEqual(K.hint('mywork'), 'G W');
  assert.strictEqual(K.hint('jobs', { lettersOn: false }), '');
  assert.strictEqual(K.hint('staff'), '', 'items without a shortcut show no hint');
  assert.strictEqual(K.hint('nonsense'), '');
});

test('what counts as typing includes menus, lists and editable regions', () => {
  const el = (tagName, o) => ({ tagName, getAttribute: (a) => (o && o[a]) || null, closest: () => (o && o.closest ? {} : null), type: o && o.type, isContentEditable: !!(o && o.ce) });
  for (const e of [el('INPUT', { type: 'text' }), el('INPUT', { type: 'search' }), el('INPUT', { type: 'password' }), el('INPUT', { type: 'email' }), el('INPUT', { type: 'number' }), el('INPUT', { type: 'date' }),
    el('INPUT', { type: 'datetime-local' }), el('INPUT', { type: 'tel' }), el('INPUT', { type: 'url' }), el('TEXTAREA'), el('SELECT'), el('DIV', { ce: true }),
    el('DIV', { role: 'textbox' }), el('DIV', { role: 'combobox' }), el('UL', { role: 'listbox' }), el('UL', { role: 'menu' }), el('SPAN', { closest: true })]) {
    assert.ok(K.isTypingTarget(e), JSON.stringify([e.tagName, e.type]));
  }
  for (const e of [el('BUTTON'), el('A'), el('BODY'), el('DIV'), el('INPUT', { type: 'checkbox' }), el('INPUT', { type: 'radio' }), el('INPUT', { type: 'file' }), el('INPUT', { type: 'submit' }), null]) {
    assert.ok(!K.isTypingTarget(e), JSON.stringify(e && [e.tagName, e.type]));
  }
});

test('the choice to turn letter shortcuts off is remembered per person, and storage failures never break anything', () => {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
  const s = store();
  assert.deepStrictEqual(K.loadPrefs(s, 'u1'), { letters: true }, 'on by default');
  assert.ok(K.savePrefs(s, 'u1', { letters: false }));
  assert.deepStrictEqual(K.loadPrefs(s, 'u1'), { letters: false });
  assert.deepStrictEqual(K.loadPrefs(s, 'u2'), { letters: true }, 'another person is unaffected');
  s.setItem(K.PREF_KEY('u3'), '{not json'); assert.deepStrictEqual(K.loadPrefs(s, 'u3'), { letters: true });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepStrictEqual(K.loadPrefs(broken, 'u'), { letters: true });
  assert.strictEqual(K.savePrefs(broken, 'u', { letters: false }), false);
});

// ---------------- wiring
test('shortcuts are loaded in order, shown beside navigation, and listed in Settings', () => {
  const html = read('index.html'), app = read('app.js'), chat = read('chat.js'), settings = read('settings.js'), sl = read('settingslogic.js'), css = read('style.css');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('searchlogic.js') < at('shortcutslogic.js') && at('shortcutslogic.js') < at('shortcuts.js') && at('shortcuts.js') < at('app.js'));
  assert.ok(app.includes('window.pgShortcuts.hintHtml(key)') && app.includes("hintHtml('alerts')"), 'hints beside Home, My work, Jobs, Tasks and Alerts');
  assert.ok(chat.includes("hintHtml('messages')"), 'a hint beside Channels (Messages)');
  assert.ok(sl.includes("id: 'keyboard'") && settings.includes('    keyboard(el) {'), 'a Keyboard section in Settings');
  const block = css.slice(css.indexOf('19. Keyboard shortcuts'));
  assert.ok(block.length > 300 && !/#[0-9a-fA-F]{3,6}\b/.test(block.replace(/rgba\([^)]*\)/g, '')), 'only shared colours');
  assert.ok(/@media\(hover:none\),\(max-width:800px\)\{\.kbhint\{display:none\}\}/.test(block), 'hints are hidden on phones and touch screens');
  assert.ok(/\[data-keys="off"\] \.kbhint\{display:none\}/.test(block), 'and when letter shortcuts are off');
});

test('the key handler never touches Ctrl+K, never intercepts typing, and does not interfere with Enter, Tab or Space', () => {
  const src = read('shortcuts.js'), search = read('search.js');
  assert.ok(!/['"]k['"]/i.test(src.replace(/searchKeys/g, '')), 'search keeps Ctrl+K');
  assert.ok(search.includes('L.shouldOpen('), 'search still owns Ctrl/Cmd+K');
  assert.ok(src.includes('typingNow(e.target) || typingNow(doc.activeElement)'));
  assert.ok(src.includes("el.closest('dialog:not([open])')"), 'a box inside a window that just closed is not typing');
  assert.ok(src.includes("doc.querySelector('dialog[open]')"), 'another open window gets the keys');
  assert.strictEqual((src.match(/doc\.addEventListener\('keydown'/g) || []).length, 2, 'one handler for shortcuts, one for the phone menu');
  assert.ok(!/key === 'Enter'|key === 'Tab'|key === ' '/.test(src));
  assert.ok(src.includes("box.classList.contains('nav-open')") && src.includes("doc.querySelector('dialog[open]')"), 'Esc closes the phone menu, but not when a window is open (it closes itself)');
});

test('page-specific keys elsewhere in the app are untouched: chat Enter/Esc, picture Enter/Space, search arrows', () => {
  const chat = read('chat.js'), search = read('search.js');
  assert.ok(chat.includes("e.key === 'Escape' && replyTo") && chat.includes("e.key === 'Enter' && !e.shiftKey"));
  assert.ok(chat.includes("(e.key === 'Enter' || e.key === ' ')"));
  for (const k of ['ArrowDown', 'ArrowUp', 'Enter']) assert.ok(search.includes(`'${k}'`));
});
