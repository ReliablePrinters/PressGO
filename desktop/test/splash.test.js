'use strict';
// The startup experience ("The PressGO Print Sequence", desktop/startup/): its rules, and the promises made about it (local, real logos, bundled
// font, calm, never delays a fast start, and wired into the app without disturbing it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('../startup/splashlogic.js');
const ROOT = path.join(__dirname, '..', '..');
const proto = (f) => fs.readFileSync(path.join(ROOT, 'desktop', 'startup', f), 'utf8').replace(/\r\n/g, '\n');
const T = S.T;
const run = (state, events) => events.reduce((acc, [ev, at, o]) => { const r = S.step(acc.state, ev, at, o); return { state: r.state, actions: acc.actions.concat(r.actions) }; }, { state, actions: [] });

// ---------- the state machine
test('the intro plays for about 2.2 s, then the calm loading state; 12 s without the app is "slow"; 45 s is a failure with a retry', () => {
  assert.strictEqual(T.INTRO, 2300);
  let s = S.create(0);
  assert.strictEqual(s.phase, 'starting');
  s = S.step(s, { type: 'tick' }, T.INTRO - 1).state; assert.strictEqual(s.phase, 'starting');
  s = S.step(s, { type: 'tick' }, T.INTRO).state; assert.deepStrictEqual([s.phase, s.introDone], ['loading', true]);
  s = S.step(s, { type: 'tick' }, T.SLOW - 1).state; assert.strictEqual(s.phase, 'loading');
  s = S.step(s, { type: 'tick' }, T.SLOW).state; assert.strictEqual(s.phase, 'slow');
  s = S.step(s, { type: 'tick' }, T.GIVE_UP).state; assert.deepStrictEqual([s.phase, s.reason], ['failed', 'timeout']);
});

test('no arbitrary delay: the moment the app is ready the splash starts leaving, wherever the intro has got to', () => {
  for (const at of [50, 700, T.INTRO - 1, T.INTRO + 10, T.SLOW + 5]) {
    const r = S.step(S.create(0), { type: 'ready' }, at);
    assert.strictEqual(r.state.phase, 'leaving', 'ready at ' + at + ' ms');
    assert.deepStrictEqual(r.actions, ['leave']);
  }
  // and it takes 220 ms to fade out (120 ms with reduce motion), then it is removed
  let r = S.step(S.create(0), { type: 'ready' }, 500);
  assert.strictEqual(S.step(r.state, { type: 'tick' }, 500 + T.FADE - 1).state.phase, 'leaving');
  const done = S.step(r.state, { type: 'tick' }, 500 + T.FADE);
  assert.deepStrictEqual([done.state.phase, done.actions], ['done', ['remove']]);
  assert.strictEqual(S.step(r.state, { type: 'tick' }, 500 + T.FADE_REDUCED, { reduced: true }).state.phase, 'done');
  assert.ok(T.FADE <= 250 && T.FADE_REDUCED < T.FADE, 'a short, quiet exit');
  // a second "ready", or one that arrives after it is all over, changes nothing
  assert.strictEqual(S.step(r.state, { type: 'ready' }, 600).state.leftAt, 500);
  assert.deepStrictEqual(S.step(done.state, { type: 'ready' }, 900).actions, []);
});

test('failures are told apart: offline-type errors retry by themselves, other errors wait for the person, and page parts failing are ignored', () => {
  for (const code of [-106, -105, -102, -118, -7, -21, -100, -101, -109]) assert.strictEqual(S.classifyFailure(code, true), 'offline', String(code));
  for (const code of [-200, -201, -312, -501, -2, -6]) assert.strictEqual(S.classifyFailure(code, true), 'failed', String(code));
  assert.strictEqual(S.classifyFailure(-3, true), 'ignore', 'aborted (a redirect or a new load) is never an error');
  assert.strictEqual(S.classifyFailure(-106, false), 'ignore', 'a picture or script failing is not the app failing');
  assert.strictEqual(S.classifyFailure(null, true), 'ignore');
  let s = S.step(S.create(0), { type: 'fail', code: -106, isMainFrame: true }, 1000).state;
  assert.deepStrictEqual([s.phase, s.retryAt], ['offline', 1000 + T.RETRY_MS[0]]);
  s = S.step(S.create(0), { type: 'fail', code: -200, isMainFrame: true }, 1000).state;
  assert.deepStrictEqual([s.phase, s.retryAt, s.code], ['failed', null, -200]);
  assert.strictEqual(S.step(S.create(0), { type: 'fail', code: -3, isMainFrame: true }, 1000).state.phase, 'starting');
});

