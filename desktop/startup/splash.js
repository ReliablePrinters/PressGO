'use strict';
// The splash page's script. It does three small jobs and nothing else:
//   1. show what the state machine (splashlogic.js) says, in words and buttons;
//   2. keep the animation honest: pause it when the window is hidden, and use the quiet version for "reduce motion";
//   3. in the browser preview (?demo=1) stand in for Electron, so the experience can be reviewed without the app.
// Inside the app, the real driver (main.js) sends the state over a tiny bridge (splash-preload.js). No network, no libraries.
(function () {
  const L = window.pgSplash;
  const root = document.getElementById('root');
  const q = new URLSearchParams(location.search);
  const el = (id) => document.getElementById(id);
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let forcedReduced = q.has('reduced');
  const reducedNow = () => forcedReduced || !!(mq && mq.matches);
  const applyReduced = () => root.classList.toggle('rm', reducedNow());
  applyReduced();
  if (mq && mq.addEventListener) mq.addEventListener('change', applyReduced);
  // an animation that nobody can see should not run
  document.addEventListener('visibilitychange', () => root.classList.toggle('paused', document.hidden));

  // ---- what is shown for a state
  let deadline = null;           // local time when the next automatic retry happens (offline), for the "Trying again in N s" words
  let current = null;
  function paint() {
    if (!current) return;
    const s = current;
    root.dataset.state = s.phase;
    if (s.phase === 'leaving') root.style.setProperty('--handover', L.handoverColour(s.scheme));   // the app's own background, light or dark
    const secs = deadline != null ? Math.max(0, Math.ceil((deadline - performance.now()) / 1000)) : null;
    const m = L.messageFor({ ...s, retryAt: secs != null ? 1000 * secs + 0 : null }, 0);
    el('title').textContent = m.title;
    el('body').textContent = m.body;
    const acts = el('actions');
    acts.hidden = !m.actions.length;
    el('retry').textContent = s.phase === 'offline' ? 'Try now' : 'Try again';
    el('quit').hidden = !m.actions.includes('quit');
    if (!acts.hidden && !acts.dataset.focused) { acts.dataset.focused = '1'; el('retry').focus({ preventScroll: true }); }
    if (acts.hidden) delete acts.dataset.focused;
  }
  function onState(s) {
    current = s;
    deadline = s.retryInMs != null ? performance.now() + s.retryInMs : null;
    if (s.reduced) { forcedReduced = true; applyReduced(); }
    paint();
  }
  setInterval(() => { if (current && deadline != null) paint(); }, 250);    // the countdown in the words

  // ---- the bridge: Electron's, or the preview's own
  const host = window.splashHost || makePreviewHost();
  host.onState(onState);
  el('retry').addEventListener('click', () => host.retry());
  el('quit').addEventListener('click', () => host.quit());
  if (host.loaded) host.loaded();

  // ---- browser preview only (?demo=1): a tiny stand-in for the app's main process, so every state can be seen
  function makePreviewHost() {
    const demo = q.has('demo');
    let s = L.create(performance.now()), subs = [], note = '', appTheme = 'light';
    const now = () => performance.now();
    const emit = () => {
      const retryInMs = s.retryAt != null ? Math.max(0, s.retryAt - now()) : null;
      subs.forEach((f) => f({ phase: s.phase, reason: s.reason, code: s.code, attempt: s.attempt, retryInMs, reduced: reducedNow(), scheme: s.scheme || null }));
    };
    const apply = (r) => {
      s = r.state;
      if (r.actions.includes('load')) note = 'loading again…';
      if (r.actions.includes('remove')) note = 'splash removed: the app is showing';
      emit(); setNote(note);
    };
    const send = (ev) => apply(L.step(s, ev, now(), { reduced: reducedNow() }));
    const setNote = (t) => { const n = el('demoNote'); if (n) n.textContent = t; };
    setInterval(() => send({ type: 'tick' }), 100);
    if (demo) {
      el('demo').hidden = false;
      const toggleBeneath = () => {
        const f = el('appbeneath'), b = document.querySelector('[data-do=beneath]');
        f.hidden = !f.hidden; b.setAttribute('aria-pressed', String(!f.hidden));
      };
      document.querySelector('[data-do=beneath]').setAttribute('aria-pressed', 'false');
      el('demo').addEventListener('click', (e) => {
        const b = e.target.closest('[data-do]'); if (!b) return;
        const d = b.dataset.do;
        if (d === 'replay') { s = L.create(now()); root.classList.remove('play'); void root.offsetWidth; root.classList.add('play'); root.dataset.state = 'starting'; note = 'replaying'; emit(); setNote(note); }
        else if (d === 'ready') send({ type: 'ready', scheme: appTheme });
        else if (d === 'theme') { appTheme = appTheme === 'light' ? 'dark' : 'light'; el('appbeneath').classList.toggle('dark', appTheme === 'dark'); b.textContent = 'App theme: ' + appTheme; b.setAttribute('aria-pressed', String(appTheme === 'dark')); }
        else if (d === 'slow') { s = { ...s, phase: 'slow', introDone: true, startedAt: now() - 20000, loadStartedAt: now() - 12100 }; emit(); setNote('slow start'); }
        else if (d === 'offline') send({ type: 'fail', code: -106, isMainFrame: true });
        else if (d === 'fail') send({ type: 'fail', code: -200, isMainFrame: true });
        else if (d === 'reduced') { forcedReduced = !forcedReduced; b.setAttribute('aria-pressed', String(forcedReduced)); applyReduced(); setNote(forcedReduced ? 'reduce motion on' : 'reduce motion off'); }
        else if (d === 'beneath') toggleBeneath();
      });
    }
    return {
      onState: (f) => { subs.push(f); emit(); },
      retry: () => send({ type: 'retry' }),
      quit: () => setNote('Quit (the app would close here)'),
      loaded: () => {}
    };
  }
})();
