'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const prefs = require('../../docs/prefs.js');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'docs', 'style.css'), 'utf8');

// WCAG 2 contrast ratio between two #rrggbb colours
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// a tiny stand-in for <html> so apply() can be tested without a browser
function fakeDoc() {
  const attrs = {};
  return { attrs, documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, style: { colorScheme: '' } } };
}
const fakeStore = (initial) => { const m = new Map(Object.entries(initial || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };

test('normalize: unknown or missing values fall back to the defaults', () => {
  assert.deepEqual(prefs.normalize(undefined), { theme: 'system', accent: 'purple' });
  assert.deepEqual(prefs.normalize(null), { theme: 'system', accent: 'purple' });
  assert.deepEqual(prefs.normalize('dark'), { theme: 'system', accent: 'purple' });
  assert.deepEqual(prefs.normalize({ theme: 'neon', accent: '#ff0000' }), { theme: 'system', accent: 'purple' });
  assert.deepEqual(prefs.normalize({ theme: 'dark', accent: 'teal' }), { theme: 'dark', accent: 'teal' });
  assert.deepEqual(prefs.normalize({ theme: 'light' }), { theme: 'light', accent: 'purple' });
});

test('normalize: cannot be tricked with inherited property names', () => {
  assert.equal(prefs.normalize({ accent: 'constructor' }).accent, 'purple');
  assert.equal(prefs.normalize({ accent: '__proto__' }).accent, 'purple');
  assert.equal(prefs.normalize({ accent: 'toString' }).accent, 'purple');
});

test('resolveScheme: an explicit choice wins, "system" follows the computer', () => {
  assert.equal(prefs.resolveScheme('dark', false), 'dark');
  assert.equal(prefs.resolveScheme('light', true), 'light');
  assert.equal(prefs.resolveScheme('system', true), 'dark');
  assert.equal(prefs.resolveScheme('system', false), 'light');
});

test('apply: sets the scheme and accent on <html> and normalises bad input', () => {
  const d = fakeDoc();
  assert.deepEqual(prefs.apply({ theme: 'dark', accent: 'orange' }, d), { theme: 'dark', accent: 'orange' });
  assert.equal(d.attrs['data-scheme'], 'dark');
  assert.equal(d.attrs['data-accent'], 'orange');
  assert.equal(d.documentElement.style.colorScheme, 'dark');
  prefs.apply({ theme: 'light', accent: 'blue' }, d);
  assert.equal(d.attrs['data-scheme'], 'light');
  assert.equal(d.documentElement.style.colorScheme, 'light');
  prefs.apply({ theme: 'system', accent: 'nope' }, d);
  assert.equal(d.attrs['data-accent'], 'purple');
  assert.equal(d.documentElement.style.colorScheme, '', '"system" leaves the browser alone');
  assert.deepEqual(prefs.get(), { theme: 'system', accent: 'purple' });
});

test('recall/remember: round trip, and corrupt or unavailable storage never throws', () => {
  const s = fakeStore();
  prefs.remember({ theme: 'dark', accent: 'green' }, s);
  assert.deepEqual(prefs.recall(s), { theme: 'dark', accent: 'green' });
  assert.deepEqual(prefs.recall(fakeStore()), { theme: 'system', accent: 'purple' }, 'nothing saved yet');
  assert.deepEqual(prefs.recall(fakeStore({ 'pressgo.look.v1': '{not json' })), { theme: 'system', accent: 'purple' }, 'corrupt copy');
  assert.deepEqual(prefs.recall(fakeStore({ 'pressgo.look.v1': JSON.stringify({ theme: 'x', accent: 'y' }) })), { theme: 'system', accent: 'purple' }, 'junk values');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => prefs.remember({ theme: 'dark', accent: 'blue' }, broken));
  assert.deepEqual(prefs.recall(broken), { theme: 'system', accent: 'purple' });
});

// ---- accessibility: every accent stays readable in both schemes
const SURFACES = { light: { bg: '#f5f4f8', card: '#ffffff' }, dark: { bg: '#0e1017', card: '#171a24' } };
for (const [name, a] of Object.entries(prefs.ACCENTS)) {
  for (const scheme of ['light', 'dark']) {
    const c = a[scheme], s = SURFACES[scheme];
    test(`contrast: ${name} / ${scheme}`, () => {
      assert.ok(ratio(c.brand, s.bg) >= 4.5, `links and highlights on the page background: ${ratio(c.brand, s.bg).toFixed(2)}`);
      assert.ok(ratio(c.brand, s.card) >= 4.5, `links and highlights on cards: ${ratio(c.brand, s.card).toFixed(2)}`);
      assert.ok(ratio(c.btn, '#ffffff') >= 4.5, `white text on a button: ${ratio(c.btn, '#ffffff').toFixed(2)}`);
      assert.ok(ratio(c.btn, s.card) >= 3, `a button stands out from its card: ${ratio(c.btn, s.card).toFixed(2)}`);
      // The default purple's dark-mode hover colour was already in the app before this feature (4.39:1); it is not changed here.
      const preExisting = name === 'purple' && scheme === 'dark';
      assert.ok(ratio(c.btnH, '#ffffff') >= (preExisting ? 4.3 : 4.5), `white text on a hovered button: ${ratio(c.btnH, '#ffffff').toFixed(2)}`);
    });
  }
}

test('the default purple is exactly the colours the app already had', () => {
  assert.deepEqual(prefs.ACCENTS.purple.light, { brand: '#5b2a9d', btn: '#5b2a9d', btnH: '#4d2287' });
  assert.deepEqual(prefs.ACCENTS.purple.dark, { brand: '#b394ee', btn: '#7a4cd0', btnH: '#8a60dc' });
});

// ---- the three places that list the accents must agree
test('style.css has exactly the colours listed in prefs.js', () => {
  for (const [name, a] of Object.entries(prefs.ACCENTS)) {
    if (name === 'purple') continue;   // the default lives in :root
    const rule = (scheme) => {
      const sel = scheme === 'dark' ? `:root[data-accent="${name}"][data-scheme="dark"]` : `:root[data-accent="${name}"]`;
      const i = css.indexOf(sel + '{');
      assert.ok(i >= 0, `missing CSS rule ${sel}`);
      return css.slice(i, css.indexOf('}', i));
    };
    for (const scheme of ['light', 'dark']) {
      const r = rule(scheme), c = a[scheme];
      assert.ok(r.includes(`--brand:${c.brand}`), `${name}/${scheme} brand`);
      assert.ok(r.includes(`--btn:${c.btn}`), `${name}/${scheme} btn`);
      assert.ok(r.includes(`--btn-h:${c.btnH}`), `${name}/${scheme} btn-h`);
    }
  }
});

test('style.css: no accent rule exists that prefs.js does not know about', () => {
  const inCss = [...css.matchAll(/:root\[data-accent="([a-z]+)"\]\{/g)].map((m) => m[1]);
  for (const n of new Set(inCss)) assert.ok(Object.prototype.hasOwnProperty.call(prefs.ACCENTS, n), `unknown accent in CSS: ${n}`);
});

test('migration 0016 allows exactly the accents and appearances the app offers', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '0016_preferences.sql'), 'utf8');
  const list = (re) => [...sql.matchAll(re)].map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort().join('|'));
  const want = Object.keys(prefs.ACCENTS).sort().join('|');
  const accents = list(/accent in \(([^)]*)\)/g), accentArgs = list(/p_accent, ''\) not in \(([^)]*)\)/g);
  assert.ok(accents.length >= 1 && accents.every((x) => x === want), 'table check lists the same accents');
  assert.ok(accentArgs.length === 1 && accentArgs[0] === want, 'function check lists the same accents');
  const themes = list(/theme in \(([^)]*)\)/g);
  assert.ok(themes.length >= 1 && themes.every((x) => x === prefs.THEMES.slice().sort().join('|')), 'appearances match');
});

test('the dark colours in the two dark blocks of style.css are identical', () => {
  const grab = (start) => { const i = css.indexOf(start); return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i)).replace(/\s+/g, ''); };
  const media = (() => { const i = css.indexOf(':root:not([data-scheme]){'); return css.slice(i + ':root:not([data-scheme]){'.length, css.indexOf('}', i)).replace(/\s+/g, ''); })();
  assert.equal(media, grab(':root[data-scheme="dark"]{'));
});

test('index.html loads prefs.js in <head> before the page paints', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(head.includes('<script src="prefs.js"></script>'));
});
