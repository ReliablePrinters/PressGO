'use strict';
// PressGO startup: "The PressGO Print Sequence". A local splash page is drawn OVER the app window while the PressGO web app loads
// underneath, and fades out the moment the app has drawn its first screen. Nothing waits for the animation: if the app is ready early,
// the splash leaves early. If the app cannot be reached or stops, the splash says so and offers Try again. See startup/README.md.
//
// How it fits the app: the PressGO page stays in the window's own web contents, so the updater, notifications, context menu, preload
// bridge and every security setting are exactly as before. The splash is one extra view on top of it, removed after the hand-over.
// The splash page is local (no network), sandboxed, and its only bridge (splash-preload.js) can receive a state and ask for a retry or quit.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebContentsView, ipcMain, net, nativeTheme, app } = require('electron');
const L = require('./splashlogic.js');

const SPLASH_NAVY = '#0f1b2a';     // = the app's sidebar navy (docs/style.css --side); also the window's colour while the splash shows

/**
 * @param {object} o
 * @param {Electron.BrowserWindow} o.win          the app window (its own web contents hold the PressGO page)
 * @param {() => void} o.loadApp                   (re)loads the PressGO page
 * @param {string} o.appUrl                        the PressGO address (used only to tell the test build's simulated failures apart)
 * @param {null | object} o.test                   local test builds only: { sim, logFile, shotsDir, shotsAt, exitAfterHandover }
 */