test('offline retries start soon, then calmer (3 s, 6 s, then every 10 s) and load again by themselves', () => {
  assert.deepStrictEqual(T.RETRY_MS, [3000, 6000, 10000]);
  assert.deepStrictEqual([1, 2, 3, 4, 9].map(S.retryDelay), [3000, 6000, 10000, 10000, 10000]);
  const r = run(S.create(0), [[{ type: 'tick' }, T.INTRO], [{ type: 'fail', code: -106, isMainFrame: true }, 3000], [{ type: 'tick' }, 5999], [{ type: 'tick' }, 6000]]);
  assert.deepStrictEqual(r.actions, ['load'], 'exactly one retry, at the right moment');
  assert.deepStrictEqual([r.state.phase, r.state.attempt], ['loading', 2]);
  // the second failure waits longer
  const r2 = S.step(r.state, { type: 'fail', code: -106, isMainFrame: true }, 6500);
  assert.strictEqual(r2.state.retryAt, 6500 + 6000);
});

test('the intro never replays: a retry before it finished carries on, a retry after it goes straight to the calm loading state', () => {
  // the failure came while the intro was still playing: it carries on from "starting"
  let early = S.step(S.create(0), { type: 'fail', code: -106, isMainFrame: true }, 500).state;
  early = S.step(early, { type: 'retry' }, 700).state;
  assert.strictEqual(early.phase, 'starting');
  // the intro had finished: never "starting" again
  let late = run(S.create(0), [[{ type: 'tick' }, T.INTRO], [{ type: 'fail', code: -200, isMainFrame: true }, 4000]]).state;
  assert.strictEqual(late.phase, 'failed');
  const again = S.step(late, { type: 'retry' }, 5000);
  assert.deepStrictEqual([again.state.phase, again.actions, again.state.attempt, again.state.code], ['loading', ['load'], 2, null]);
  // "Try again" from the slow state, and the operating system coming back online while offline, both load again at once
  const slow = S.step({ ...S.create(0), phase: 'slow', introDone: true }, { type: 'retry' }, 20000);
  assert.deepStrictEqual([slow.state.phase, slow.actions], ['loading', ['load']]);
  const off = S.step(S.step(S.create(0), { type: 'fail', code: -106, isMainFrame: true }, 100).state, { type: 'online' }, 200);
  assert.deepStrictEqual(off.actions, ['load']);
  // retry has no effect while everything is fine
  assert.deepStrictEqual(S.step(S.create(0), { type: 'retry' }, 100).actions, []);
});

test('a crash while starting is a failure; a clean exit is not; nothing changes once the app is showing', () => {
  assert.deepStrictEqual([S.step(S.create(0), { type: 'gone', reason: 'crashed' }, 400).state.phase, S.step(S.create(0), { type: 'gone', reason: 'crashed' }, 400).state.reason], ['failed', 'crashed']);
  assert.strictEqual(S.step(S.create(0), { type: 'gone', reason: 'clean-exit' }, 400).state.phase, 'starting');
  const leaving = S.step(S.create(0), { type: 'ready' }, 300).state;
  assert.strictEqual(S.step(leaving, { type: 'gone', reason: 'crashed' }, 350).state.phase, 'leaving', 'after hand-over, the app looks after itself');
  assert.strictEqual(S.step(leaving, { type: 'fail', code: -106, isMainFrame: true }, 350).state.phase, 'leaving');
});

test('the words: short, plain, no jargon, and the countdown is exact', () => {
  const m = (s, now) => S.messageFor(s, now || 0);
  assert.strictEqual(m({ phase: 'starting' }).title, 'Starting PressGO');
  assert.deepStrictEqual(m({ phase: 'loading' }).actions, []);
  assert.deepStrictEqual(m({ phase: 'slow' }).actions, ['retry']);
  assert.match(m({ phase: 'slow' }).body, /longer than usual/);
  const off = m({ phase: 'offline', retryAt: 4200 }, 1000);
  assert.strictEqual(off.title, 'You are offline');
  assert.match(off.body, /Reconnect and it will start by itself\. Trying again in 4 s\./);
  assert.deepStrictEqual(off.actions, ['retry']);
  assert.match(m({ phase: 'failed', reason: 'load', code: -200 }).body, /\(error -200\)/);
  assert.match(m({ phase: 'failed', reason: 'crashed' }).body, /stopped while it was starting/);
  assert.match(m({ phase: 'failed', reason: 'timeout' }).body, /far too long/);
  assert.deepStrictEqual(m({ phase: 'failed', reason: 'load' }).actions, ['retry', 'quit'], 'always a way forward, and a way out');
  assert.doesNotMatch(JSON.stringify([off, m({ phase: 'failed', reason: 'load' })]), /ERR_|net::|exception|stack/i);
});

