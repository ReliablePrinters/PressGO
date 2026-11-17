'use strict';
// PressGO startup experience: the rules, with no screen and no Electron in them, so they can be tested (desktop/test/splash.test.js).
// One small state machine decides what the splash shows and when it leaves. It never waits for the animation: the moment the app is
// ready it starts leaving, wherever the animation has got to.
//
//   starting  the intro sequence is playing (about 2.2 s) while the app loads in the background
//   loading   the intro has finished and the app is still loading: a calm, restrained state (the intro does NOT replay)
//   slow      still loading after 12 s: the same calm state, plus words and a "Try again" button
//   offline   the app could not be reached (no internet, server down): says so, tries again by itself, and has a "Try now" button
//   failed    the app stopped or could not load for another reason: says so, with Try again and Quit
//   leaving   the app is ready: the splash fades out (220 ms) and the app is already underneath
//   done      the splash is gone
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgSplash = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const T = Object.freeze({
    INTRO: 2300,       // length of the intro sequence (ms)
    SLOW: 12000,       // "taking longer than usual" after this long without the app being ready
    GIVE_UP: 45000,    // stop waiting and offer a retry after this long
    FADE: 220,         // how long the splash takes to leave
    FADE_REDUCED: 120, // the same with "reduce motion"
    RETRY_MS: [3000, 6000, 10000]   // automatic retries when offline: soon, then calmer, then every 10 s
  });

  // Chromium network error numbers (net_error_list.h). -3 is "aborted" (a redirect or a new load started): never an error to show.
  const OFFLINE_CODES = new Set([-100, -101, -102, -105, -106, -109, -118, -7, -21, -130, -324]);
  // -100 closed, -101 reset, -102 refused, -105 name not resolved, -106 internet disconnected, -109 address unreachable,
  // -118 connection timed out, -7 timed out, -21 network changed, -130 proxy failed, -324 empty response
  function classifyFailure(code, isMainFrame) {
    if (isMainFrame === false) return 'ignore';       // a picture or a script failing is not the app failing
    if (code === -3 || code === 0 || code == null) return 'ignore';
    return OFFLINE_CODES.has(code) ? 'offline' : 'failed';
  }

  // During the hand-over the splash's navy settles toward the app's own page background, so the dissolve into the app is one clean
  // step. These are the app's --bg values (light theme and dark theme, docs/style.css); a test keeps them in step.
  const HANDOVER = Object.freeze({ light: '#f4f6f8', dark: '#000000' });
  const handoverColour = (scheme) => HANDOVER[scheme] || '#0f1b2a';

  const retryDelay = (attempt) => T.RETRY_MS[Math.min(Math.max(attempt, 1), T.RETRY_MS.length) - 1];

  const create = (now) => ({ phase: 'starting', startedAt: now, loadStartedAt: now, introDone: false, attempt: 1, retryAt: null, code: null, reason: '', leftAt: null });

  // step(state, event, now, opts) -> { state, actions }.   actions: 'load' (start or restart loading the app), 'leave' (start the fade-out), 'remove' (take the splash away)
  // events: tick | ready | fail {code,isMainFrame} | gone {reason} | retry | online
  function step(s, ev, now, opts) {
    const o = opts || {};
    let n = { ...s }; const actions = [];
    const loadingPhases = ['starting', 'loading', 'slow'];
    switch (ev.type) {
      case 'tick': {
        if (n.phase === 'starting' && now - n.startedAt >= T.INTRO) { n.phase = 'loading'; n.introDone = true; }
        if (n.phase === 'loading' && now - n.loadStartedAt >= T.SLOW) n.phase = 'slow';
        if ((n.phase === 'loading' || n.phase === 'slow') && now - n.loadStartedAt >= T.GIVE_UP) { n.phase = 'failed'; n.reason = 'timeout'; n.code = null; }
        if (n.phase === 'starting' && now - n.loadStartedAt >= T.GIVE_UP) { n.phase = 'failed'; n.reason = 'timeout'; n.code = null; }
        if (n.phase === 'offline' && n.retryAt != null && now >= n.retryAt) { n.attempt += 1; n.retryAt = null; n.loadStartedAt = now; n.phase = n.introDone ? 'loading' : 'starting'; actions.push('load'); }
        if (n.phase === 'leaving' && now - n.leftAt >= (o.reduced ? T.FADE_REDUCED : T.FADE)) { n.phase = 'done'; actions.push('remove'); }
        break;
      }
      case 'ready':
        // As soon as the app is ready the splash leaves, wherever the intro has got to. There is no minimum time.
        if (loadingPhases.includes(n.phase)) { n.phase = 'leaving'; n.leftAt = now; n.scheme = ev.scheme === 'dark' || ev.scheme === 'light' ? ev.scheme : null; actions.push('leave'); }
        break;
      case 'fail': {
        const kind = classifyFailure(ev.code, ev.isMainFrame);
        if (kind === 'ignore' || !loadingPhases.includes(n.phase) && n.phase !== 'offline') break;
        n.code = ev.code;
        if (kind === 'offline') { n.phase = 'offline'; n.reason = 'offline'; n.retryAt = now + retryDelay(n.attempt); }
        else { n.phase = 'failed'; n.reason = 'load'; n.retryAt = null; }
        break;
      }
      case 'gone':
        if (ev.reason === 'clean-exit') break;
        if (loadingPhases.includes(n.phase)) { n.phase = 'failed'; n.reason = 'crashed'; n.code = null; n.retryAt = null; }
        break;
      case 'retry':
      case 'online':
        if (n.phase === 'offline' || n.phase === 'failed' || n.phase === 'slow') {
          n.attempt += 1; n.retryAt = null; n.code = null; n.reason = ''; n.loadStartedAt = now;
          n.phase = n.introDone ? 'loading' : 'starting';     // the intro is never replayed once it has played
          actions.push('load');
        }
        break;
      default: break;
    }
    return { state: n, actions };
  }

  // The words for each state. Plain, short, and the same everywhere (the splash and the tests read these).
  function messageFor(s, now) {
    const secs = s.retryAt != null ? Math.max(0, Math.ceil((s.retryAt - now) / 1000)) : null;
    switch (s.phase) {
      case 'offline':
        return { title: 'You are offline', body: 'PressGO needs an internet connection. Reconnect and it will start by itself.' + (secs != null ? ' Trying again in ' + secs + ' s.' : ''), actions: ['retry'] };
      case 'failed':
        return { title: 'PressGO could not start',
          body: s.reason === 'crashed' ? 'The app stopped while it was starting.' : s.reason === 'timeout' ? 'It is taking far too long to load.' : 'Something stopped the app from loading' + (s.code ? ' (error ' + s.code + ')' : '') + '.',
          actions: ['retry', 'quit'] };
      case 'slow':
        return { title: 'Still starting', body: 'This is taking longer than usual. You can keep waiting or try again.', actions: ['retry'] };
      case 'loading': return { title: 'Starting PressGO', body: '', actions: [] };
      case 'starting': return { title: 'Starting PressGO', body: '', actions: [] };
      default: return { title: '', body: '', actions: [] };
    }
  }

  return { T, HANDOVER, handoverColour, OFFLINE_CODES, classifyFailure, retryDelay, create, step, messageFor };
});