function createStartup(o) {
  const win = o.win, test = o.test || null;
  let splash = null, ticker = null, readyPoll = null, onlineTimer = null, active = false, shown = false, disposed = false;
  let state = L.create(Date.now());
  let attempts = 0, wasOnline = true, crashedOnce = false, failedOnce = false;
  const t0 = Date.now(), events = [];
  let firstReadyAt = null;
  // The splash page follows the Windows "reduce motion" setting by itself; this side only needs it to time the exit (120 ms instead of 220 ms).
  const REDUCED = (() => { try { return !!require('electron').systemPreferences.getAnimationSettings().prefersReducedMotion; } catch (e) { return false; } })();
  const sim = (() => { const p = String((test && test.sim) || '').split(':'); return { type: p[0] || '', n: Number(p[1]) || (p[0] === 'offline' ? 1 : 0), ms: Number(p[1]) || 9000 }; })();

  const log = (m) => {
    if (!test) return;
    const line = '[+' + String(Date.now() - t0).padStart(5, ' ') + ' ms] ' + m;
    try { console.log(line); if (test.logFile) fs.appendFileSync(test.logFile, line + '\n'); } catch (e) { /* logging must never break startup */ }
  };

  function fit() {
    if (!splash || win.isDestroyed()) return;
    const b = win.getContentBounds();
    splash.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
  }

  function sendState() {
    if (!splash || splash.webContents.isDestroyed()) return;
    splash.webContents.send('splash:state', {
      phase: state.phase, reason: state.reason, code: state.code, attempt: state.attempt,
      retryInMs: state.retryAt != null ? Math.max(0, state.retryAt - Date.now()) : null, reduced: REDUCED, scheme: state.scheme || null
    });
  }

  // test builds can make the first load fail or crawl, so every state can be seen by hand
  function startLoad() {
    attempts += 1;
    clearInterval(readyPoll);
    const unreachable = sim.type === 'offline' && attempts <= sim.n;
    const go = () => {
      if (disposed || win.isDestroyed()) return;
      log('loading the app (attempt ' + attempts + ')' + (unreachable ? ' [simulated: unreachable address]' : ''));
      if (unreachable) win.webContents.loadURL('http://127.0.0.1:59871/').catch(() => {});   // nothing listens on this port: connection refused, like being offline
      else o.loadApp();
    };
    if (sim.type === 'slow' && attempts === 1) { log('simulating a slow start: the load begins after ' + sim.ms + ' ms'); setTimeout(go, sim.ms); } else go();
  }

  // "Ready" = the app has drawn its first screen (the dashboard shell or the sign-in page, not a loading skeleton or an error page).
  // The same single question also reads which theme the app is in, so the hand-over can settle to the right background at no extra cost.
  function pollReady() {
    clearInterval(readyPoll);
    readyPoll = setInterval(() => {
      if (disposed || !['starting', 'loading', 'slow'].includes(state.phase) || win.isDestroyed() || win.webContents.isDestroyed() || win.webContents.isCrashed()) { clearInterval(readyPoll); return; }
      win.webContents.executeJavaScript("document.querySelector('.app, .signin') ? (document.documentElement.getAttribute('data-scheme') || 'unknown') : null").then((scheme) => {
        if (scheme !== null) { clearInterval(readyPoll); dispatch({ type: 'ready', scheme: scheme === 'unknown' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : scheme }); }
      }).catch(() => {});
    }, 80);
  }

  function dispatch(ev) {
    if (disposed) return;
    const before = state.phase;
    const r = L.step(state, ev, Date.now(), { reduced: REDUCED });
    state = r.state;
    if (ev.type !== 'tick' || state.phase !== before) {
      log((ev.type !== 'tick' ? 'event ' + ev.type + (ev.code != null ? ' ' + ev.code : '') + (ev.reason ? ' ' + ev.reason : '') : 'state ' + before) + ' -> ' + state.phase);
      events.push({ t: Date.now() - t0, ev: ev.type, from: before, to: state.phase });
    }
    for (const a of r.actions) {
      if (a === 'load') startLoad();
      if (a === 'leave') leave();
      if (a === 'remove') remove();
    }
    if (state.phase !== before || ev.type === 'retry') sendState();
  }

  function leave() {
    if (firstReadyAt == null) firstReadyAt = Date.now() - t0;
    log('the app is ready (' + (state.scheme || 'unknown') + ' theme): the splash settles to ' + L.handoverColour(state.scheme) + ' and fades out now, no waiting for the animation');
    if (splash && !splash.webContents.isDestroyed()) splash.setBackgroundColor('#00000000');   // see-through, so the app shows as it fades
    setTimeout(() => dispatch({ type: 'tick' }), L.T.FADE + 5);                                    // remove it exactly when the fade ends
    if (test && test.shotsDir) { setTimeout(() => capture(win.webContents, 'app-at-handover'), 40); setTimeout(() => capture(splash && splash.webContents, 'splash-mid-fade'), 70); }
  }

  function remove() {
    if (!active) return;
    active = false;
    clearInterval(ticker); clearInterval(readyPoll); clearInterval(onlineTimer);
    if (splash) { try { win.contentView.removeChildView(splash); splash.webContents.close(); } catch (e) { /* already gone */ } splash = null; }
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.focus();
    log('splash removed; the app is showing');
    if (test && test.exitAfterHandover) setTimeout(() => finishTest('ok'), 700);
  }

  // anything goes wrong with the splash itself: show the app plainly, as before the splash existed
  function giveUp(why) {
    log('splash not available (' + why + '): showing the app without it');
    const was = active;
    active = false; clearInterval(ticker);
    if (splash) { try { win.contentView.removeChildView(splash); splash.webContents.close(); } catch (e) { /* ignore */ } splash = null; }
    if (!win.isDestroyed() && !win.isVisible()) win.show();
    if (was && attempts === 0) o.loadApp();
  }

  async function capture(wc, name) {
    if (!test || !test.shotsDir || !wc || wc.isDestroyed()) return;
    try {
      const img = await wc.capturePage();
      fs.mkdirSync(test.shotsDir, { recursive: true });
      fs.writeFileSync(path.join(test.shotsDir, name + '.png'), img.toPNG());
      log('picture saved: ' + name + '.png');
    } catch (e) { log('could not capture ' + name + ': ' + e.message); }
  }

  function finishTest(result) {
    log('test run ' + result + '; first ready at ' + firstReadyAt + ' ms; final state ' + state.phase);
    try {
      if (test.shotsDir) { fs.mkdirSync(test.shotsDir, { recursive: true }); fs.writeFileSync(path.join(test.shotsDir, 'result.json'), JSON.stringify({ result, scenario: sim.type || 'normal', firstReadyMs: firstReadyAt, finalPhase: state.phase, attempts, events }, null, 2)); }
    } catch (e) { /* ignore */ }
    app.exit(0);
  }

  function dispose() {
    disposed = true; active = false;
    clearInterval(ticker); clearInterval(readyPoll); clearInterval(onlineTimer);
  }

  // ---- the messages from the splash page (only from the splash itself)
  const fromSplash = (e) => !!(splash && !splash.webContents.isDestroyed() && e.sender === splash.webContents);
  const onRetry = (e) => { if (fromSplash(e)) dispatch({ type: 'retry' }); };
  const onQuit = (e) => { if (fromSplash(e)) app.quit(); };
  const onLoaded = (e) => { if (fromSplash(e)) log('splash page is drawn'); };
  ipcMain.on('splash:retry', onRetry); ipcMain.on('splash:quit', onQuit); ipcMain.on('splash:loaded', onLoaded);

  return {
    active: () => active,
    // the app page reports (see main.js)
    onFail(code, isMainFrame) { log('app: load failed ' + code + (isMainFrame ? '' : ' (not the page itself)')); dispatch({ type: 'fail', code, isMainFrame }); },
    onGone(reason) { log('app: process gone (' + reason + ')'); dispatch({ type: 'gone', reason }); },
    onDomReady() {
      if (!active) return;
      log('app: dom-ready');
      pollReady();
      if (test && sim.type === 'crash' && !crashedOnce) { crashedOnce = true; setTimeout(() => { log('simulating a crash of the app process during startup'); if (!win.isDestroyed()) win.webContents.forcefullyCrashRenderer(); }, 15); }
    },
    begin() {
      try {
        active = true;
        splash = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, webSecurity: true, preload: path.join(__dirname, 'splash-preload.js') } });
        splash.setBackgroundColor(SPLASH_NAVY);
        win.contentView.addChildView(splash);          // on top of the app
        fit();
        win.on('resize', fit);
        win.on('closed', dispose);
        splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        splash.webContents.on('will-navigate', (e) => e.preventDefault());
        splash.webContents.once('did-fail-load', () => giveUp('could not load splash.html'));
        splash.webContents.once('did-finish-load', () => {
          shown = true;
          if (!win.isDestroyed()) { win.show(); if (splash) splash.webContents.focus(); }   // keys go to the splash, not to the page hidden behind it
          log('window shown with the splash (the app is loading underneath)');
          sendState();
          if (test && test.shotsAt) test.shotsAt.forEach((ms) => setTimeout(() => capture(splash && splash.webContents, 'splash-' + String(ms).padStart(5, '0') + 'ms'), ms));
          if (test && sim.type === 'fail' && !failedOnce) { failedOnce = true; setTimeout(() => { log('simulating a load failure (error -200) during startup'); dispatch({ type: 'fail', code: -200, isMainFrame: true }); }, 40); }
        });
        splash.webContents.loadFile(path.join(__dirname, 'splash.html'));
        setTimeout(() => { if (!shown && !win.isDestroyed() && !win.isVisible()) { win.show(); log('window shown by the safety timer'); } }, 2000);   // never leave the person with no window
        startLoad();                                   // the app starts loading at once, in parallel with the splash drawing
        ticker = setInterval(() => dispatch({ type: 'tick' }), 100);
        onlineTimer = setInterval(() => {              // the operating system says it is back online: try again at once
          const on = net.isOnline();
          if (on && !wasOnline) dispatch({ type: 'online' });
          wasOnline = on;
        }, 1000);
        if (test && test.exitAfterHandover) setTimeout(() => finishTest('timeout'), Number(test.quitAfter) || 40000);
        return true;
      } catch (e) {
        giveUp(e && e.message);
        return false;
      }
    }
  };
}

module.exports = { createStartup, SPLASH_NAVY, tmpLog: () => path.join(os.tmpdir(), 'pressgo-startup-test.log') };