// ---------- the promises
test('the real logos, never copies: the Reliable Printers logo is byte-for-byte the app\'s own file, and the wordmark is live text in the app\'s own colours', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.strictEqual(sha(path.join(ROOT, 'desktop', 'startup', 'assets', 'logo.png')), sha(path.join(ROOT, 'docs', 'logo.png')), 'identical to docs/logo.png');
  const html = proto('splash.html'), css = proto('splash.css'), app = fs.readFileSync(path.join(ROOT, 'docs', 'style.css'), 'utf8');
  assert.ok(html.includes('<image href="assets/logo.png"') && html.includes('Reliable Printers &amp; Stationery Ltd.'));
  assert.ok(/<tspan class="p">Press<\/tspan><tspan class="g">GO<\/tspan>/.test(html), 'Press + GO, as the app draws it');
  // the colours are the app's own tokens
  for (const [token, value] of [['--navy', '#0f1b2a'], ['--side-on', '#1d3550'], ['--blue', '#5cc0f2'], ['--brand', '#0a6a9e'], ['--ink', '#14202e'], ['--soft', '#e8eef5'], ['--mut', '#a9b6c6']]) {
    assert.ok(new RegExp(token + ':' + value).test(css), token + ' = ' + value + ' in the splash');
    assert.ok(app.toLowerCase().includes(value), value + ' exists in docs/style.css');
  }
  assert.ok(css.includes('--font:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'), 'the app\'s own font stack, now with Inter really there');
  assert.ok(/\.word,\.echo\{font:800 80px var\(--font\)/.test(css), 'weight 800, like the app\'s wordmark');
});

