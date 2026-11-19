'use strict';
// PressGO message effects: the optional sound, the unread count in the window title, and the small "new message" banner
// inside PressGO. Works in a normal browser and in the Windows app. Settings are kept on this computer, per person.
// The rules for WHEN to play a sound live in chatlogic.js (tested); this file only plays and draws.
(function () {
  const L = window.pgChat;
  if (!L) return;
  const base = (document.title || 'PressGO').replace(/^\(\d+\+?\)\s*/, '');
  let uid = null, ctx = null, msgs = 0, alerts = 0;

  const key = () => 'pressgo.sound.v1.' + (uid || 'anon');
  const MODES = ['dm', 'all', 'off'];
  const DEFAULT_MODE = 'all';   // everything on until a person chooses otherwise (a saved choice is never overridden)
  const groupIds = L.ALERT_GROUPS.map((g) => g.id);
  // kept on this computer, per person: sound mode, whether pop-up banners show, and which alert types are switched OFF
  const read = () => {
    try {
      const p = JSON.parse(localStorage.getItem(key())) || {};
      return { mode: MODES.includes(p.mode) ? p.mode : DEFAULT_MODE, banners: p.banners !== false, off: Array.isArray(p.off) ? p.off.filter((g) => groupIds.includes(g)) : [] };
    } catch (e) { return { mode: DEFAULT_MODE, banners: true, off: [] }; }
  };
  const write = (patch) => { try { localStorage.setItem(key(), JSON.stringify({ ...read(), ...patch })); } catch (e) { /* private mode: keep the defaults */ } };
  const mode = () => read().mode;
  const setMode = (m) => write({ mode: MODES.includes(m) ? m : DEFAULT_MODE });

  // a short, gentle two-note ping made on the spot (no sound file to download)
  function ping() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      [[880, 0], [1175, 0.13]].forEach(([f, d]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(t + d); o.stop(t + d + 0.2);
      });
    } catch (e) { /* a sound is optional: it must never break the page */ }
  }

  const retitle = () => { document.title = L.titleWith(base, msgs, alerts); };

  // ---- banner: "Priya in Job #1042 - Approved. Go ahead and print.   [Open]"
  const css = document.createElement('style');
  css.textContent = `
#fxbanners{position:fixed;right:16px;bottom:16px;z-index:60;display:grid;gap:8px;max-width:min(380px,calc(100vw - 32px))}
.fxbn{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r);background:var(--card);color:var(--ink);border:1px solid var(--line-2);box-shadow:var(--sh-3)}
.fxbn .fxt{flex:1;min-width:0;display:grid;line-height:1.3}.fxbn .fxt b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fxbn .fxt span{color:var(--mut);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fxbn a.fxo{flex:none;padding:6px 12px;border-radius:var(--r-sm);background:var(--btn);color:#fff;font-weight:600;text-decoration:none}
.fxbn button{flex:none;border:0;background:none;color:var(--mut);cursor:pointer;padding:4px 6px}`;
  document.head.appendChild(css);

  function banner(o) {
    if (!o || !o.title) return;
    let box = document.getElementById('fxbanners');
    if (!box) { box = document.createElement('div'); box.id = 'fxbanners'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    while (box.children.length >= 3) box.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'fxbn'; el.setAttribute('role', 'status');
    const t = document.createElement('div'); t.className = 'fxt';
    const b = document.createElement('b'); b.textContent = String(o.title).slice(0, 80);
    const s = document.createElement('span'); s.textContent = String(o.body || '').slice(0, 140);
    t.append(b, s); el.appendChild(t);
    if (o.href && /^#\//.test(o.href)) {
      const a = document.createElement('a'); a.className = 'fxo'; a.href = o.href; a.textContent = 'Open';
      a.addEventListener('click', () => { el.remove(); if (typeof o.onOpen === 'function') { try { o.onOpen(); } catch (e) { /* a banner must never break the page */ } } });
      el.appendChild(a);
    }
    const x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '✕';
    x.addEventListener('click', () => el.remove());
    el.appendChild(x);
    box.appendChild(el);
    setTimeout(() => el.remove(), 9000);
  }

  window.pgFx = {
    setUser(id) { uid = id; },
    mode, setMode, ping, banner,
    bannersOn: () => read().banners,
    setBanners: (on) => write({ banners: !!on }),
    alertsOff: () => read().off,
    setAlertsOff: (groups) => write({ off: (groups || []).filter((g) => groupIds.includes(g)) }),
    alertOff: (kind) => read().off.includes(L.alertGroup(kind)),     // is this kind of alert switched off on this computer?
    incoming(row, conv, meId, currentConv) {
      if (L.shouldPlaySound({ meId, row, conv, mode: mode(), currentConv, visible: document.visibilityState === 'visible', focused: document.hasFocus() })) ping();
    },
    unreadMessages(n) { msgs = Number(n) || 0; retitle(); },
    unreadAlerts(n) { alerts = Number(n) || 0; retitle(); },
  };
})();
