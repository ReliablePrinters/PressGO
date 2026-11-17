'use strict';
// PressGO 2.0 visual system (Print Room light theme, Clean Slate dark theme): the stylesheet's own colours are read back and
// checked against WCAG 2.2, so a later edit cannot quietly make something unreadable.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(ROOT, 'docs', 'style.css'), 'utf8').replace(/\r\n/g, '\n');

function block(start) {
  const i = css.indexOf(start);
  assert.ok(i >= 0, 'missing block ' + start);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}
const vars = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*([^;]+?)\s*(?:;|$)/g)].map((m) => [m[1], m[2]]));
const light = vars(block(':root{'));
const dark = vars(block(':root[data-scheme="dark"]{'));
const T = { light, dark: { ...light, ...dark } };

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const c = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (fg, bg, p) => '#' + rgb(fg).map((v, i) => Math.round(v * p + rgb(bg)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

test('the approved palette is what the stylesheet uses', () => {
  assert.deepEqual([light.bg, light.card, light.ink, light.side, light.brand], ['#f4f6f8', '#ffffff', '#14202e', '#0f1b2a', '#0a6a9e']);
  assert.deepEqual([dark.bg, dark.card, dark.surface2, dark.ink, dark.side, dark.brand], ['#000000', '#1c1c1e', '#2c2c2e', '#f2f2f7', '#111113', '#5cc0f2']);
});

test('the old purple / pink look is gone', () => {
  for (const old of ['#5b2a9d', '#4d2287', '#e6199b', '#f04db2', '#14111f', '#b394ee', '#0e1017']) assert.ok(!css.includes(old), old + ' is still in style.css');
});

for (const scheme of ['light', 'dark']) {
  const t = T[scheme];
  test(`text and controls are readable: ${scheme}`, () => {
    const check = (what, a, b, min) => assert.ok(ratio(a, b) >= min, `${what}: ${ratio(a, b).toFixed(2)} < ${min}`);
    for (const s of ['bg', 'card', 'surface2']) {
      check(`ink on ${s}`, t.ink, t[s], 4.5);
      check(`muted on ${s}`, t.mut, t[s], 4.5);
      check(`link on ${s}`, t.brand, t[s], 4.5);
      for (const c of ['bad', 'ok', 'warn']) check(`${c} on ${s}`, t[c], t[s], 4.5);
      check(`control edge on ${s}`, t.ctl, t[s], 3);
    }
    check('white on primary button', '#ffffff', t.btn, 4.5);
    check('white on primary hover', '#ffffff', t['btn-h'], 4.5);
    check('primary button against its card', t.btn, t.card, 3);
    check('text on a filled red badge', t['on-bad'], t.bad, 4.5);
    check('focus ring on the page', t.focusc, t.bg, 3);
    check('focus ring on cards', t.focusc, t.card, 3);
    check('sidebar text', t['side-ink'], t.side, 4.5);
    check('sidebar muted text', t['side-mut'], t.side, 4.5);
    check('white on the active sidebar item', '#ffffff', t['side-on'], 4.5);
    check('sidebar accent', t['side-accent'], t.side, 4.5);
    check('sidebar accent badge text', '#08131f', t['side-accent'], 4.5);
    for (const k of ['new', 'queued', 'prod', 'fin', 'ready', 'done', 'cancel']) {
      const c = t['s-' + k];
      check(`status "${k}" on its badge (card)`, c, mix(c, t.card, 0.13), 4.5);
      check(`status "${k}" on its badge (raised)`, c, mix(c, t.surface2, 0.13), 4.5);
    }
    for (const c of ['bad', 'ok', 'warn']) check(`${c} badge text`, t[c], mix(t[c], t.card, 0.12), 4.5);
    check('link on the selected tint', t.brand, mix(t.brand, t.card, 0.1), 4.5);
  });
}

test('the two dark blocks (computer setting / chosen) hold the same values', () => {
  const grab = (s) => block(s).replace(/\s+/g, '');
  assert.equal(grab(':root:not([data-scheme]){'), grab(':root[data-scheme="dark"]{'));
});

test('focus is always visible and uses a solid colour', () => {
  assert.ok(/:focus-visible\{outline:2px solid var\(--focusc\);outline-offset:2px\}/.test(css));
  assert.ok(/--focus:0 0 0 2px var\(--card\),0 0 0 4px var\(--focusc\)/.test(css));
  assert.ok(/\.side :focus-visible,\.mobbar :focus-visible\{outline-color:var\(--side-accent\)\}/.test(css), 'focus on the dark sidebar uses the light accent');
});

test('filled red things use the on-bad text colour (white would fail on the light red of the dark theme)', () => {
  assert.ok(/\.badge\.late\{color:var\(--on-bad\);background:var\(--bad\)\}/.test(css));
  assert.ok(/button\.primary\.danger\{background:var\(--bad\);border-color:var\(--bad\);color:var\(--on-bad\)\}/.test(css));
});

test('form controls have a visible edge (3:1) and a 38px height; small targets are never under 32px', () => {
  assert.ok(/input,select,textarea\{width:100%;height:38px;padding:0 12px;border:1px solid var\(--ctl\)/.test(css));
  assert.ok(/button\.sm\{height:32px/.test(css));
});

test('layout is responsive: the sidebar becomes a drawer and tables become cards on small screens', () => {
  assert.ok(/@media\(max-width:800px\)\{\s*\.app\{display:block/.test(css));
  assert.ok(/@media\(max-width:900px\)\{\s*\.tbl thead\{display:none\}/.test(css));
  assert.ok(/prefers-reduced-motion:reduce/.test(css));
});

test('every script that draws its own styles only uses the shared colour tokens', () => {
  for (const f of ['chat.js', 'home.js', 'msgfx.js', 'settings.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8');
    const inStyle = [...src.matchAll(/css\.textContent = `([\s\S]*?)`;|alertCss\.textContent = `([\s\S]*?)`;/g)].map((m) => m[1] || m[2]).join('\n');
    const hex = (inStyle.match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter((h) => !['#8b93a7', '#22c55e', '#f5a524', '#fff'].includes(h.toLowerCase()));   // presence dots, and white text on a primary button
    assert.deepEqual(hex, [], f + ' has fixed colours in its styles');
  }
});

test('the browser and installed-app theme colour match the sidebar', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  const manifest = fs.readFileSync(path.join(ROOT, 'docs', 'manifest.webmanifest'), 'utf8');
  assert.ok(html.includes('<meta name="theme-color" content="#0f1b2a">'));
  assert.ok(manifest.includes('"theme_color":"#0f1b2a"') && manifest.includes('"background_color":"#0f1b2a"'));
});

test('Windows app: the "cannot connect" page uses the page\'s own colours; the window itself starts in the splash\'s navy', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const m = main.match(/const START_COLOURS = \{ dark: \{ bg: '(#[0-9a-f]{6})', fg: '(#[0-9a-f]{6})' \}, light: \{ bg: '(#[0-9a-f]{6})', fg: '(#[0-9a-f]{6})' \} \};/);
  assert.ok(m, 'START_COLOURS is declared in main.js');
  assert.deepEqual([m[1], m[2]], [T.dark.bg, T.dark.ink], 'dark start colours = the dark page background and text');
  assert.deepEqual([m[3], m[4]], [T.light.bg, T.light.ink], 'light start colours = the light page background and text');
  assert.ok(ratio(m[1], m[2]) >= 7 && ratio(m[3], m[4]) >= 7, 'the "cannot connect" text stays easy to read in both');
  const splashNavy = /const SPLASH_NAVY = '(#[0-9a-f]{6})'/.exec(fs.readFileSync(path.join(__dirname, '..', 'startup', 'startup.js'), 'utf8'))[1];   // read as text: this test must not need Electron installed
  assert.strictEqual(splashNavy, light.side, 'the splash\'s navy is the app\'s sidebar navy');
  assert.ok(/backgroundColor: SPLASH_NAVY/.test(main), 'the window starts in that navy, because the startup splash is the first thing shown');
  assert.ok(/nativeTheme\.shouldUseDarkColors \? START_COLOURS\.dark : START_COLOURS\.light/.test(main));
  assert.ok(!/#0f1b2a/.test(main), 'the navy is defined once, in startup/startup.js, not repeated in main.js');
  assert.ok(/background:' \+ c\.bg \+ ';color:' \+ c\.fg/.test(main), 'the "cannot connect" page uses the same colours');
  // the page side of the same promise: the saved look is applied in <head>, before the first paint
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(html.indexOf('<script src="prefs.js"></script>') > 0 && html.indexOf('<script src="prefs.js"></script>') < html.indexOf('</head>'));
  assert.ok(/body\{[^}]*background:var\(--bg\)/.test(css), 'the page paints --bg on the body');
});