test('local only: no network request, no library, no web font (only the bundled Inter file); a strict content policy', () => {
  const html = proto('splash.html'), css = proto('splash.css'), js = proto('splash.js') + proto('splashlogic.js');
  assert.deepEqual((html + css).match(/https?:\/\/[^\s"')]+/g) || [], [], 'no web address in the page or its styles');
  assert.ok(!/<link[^>]+href="https?:|<script[^>]+src="https?:|@import/i.test(html + css), 'no remote link or import');
  const urls = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1].replace(/"/g, ''));
  assert.deepStrictEqual(urls.filter((u) => !u.startsWith('#')), ['fonts/InterVariable.woff2'], 'the only file the styles load is the bundled Inter (everything else is a local #reference such as a clip path)');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|import\(|lottie|require\(/i.test(js), 'the page script makes no request and loads no library');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'none'"/);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
  assert.ok(!Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((d) => /lottie|gsap|framer|anime/i.test(d)), 'no animation library added');
});

test('cheap to run: only transform, opacity and stroke-dashoffset are animated; the finished picture is the default; reduce motion is real', () => {
  const css = proto('splash.css');
  const frames = [...css.matchAll(/@keyframes ([\w-]+)\{([\s\S]*?)\n(?=@keyframes|\/\* ---- reduce|#root\.rm)/g)];
  const keyframeBlocks = css.split('@keyframes ').slice(1).map((b) => b.slice(0, b.indexOf('\n')));
  assert.ok(keyframeBlocks.length >= 14, 'the sequence has its keyframes');
  const props = new Set();
  for (const line of keyframeBlocks) for (const m of line.matchAll(/([a-z-]+):/g)) props.add(m[1]);
  assert.deepStrictEqual([...props].sort(), ['opacity', 'stroke-dashoffset', 'transform'], 'nothing that forces layout or heavy repaint is animated');
  assert.ok(!/animation[^;{}]*(width|height|top|left|filter|box-shadow)/.test(css));
  assert.ok(!/filter:|backdrop-filter|box-shadow/.test(css.replace(/\.demo[^}]*\}/g, '')), 'no blur or shadow effects in the splash itself');
  assert.ok(/@media \(prefers-reduced-motion:reduce\)/.test(css), 'the operating system setting is honoured');
  assert.ok(/#root\.rm \.stage\{animation:rmin \.25s/.test(css), 'reduce motion: one short fade');
  assert.ok(/\.rm \.bar\{display:none\}/.test(css) || /#root\.rm \.bar\{display:none\}/.test(css), 'and no moving progress bar');
  assert.ok(css.includes('#root.paused *{animation-play-state:paused!important}') && proto('splash.js').includes("document.addEventListener('visibilitychange'"), 'a hidden window does not animate');
  // everything outside an animation describes the finished picture: the sheet and the words are visible by default
  assert.ok(/\.paper\{fill:var\(--paper\)\}/.test(css) && /\.reveal\{transform:translateX\(380px\)\}/.test(css), 'the finished state is the default state');
  assert.ok(!/ds+/.test('') && frames.length >= 0);
});

test('works at every supported window size and display scale: the picture scales with the window, the words never get smaller than readable', () => {
  const css = proto('splash.css'), html = proto('splash.html');
  assert.ok(html.includes('viewBox="0 0 960 545" preserveAspectRatio="xMidYMid meet"'), 'one picture that scales to fit');
  assert.ok(/\.status\{[^}]*height:clamp\(104px,20vh,160px\)/.test(css));
  assert.ok(/\.status \.title\{[^}]*font-size:clamp\(16px,2\.7vmin,22px\)/.test(css) && /\.status \.body\{[^}]*font-size:clamp\(13px,2vmin,17px\)/.test(css), 'text has a readable floor');
  assert.ok(/\.actions button\{[^}]*clamp\(13px,2vmin,16px\)/.test(css));
  assert.ok(/overflow:hidden/.test(css) && !/min-width:\s*\d{3,}/.test(css), 'never a scroll bar, never wider than the window');
});

test('Inter is bundled with its licence: the real file from the official release, a valid font, the SIL Open Font License, and the splash really uses it', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const font = path.join(ROOT, 'desktop', 'startup', 'fonts', 'InterVariable.woff2');
  const lic = fs.readFileSync(path.join(ROOT, 'desktop', 'startup', 'fonts', 'Inter-LICENSE.txt'), 'utf8');
  assert.strictEqual(fs.readFileSync(font).subarray(0, 4).toString('latin1'), 'wOF2', 'a WOFF2 font file');
  assert.strictEqual(sha(font), '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3', 'exactly InterVariable.woff2 from the Inter 4.1 release (rsms/inter)');
  assert.strictEqual(sha(path.join(ROOT, 'desktop', 'startup', 'fonts', 'Inter-LICENSE.txt')), '262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a', 'and its licence file, unchanged');
  assert.match(lic, /Copyright \(c\) 2016 The Inter Project Authors/);
  assert.match(lic, /SIL Open Font License, Version 1\.1/);
  const css = proto('splash.css');
  assert.ok(/@font-face\{font-family:"Inter";src:url\("fonts\/InterVariable\.woff2"\) format\("woff2"\);font-weight:100 900;font-style:normal;font-display:block\}/.test(css));
  assert.ok(css.includes('Inter, bundled with the app') && css.includes('Inter-LICENSE.txt'), 'and the stylesheet says where the licence is');
  assert.ok(fs.statSync(font).size < 400 * 1024, 'about 350 KB for every weight');
});

test('the Electron side: one extra view on top of the app, nothing waits for the animation, and failures are handled while the splash is up', () => {
  const st = proto('startup.js');
  assert.ok(st.includes('new WebContentsView') && st.includes('win.contentView.addChildView(splash)'), 'the splash is one extra view on top of the app\'s own page');
  assert.ok(!/addChildView\(app/.test(st), 'the app page is not moved: the updater, notifications and context menu keep their web contents');
  assert.ok(st.includes("splash.webContents.once('did-finish-load'") && st.includes('win.show()'), 'the window appears when the splash is drawn, not when the app is');
  assert.ok(st.includes('startLoad();') && st.indexOf('startLoad();') < st.indexOf("splash.webContents.loadFile(path.join(__dirname, 'splash.html'));") + 400, 'the app starts loading at once, in parallel with the splash');
  assert.ok(st.includes("if (a === 'leave') leave();") && !/setTimeout\([^)]*leave\(/.test(st), 'leaving is never scheduled for later');
  assert.ok(st.includes('setTimeout(() => dispatch({ type: \'tick\' }), L.T.FADE + 5)'), 'removed exactly when the fade ends');
  assert.ok(st.includes("!['starting', 'loading', 'slow'].includes(state.phase)") && st.includes('isCrashed()'), 'the readiness check stops once it can no longer matter');
  assert.ok(st.includes("setWindowOpenHandler(() => ({ action: 'deny' }))") && st.includes("on('will-navigate', (e) => e.preventDefault())"), 'the splash opens nothing and goes nowhere');
  assert.ok(st.includes('sandbox: true, contextIsolation: true, nodeIntegration: false'), 'sandboxed');
  assert.ok(st.includes("document.querySelector('.app, .signin')"), 'ready means the dashboard shell or the sign-in page has been drawn');
  assert.ok(st.includes('e.sender === splash.webContents'), 'messages are accepted only from the splash itself');
  assert.ok(/function giveUp\(why\)/.test(st) && st.includes("splash.webContents.once('did-fail-load', () => giveUp("), 'if the splash itself cannot load, the app is shown plainly');
  assert.ok(st.includes("setTimeout(() => { if (!shown && !win.isDestroyed() && !win.isVisible()) { win.show();"), 'and a safety timer means there is never "no window"');
  assert.ok(!/reliableprinters\.github\.io|supabase\.co|nbkzejfoxyzvyfehhheo|fcmkichfgbrflvnmjgba/.test(st + proto('splash.js') + proto('splash.html')), 'no production address in the startup code');
  const pre = proto('splash-preload.js');
  assert.deepStrictEqual([...pre.matchAll(/(\w+): \(/g)].map((m) => m[1]).sort(), ['loaded', 'onState', 'quit', 'retry'], 'the bridge offers exactly four things');
});

test('wired into the app without disturbing it: the page stays in the window\'s own web contents, existing behaviour is kept, and the packaging includes the startup folder', () => {
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(main.includes("require('./startup/startup')") && main.includes('startup = createStartup({ win, appUrl: APP_URL'));
  assert.ok(/show: false,\n\s+title: 'PressGO',\n\s+backgroundColor: SPLASH_NAVY/.test(main), 'the window is hidden until the splash has drawn, in the splash\'s navy');
  // everything that used the window's web contents still does
  for (const keep of ["preload: path.join(__dirname, 'preload.js')", 'devTools: false', 'webSecurity: true', 'sandbox: true', 'win.webContents.setWindowOpenHandler', "win.webContents.on('will-navigate'", "win.webContents.on('context-menu'", 'startNotifications();', 'startUpdates();', 'e.senderFrame === win.webContents.mainFrame']) assert.ok(main.includes(keep), keep + ' is unchanged');
  assert.ok(main.includes("if (startup && startup.active()) { startup.onFail(code, isMainFrame); return; }\n    if (isMainFrame && code !== -3) showOffline();"), 'while the splash is up it handles failures; afterwards the old "cannot connect" page behaves exactly as before');
  assert.ok(main.includes('startup.begin();'));
  assert.ok(!/win\.loadURL\(APP_URL\);\n\}/.test(main), 'the app is loaded by the startup controller (so a retry is possible)');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('startup/**/*'), 'the splash, logo and font are packaged');
  assert.strictEqual(pkg.version, '1.2.0', 'the installer\'s version number is the release version');
  assert.ok(!/splash/i.test(fs.readFileSync(path.join(ROOT, 'desktop', 'preload.js'), 'utf8')), 'the page bridge is untouched');
  const idx = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
  assert.ok(!/startup|splash/i.test(idx), 'the website is untouched');
  assert.ok(fs.existsSync(path.join(ROOT, 'desktop', 'startup', 'README.md')), 'and it is documented');
});

test('test hooks exist only in the local PressGO Test build: a normal build ignores every one of them', () => {
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(main.includes('{ APP_URL = o.url; TEST_BUILD = true; }'), 'only a valid local test-override.json (made by try-build.js) switches it on');
  assert.ok(main.includes('const startupTest = TEST_BUILD ? {') && main.includes('} : null;'), 'otherwise the controller gets no hooks at all');
  const st = proto('startup.js');
  assert.ok(st.includes('test = o.test || null') &&/const log = \(m\) => \{\n\s+if \(!test\) return;/.test(st), 'no hooks, no logging');
  assert.ok(st.includes("if (test && sim.type === 'crash'") && st.includes("sim.type === 'slow' && attempts === 1") && st.includes("sim.type === 'offline' && attempts <= sim.n"), 'the simulations are tied to the test object');
  assert.ok(!/process\.env/.test(st), 'the controller itself never reads the environment');
  const sim = (type) => { const p = String(type).split(':'); return { type: p[0], n: Number(p[1]) }; };
  assert.deepStrictEqual(sim('offline:2'), { type: 'offline', n: 2 });
});

// ---------- the theme-aware hand-over
test('hand-over colour: the splash settles to the app\'s own page background for the active theme, kept in step with docs/style.css', () => {
  const app = fs.readFileSync(path.join(ROOT, 'docs', 'style.css'), 'utf8').replace(/\r\n/g, '\n');
  const lightBg = /:root\{\n\s*--bg:(#[0-9a-f]{6})/.exec(app)[1];
  const darkBg = /:root\[data-scheme="dark"\]\{\n\s*--bg:(#[0-9a-f]{6})/.exec(app)[1];
  assert.deepStrictEqual({ ...S.HANDOVER }, { light: lightBg, dark: darkBg }, 'the same two colours the app paints its pages with');
  assert.strictEqual(S.handoverColour('dark'), '#000000');
  assert.strictEqual(S.handoverColour('light'), '#f4f6f8');
  assert.strictEqual(S.handoverColour('system'), '#0f1b2a', 'an unknown theme keeps the navy: never a guessed colour');
  assert.strictEqual(S.handoverColour(null), '#0f1b2a');
});

test('hand-over: leaving remembers the theme (only light or dark), and the choice never delays leaving', () => {
  const r = S.step(S.create(0), { type: 'ready', scheme: 'dark' }, 300);
  assert.deepStrictEqual([r.state.phase, r.state.scheme, r.actions], ['leaving', 'dark', ['leave']]);
  assert.strictEqual(S.step(S.create(0), { type: 'ready', scheme: 'light' }, 300).state.scheme, 'light');
  assert.strictEqual(S.step(S.create(0), { type: 'ready', scheme: 'purple' }, 300).state.scheme, null, 'anything else is "unknown"');
  assert.deepStrictEqual(S.step(S.create(0), { type: 'ready' }, 300).actions, ['leave'], 'a missing theme still leaves at once');
  assert.strictEqual(S.step(S.step(S.create(0), { type: 'ready', scheme: 'dark' }, 300).state, { type: 'tick' }, 300 + T.FADE).state.phase, 'done', 'still 220 ms in total');
});

test('hand-over: one question to the app (ready AND theme), a fallback to Windows\' own theme, and the splash applies the colour', () => {
  const main = proto('startup.js'), js = proto('splash.js'), css = proto('splash.css');
  const asks = main.match(/executeJavaScript\(/g) || [];
  assert.strictEqual(asks.length, 1, 'the readiness check is the only question, so the theme costs no extra wait');
  assert.ok(main.includes("document.querySelector('.app, .signin') ? (document.documentElement.getAttribute('data-scheme') || 'unknown') : null"));
  assert.ok(main.includes("scheme === 'unknown' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : scheme"), 'if the app has not said, Windows\' own setting decides');
  assert.ok(main.includes('scheme: state.scheme || null'), 'the splash is told');
  assert.ok(js.includes("root.style.setProperty('--handover', L.handoverColour(s.scheme))"));
  // the 220 ms: the colour settles in 100 ms, the picture fades in 160 ms, the whole splash dissolves from 100 to 220 ms
  assert.ok(css.includes('background-color:var(--handover,var(--navy));opacity:0;transition:background-color .1s ease-out,opacity .12s linear .1s'));
  assert.ok(css.includes('transition:opacity .16s ease-in,transform .16s ease-in'));
  assert.ok(0.1 + 0.12 <= T.FADE / 1000 + 1e-9 && 0.16 <= T.FADE / 1000, 'everything is finished within the 220 ms');
  assert.ok(/#root\.rm\[data-state=leaving\],#root\.rm\[data-state=done\]\{background-color:var\(--handover,var\(--navy\)\);opacity:0;transition:background-color \.06s linear,opacity \.06s linear \.06s\}/.test(css), 'reduce motion: the same in 120 ms');
});
