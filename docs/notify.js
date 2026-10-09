// PressGO desktop message notifications (Windows app only). Decides when a new chat message deserves a Windows
// notification, then asks the desktop app to show it. In a normal browser, or without the desktop app, it does nothing.
// It uses the chat connection PressGO already has: it only ever sees messages the signed-in person is allowed to read,
// because the database filters them before they arrive. No keys or secrets are involved.
(function (root) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DEFAULTS = { mode: 'dm', preview: true };          // dm = private messages and Urgent only
  const FLUSH_MS = 2000;                                    // messages arriving close together become ONE notification
  const MAX_SEEN = 500;

  const oneLine = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

  function createCore(d) {
    const { bridge, getPrefs, getName, isAway, setTimer = setTimeout, now = Date.now } = d;
    const started = now();
    const seen = new Set();
    const pending = new Map();          // conversation id -> { n, last, conv, authors }
    let timer = null;

    function allowed(conv, mode) {
      if (mode === 'off') return false;
      if (mode === 'all') return true;
      return !!conv && (conv.type === 'direct' || conv.type === 'urgent');
    }

    function message(row, conv, meId) {
      if (!bridge || !row || !row.id || !row.conversation_id) return;
      const prefs = getPrefs();
      if (prefs.mode === 'off') return;
      if (row.author_id === meId || row.hidden_at) return;                 // never your own messages, never hidden ones
      if (seen.has(row.id)) return;                                         // same message, never twice
      seen.add(row.id);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
      if (row.sent_at && Date.parse(row.sent_at) < started - 60000) return; // old message, not "new"
      if (!isAway()) return;                                                // you are looking at PressGO right now
      if (!allowed(conv, prefs.mode)) return;
      const p = pending.get(row.conversation_id) || { n: 0, conv, authors: new Set(), last: null };
      p.n += 1; p.last = row; p.conv = conv || p.conv; p.authors.add(row.author_id);
      pending.set(row.conversation_id, p);
      if (!timer) timer = setTimer(flush, FLUSH_MS);
    }

    async function flush() {
      timer = null;
      const batch = [...pending.entries()];
      pending.clear();
      if (!batch.length || !isAway()) return;                               // you came back while we waited
      const prefs = getPrefs();
      const items = [];
      for (const [convId, p] of batch) {
        let who = '';
        try { who = await getName(p.last.author_id); } catch (e) { who = ''; }
        items.push({ convId, p, who: who || 'Someone' });
      }
      if (!isAway()) return;
      if (items.length > 3) {                                               // a flood across many chats: one summary
        const total = items.reduce((a, i) => a + i.p.n, 0);
        bridge.show({ title: 'PressGO', body: `${total} new messages in ${items.length} chats`, conv: items[items.length - 1].convId });
        return;
      }
      for (const { convId, p, who } of items) {
        const c = p.conv || {};
        const where = c.type === 'direct' ? '' : (c.type === 'job' ? c.name : '#' + (c.name || 'chat').replace(/^#\s*/, ''));
        const pic = !!(p.last.attachment_path);
        const text = pic ? 'Sent a picture' : oneLine(p.last.body, 100);
        let title, body;
        if (p.n === 1) {
          title = where ? `${who} in ${where}` : who;
          body = prefs.preview ? text : 'New message';
        } else {
          title = where ? `${p.n} new messages in ${where}` : `${p.n} new messages from ${who}`;
          body = prefs.preview ? `Latest: ${text}` : '';
        }
        bridge.show({ title: oneLine(title, 80), body: oneLine(body, 160), conv: convId });
      }
    }

    return { message, flush, _pending: pending };
  }

  // ---------- browser wiring (only inside the PressGO Windows app) ----------
  function wire() {
    const bridge = root.pressgoDesktop && root.pressgoDesktop.notify;
    if (!bridge) return;
    const doc = root.document;
    let uid = null;
    const key = () => 'pressgo.notify.v1.' + (uid || 'anon');
    const getPrefs = () => {
      try { return { ...DEFAULTS, ...(JSON.parse(root.localStorage.getItem(key())) || {}) }; } catch (e) { return { ...DEFAULTS }; }
    };
    const setPrefs = (p) => { try { root.localStorage.setItem(key(), JSON.stringify(p)); } catch (e) { /* private mode: keep defaults */ } };
    const names = new Map();
    const getName = async (id) => {
      if (names.has(id)) return names.get(id);
      const { data } = await sb.from('employees').select('display_name').eq('id', id).maybeSingle();
      const n = (data && data.display_name) || '';
      if (n) names.set(id, n);
      return n;
    };
    // "Away" = PressGO is minimized, hidden, or not the window you are using.
    const isAway = () => !(doc.visibilityState === 'visible' && doc.hasFocus());
    const core = createCore({ bridge, getPrefs, getName, isAway });

    // Clicking a notification: the desktop app brings PressGO forward, then we open that conversation.
    bridge.onOpen((d) => { if (d && UUID.test(d.conv || '')) root.location.hash = '#/chat/' + d.conv; });

    root.pgNotify = {
      message: (row, conv, me) => { if (me && me.id) { uid = me.id; core.message(row, conv, me.id); } },
      prefs: getPrefs,
      settings(me) {
        if (me && me.id) uid = me.id;
        const p = getPrefs();
        const radio = (v, label, hint) => `<label class="opt"><input type="radio" name="mode" value="${v}" ${p.mode === v ? 'checked' : ''}><span><b>${label}</b><span class="hint">${hint}</span></span></label>`;
        const asked = root.ask('Desktop notifications',
          `<div class="fgroup"><div class="optgrid">${radio('dm', 'Private messages and Urgent', 'Recommended. Quiet, and you will not miss what is aimed at you.')}${radio('all', 'All chats', 'Every new message in every chat you can see.')}${radio('off', 'Off', 'No desktop notifications.')}</div></div>
           <label class="opt" style="margin-top:10px"><input type="checkbox" name="preview" value="1" ${p.preview ? 'checked' : ''}><span><b>Show the message text</b><span class="hint">Untick to show only who sent it, so nothing private appears on screen.</span></span></label>
           <p class="note" style="margin:12px 0 6px">Notifications appear only when PressGO is minimized or you are using another program. They do not appear while PressGO is closed.</p>
           <button type="button" id="ntest">Send a test notification</button> <span class="hint" id="nres"></span>
           <p class="note" style="margin-top:10px">Not seeing anything? Open Windows Settings, then System, then Notifications. Turn on notifications and make sure PressGO is switched on in the list. Windows Focus or Do Not Disturb mode also hides them.</p>`, 'Save');
        const t = root.document.getElementById('ntest');
        if (t) t.onclick = async () => {
          const r = await bridge.show({ title: 'PressGO', body: 'If you can see this, notifications are working.', conv: null, test: true });
          root.document.getElementById('nres').textContent = r && r.ok ? 'Sent. Look at the bottom right of your screen.' : 'Could not send (' + ((r && r.reason) || 'unknown') + ').';
        };
        return asked.then((r) => {
          if (!r) return null;
          const next = { mode: ['dm', 'all', 'off'].includes(r.mode) ? r.mode : 'dm', preview: r.preview === '1' };
          setPrefs(next);
          if (root.pgToast) root.pgToast('Notification settings saved.');
          return next;
        });
      }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { createCore, DEFAULTS };
  if (typeof window !== 'undefined') wire();
})(typeof window !== 'undefined' ? window : globalThis);
