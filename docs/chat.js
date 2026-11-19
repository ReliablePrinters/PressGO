'use strict';
// PressGO chat, Slack-style: channels and private messages live in the left sidebar, the conversation fills the page.
// Uses helpers from app.js (sb, me, depts, esc, shell, ask, call, alert2, friendly).
(function () {
  // ---- in-app picture viewer: shared by chat pictures (here) and image files on a job (app.js). Never navigates, never opens a tab.
  window.pgViewImage = function (url, alt) {
    if (!url) return;
    if (document.querySelector('dialog.lightbox[open]')) return;   // already showing one (e.g. a double tap)
    const dlg = document.createElement('dialog');
    dlg.className = 'lightbox';
    dlg.setAttribute('aria-label', alt ? 'Picture: ' + alt : 'Picture');
    dlg.innerHTML = '<div class="lb-stage"><span class="lb-msg">Loading…</span></div><button type="button" class="lb-close" aria-label="Close picture">✕ Close</button>';
    const stage = dlg.querySelector('.lb-stage');
    const img = new Image();
    img.alt = alt || 'Picture'; img.draggable = false; img.hidden = true;
    img.onload = () => { stage.querySelector('.lb-msg')?.remove(); img.hidden = false; };
    img.onerror = () => { const m = stage.querySelector('.lb-msg'); if (m) m.textContent = 'This picture could not be loaded.'; };
    stage.appendChild(img);
    img.src = url;
    // click anywhere that is not the picture itself (backdrop, empty stage) closes; Escape is handled by the dialog
    const openedAt = Date.now();   // ignore the tail of the tap that opened it (a double-tap must not flash it shut)
    dlg.addEventListener('click', (e) => { if (e.target !== img && !e.target.closest('.lb-close') && Date.now() - openedAt > 350) dlg.close(); });
    dlg.querySelector('.lb-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => { dlg.remove(); if (!document.querySelector('dialog.lightbox')) document.documentElement.style.overflow = ''; });
    document.body.appendChild(dlg);
    document.documentElement.style.overflow = 'hidden';
    dlg.showModal();
    dlg.querySelector('.lb-close').focus();
  };

  const css = document.createElement('style');
  css.textContent = `
.thread{flex:1;min-width:0;display:flex;flex-direction:column;height:100%;background:var(--bg)}
.thread .th-head{padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card)}
.thread .ttl{font-weight:700;font-size:17px}.thread .sub{color:var(--mut);font-size:13px}
.thread .msgs{flex:1;overflow:auto;padding:10px 20px 6px}
.thread .day{display:flex;align-items:center;gap:10px;margin:14px 0 8px;color:var(--mut);font-size:12px}
.thread .day:before,.thread .day:after{content:"";flex:1;border-top:1px solid var(--line)}
.thread .msg{display:flex;gap:10px;padding:3px 6px;border-radius:8px;margin-top:8px}
.thread .msg.cont{margin-top:0}
.thread .msg:hover{background:color-mix(in srgb,var(--mut) 9%,transparent)}
.thread .av{flex:none;width:36px;height:36px;font-size:13px}
.thread .gut{flex:none;width:36px;text-align:right;color:transparent;font-size:11px;padding-top:3px}
.thread .msg.cont:hover .gut{color:var(--mut)}
.thread .hd{line-height:1.2}.thread .hd .tm{color:var(--mut);font-size:12px;margin-left:6px}
.thread .bd{white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}
.thread .msg.mine .hd b{color:var(--brand)}
.thread form.send{display:flex;gap:8px;align-items:flex-end;padding:10px 16px 14px;background:var(--bg)}
.thread form.send textarea{resize:none;height:44px;max-height:140px;border-radius:12px;padding:11px 14px;background:var(--card)}
.thread form.send button{height:44px;border-radius:12px}
.thread .empty{margin:auto;text-align:center;color:var(--mut);padding:30px}
.thread .empty h3{color:var(--ink);margin:0 0 6px}
.thread .th-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.thread .th-ic{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:color-mix(in srgb,var(--brand) 10%,var(--card));color:var(--brand);font-weight:800}
.thread .tt{font-size:17px}.thread .th-l .sub{margin-top:3px}
.thread .th-job{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:var(--r-sm);background:var(--btn);color:#fff;font-weight:600;font-size:13.5px;white-space:nowrap}
.thread .th-job:hover{background:var(--btn-h);text-decoration:none}
.pstat{font-weight:600}.pstat:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#8b93a7}
.pstat.st-on:before,.pstat.on:before{background:#22c55e}.pstat.st-break:before{background:#f5a524}
.msk{display:grid;gap:18px;padding:12px 0}.msk i{display:block;height:44px;border-radius:12px;max-width:70%;background:linear-gradient(90deg,color-mix(in srgb,var(--mut) 10%,var(--bg)) 25%,color-mix(in srgb,var(--mut) 20%,var(--bg)) 50%,color-mix(in srgb,var(--mut) 10%,var(--bg)) 75%);background-size:200% 100%;animation:pgsk 1.3s linear infinite}.msk i:nth-child(2){max-width:50%}
.thread .acts{position:absolute;top:-10px;right:46px;display:none;gap:2px;background:var(--card);border:1px solid var(--line-2);border-radius:var(--r-sm);padding:2px;box-shadow:var(--sh-1)}
.thread .msg:hover .acts,.thread .msg:focus-within .acts{display:flex}
.thread .acts button{border:0;background:none;color:var(--mut);padding:4px 8px;height:auto;border-radius:6px;cursor:pointer;font-size:12.5px;display:inline-flex;align-items:center;gap:5px}
.thread .acts button:hover,.thread .acts button:focus-visible{background:color-mix(in srgb,var(--brand) 12%,transparent);color:var(--ink)}
.thread .quote{display:block;width:100%;max-width:560px;text-align:left;margin:0 0 4px;padding:5px 10px;height:auto;border:0;border-left:3px solid var(--brand);border-radius:6px;background:color-mix(in srgb,var(--mut) 10%,transparent);color:var(--mut);font-size:13px;line-height:1.35;cursor:pointer}
.thread .quote b{display:block;color:var(--ink);font-size:12.5px}.thread .quote span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread .quote.gone{cursor:default;font-style:italic}
.thread .msg.hl{animation:pghl 2.6s ease-out}
@keyframes pghl{0%,55%{background:color-mix(in srgb,var(--brand) 22%,transparent);box-shadow:0 0 0 2px var(--brand)}100%{background:transparent;box-shadow:0 0 0 2px transparent}}
@media (prefers-reduced-motion:reduce){.thread .msg.hl{animation:none;background:color-mix(in srgb,var(--brand) 18%,transparent)}}
.thread .newdiv{display:flex;align-items:center;gap:10px;margin:14px 0 6px;color:var(--brand);font-size:12px;font-weight:700}
.thread .newdiv:before,.thread .newdiv:after{content:"";flex:1;border-top:1px solid var(--brand)}
.thread .replybar{display:flex;align-items:center;gap:10px;margin:0 16px;padding:7px 12px;border-left:3px solid var(--brand);border-radius:8px;background:var(--card);color:var(--mut);font-size:13px}
.thread .replybar[hidden]{display:none}
.thread .replybar .rb{flex:1;min-width:0;display:grid}.thread .replybar .rb b{color:var(--ink)}.thread .replybar .rb span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.thread .replybar button{border:0;background:none;color:var(--mut);cursor:pointer;padding:4px 8px;height:auto;font-size:15px}
.thread .th-r{display:flex;align-items:center;gap:8px}
@media(hover:none){.thread .acts{display:flex;position:static;margin-top:4px;border:0;box-shadow:none;background:none;padding:0}}
`;
  document.head.appendChild(css);

  let timer = null, sideTimer = null, rt = null, current = null, convs = [], tch = null, clearTyper = null, curType = null;
  let divAt = null, lastMsgs = [], viewLimit = 200;      // when you last read the open chat (for the "New messages" line); the messages on screen; how far back they reach
  const L = window.pgChat;                               // message-link, reply and unread rules (chatlogic.js, tested)
  const names = new Map();
  async function nameOf(id) {
    if (names.has(id)) return names.get(id);
    const { data } = await sb.from('employees').select('display_name').eq('id', id).maybeSingle();
    const n = (data && data.display_name) || '';
    if (n) names.set(id, n);
    return n;
  }
  // the page and the Windows window must be the thing you are actually using for a message to count as seen
  const inUse = () => document.visibilityState === 'visible' && document.hasFocus();
  const onVis = () => { if (document.visibilityState === 'visible' && current) loadThread(current); };   // coming back marks the chat read

  const color = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 50% 30%)`; };   // dark enough that the white initials stay readable on every hue (4.5:1)
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  // The coloured initials circle is the default avatar. If this person has set a picture (see profile.js) it is drawn on top of the circle.
  const avatar = (n, s) => { const pic = window.pgAvatarUrl ? window.pgAvatarUrl(n) : null; return `<span class="av ${stClass(n)}" data-n="${esc(n)}" style="background:${color(n)}${s ? `;width:${s}px;height:${s}px;font-size:${Math.max(9, Math.round(s * 0.38))}px` : ''}" title="${esc(n)}">${esc(initials(n))}${pic ? `<img src="${esc(pic)}" alt="" draggable="false">` : ''}</span>`; };
  window.pgAvatar = avatar;
  const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayLabel = (d) => {
    const t = new Date(d), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
    return t.toDateString() === n.toDateString() ? 'Today' : t.toDateString() === y.toDateString() ? 'Yesterday'
      : t.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  };

  window.chatLeave = function () {
    document.removeEventListener('visibilitychange', onVis);
    if (timer) { clearInterval(timer); timer = null; }
    if (tch) { sb.removeChannel(tch); tch = null; }
    clearTyper = null;
    current = null;
  };

  async function loadList() {
    const { data, error } = await sb.rpc('my_conversations');
    if (error) throw error;
    return data || [];
  }


  // ---------------------------------------------------------------- online / on break / offline marks
  const onlineNames = new Set(), breakNames = new Set();
  let presCh = null, statTimer = null;
  const stClass = (n) => (onlineNames.has(n) ? (breakNames.has(n) ? 'st-break' : 'st-on') : 'st-off');
  const stText = (n) => ({ 'st-on': 'Online', 'st-break': 'On break', 'st-off': 'Offline' }[stClass(n)]);
  function paintStatus() {
    document.querySelectorAll('.av[data-n]').forEach((a) => {
      a.classList.remove('st-on', 'st-break', 'st-off');
      a.classList.add(stClass(a.dataset.n));
      a.title = a.dataset.n + ' - ' + stText(a.dataset.n);
    });
    document.querySelectorAll('.pstat[data-n]').forEach((e) => { const c = stClass(e.dataset.n); e.className = 'pstat ' + c; e.textContent = stText(e.dataset.n); });
    const on = document.getElementById('onl'); if (on) { on.textContent = `${onlineNames.size} online`; on.className = 'pstat ' + (onlineNames.size ? 'on' : 'st-off'); }
    const b = document.getElementById('brk');
    if (b && me) { const on = breakNames.has(me.display_name); b.textContent = on ? 'Back from break' : 'Take a break'; b.className = on ? 'brk on' : 'brk'; }
  }
  async function loadBreaks() {
    try {
      const { data } = await sb.from('employee_status').select('break_since,emp:employee_id(display_name)');
      breakNames.clear();
      (data || []).forEach((r) => { if (r.break_since && r.emp) breakNames.add(r.emp.display_name); });
      paintStatus();
    } catch (e) { /* keep what we have */ }
  }
  function ensurePresence() {
    if (presCh || !me) return;
    const key = me.display_name;
    presCh = sb.channel('presence-all', { config: { presence: { key } } })
      .on('presence', { event: 'sync' }, () => {
        onlineNames.clear();
        Object.keys(presCh.presenceState()).forEach((k) => onlineNames.add(k));
        paintStatus();
      })
      .on('postgres_changes', { event: '*', schema: 'pressgo', table: 'employee_status' }, loadBreaks)
      .subscribe((s) => { if (s === 'SUBSCRIBED') presCh.track({ at: Date.now() }); });
    loadBreaks();
    statTimer = setInterval(() => { if (me) loadBreaks(); }, 60000);
  }

  // ---------------------------------------------------------------- sidebar (channels + private messages)
  function renderSide() {
    if (window.pgFx) window.pgFx.unreadMessages(convs.reduce((a, c) => a + (Number(c.unread) || 0), 0));   // unread total in the window title
    const box = document.getElementById('sidechats');
    if (!box) return;
    const item = (c, pre) => `<a class="nav ch ${c.id === current ? 'on' : ''} ${Number(c.unread) ? 'unread' : ''}" href="#/chat/${c.id}"><span class="nm">${c.type === 'direct' ? avatar(c.name, 22) : ''}${pre}${esc(c.name || '')}</span>${Number(c.unread) ? `<span class="dot">${c.unread}</span>` : ''}</a>`;
    const chans = convs.filter((c) => ['general', 'urgent', 'department'].includes(c.type));
    const jobs = convs.filter((c) => c.type === 'job').slice(0, 8);
    const dms = convs.filter((c) => c.type === 'direct');
    box.innerHTML = `<button type="button" id="brk" class="brk">Take a break</button><h4>Channels${window.pgShortcuts ? window.pgShortcuts.hintHtml('messages') : ''}</h4>${chans.map((c) => item(c, '# ')).join('') || '<div class="note" style="padding:4px 10px">Loading…</div>'}
      ${jobs.length ? `<h4>Job chats</h4>${jobs.map((c) => item(c, '')).join('')}` : ''}
      <h4>Direct messages <button id="sidenew" title="New private message">+</button></h4>
      ${dms.map((c) => item(c, '')).join('') || '<div class="note" style="padding:4px 10px">No private messages yet.</div>'}`;
    box.querySelector('#sidenew').onclick = newDirect;
    box.querySelector('#brk').onclick = async () => {
      try { await call('set_break', { p_on: !breakNames.has(me.display_name) }); await loadBreaks(); } catch (e) { window.pgToast(friendly(e), 'error'); }
    };
    paintStatus();
  }
  // A new message arrived (from the live connection). Desktop notification when you are away, a sound when the rules say so,
  // and a small banner when it is private or urgent and you are not already reading that chat.
  async function onNewMessage(row) {
    try {
      let conv = convs.find((x) => x.id === row.conversation_id);
      if (!conv) { convs = await loadList(); conv = convs.find((x) => x.id === row.conversation_id); }   // a chat that did not exist a moment ago
      if (window.pgNotify) window.pgNotify.message(row, conv, me);
      if (row.author_id === me.id || row.hidden_at) return;
      if (window.pgFx) window.pgFx.incoming(row, conv, me.id, current);
      const reading = current === row.conversation_id && inUse();
      if (!reading && window.pgFx && window.pgFx.bannersOn() && conv && L.soundAllowed(conv, 'dm')) {
        const who = (await nameOf(row.author_id)) || 'Someone';
        const where = conv.type === 'direct' ? '' : (conv.type === 'job' ? ' in ' + conv.name : ' in #' + String(conv.name || 'chat').replace(/^#\s*/, ''));
        window.pgFx.banner({ title: who + where, body: row.attachment_path ? 'Sent a picture' : row.body, href: L.chatHref(row.conversation_id, row.id) });
      }
    } catch (e) { /* a notification must never break chat */ }
  }
  function ensureRealtime() {
    if (rt) return;
    rt = sb.channel('chat-all').on('postgres_changes', { event: '*', schema: 'pressgo', table: 'messages' }, (p) => {
      if (clearTyper && p.eventType === 'INSERT') clearTyper(p.new.author_id);
      if (p.eventType === 'INSERT') onNewMessage(p.new);                       // sound / banner / (Windows app) desktop notification
      if (p.new.conversation_id === current) loadThread(current); else window.chatSidebar();
    }).subscribe();
  }
  window.chatSidebar = async function () {
    if (!me) return;
    renderSide();
    try { convs = await loadList(); renderSide(); } catch (e) { /* keep what we have */ }
    ensureRealtime();
    ensurePresence();
    if (!sideTimer) sideTimer = setInterval(() => { if (me) window.chatSidebar(); }, 30000);
  };
  window.chatBadge = window.chatSidebar;

  // ---------------------------------------------------------------- conversation
  // ---- pictures: private bucket, short-lived links, cached so the 8-second refresh does not re-sign them
  const picUrls = {};
  async function signPics(paths) {
    const need = paths.filter((p) => !picUrls[p] || picUrls[p].exp < Date.now());
    if (!need.length) return;
    const { data } = await sb.storage.from('chat-files').createSignedUrls(need, 3600);
    (data || []).forEach((r) => { if (r.signedUrl) picUrls[r.path] = { url: r.signedUrl, exp: Date.now() + 50 * 60000 }; });
  }
  // shrink big phone photos before upload (max 1600px, JPEG) so they send fast and stay under the limit
  function shrink(file) {
    return new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 300000) return resolve(file);
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(u);
        c.toBlob((b) => resolve(b && b.size < file.size ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(u); resolve(file); };
      img.src = u;
    });
  }
  const picHtml = (m) => {
    const u = picUrls[m.attachment_path]?.url;
    const cap = m.body && m.body !== 'Photo' ? `<div>${esc(m.body)}</div>` : '';
    return (u ? `<img class="pic" src="${esc(u)}" alt="${esc(m.attachment_name || 'photo')}" loading="lazy" role="button" tabindex="0" data-view="${esc(u)}" title="Click to enlarge">` : '<div class="note">Picture unavailable</div>') + cap;
  };

  const canApprove = () => me.manager_role || me.front_desk;
  const apprHtml = (m) => {
    if (m.approved_at) {
      const by = m.approver?.display_name || 'someone';
      const back = (m.approved_by === me.id || me.manager_role) ? ` <button type="button" class="lnk" data-unappr="${m.id}">Take back</button>` : '';
      return `<div class="appr ok">&#10003; Approved by <b>${esc(by)}</b> &middot; ${esc(timeOf(m.approved_at))}${back}</div>`;
    }
    if (canApprove() && m.author_id !== me.id) return `<div class="appr"><button type="button" class="primary sm" data-appr="${m.id}">&#10003; Approve</button> <span class="note">Approving tells the sender (and the job owner) to go ahead.</span></div>`;
    return '<div class="appr wait">Waiting for approval</div>';
  };
  const bodyHtml = (m) => (m.hidden_at ? '<i class="gone">This message was deleted</i>' : m.attachment_path ? picHtml(m) + apprHtml(m) : esc(m.body));
  const delBtn = (m) => (!m.hidden_at && (m.author_id === me.id || (me.manager_role && curType !== 'direct'))
    ? `<button type="button" class="del" data-del="${m.id}" title="Delete message" aria-label="Delete message"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button>` : '');

  // the little quoted preview above a reply: who wrote the original and what it said; clicking it jumps to the original
  const quoteHtml = (m) => {
    if (!m.reply_to_id || m.hidden_at) return '';
    const q = L.quoteInfo(m.reply);
    return `<button type="button" class="quote${q.gone ? ' gone' : ''}"${q.gone || !q.id ? ' disabled' : ` data-jump="${esc(q.id)}"`} aria-label="${q.gone ? 'The message this replies to is not available' : 'Go to the message this replies to'}"><b>${esc(q.who || 'Message')}</b><span>${esc(q.preview)}</span></button>`;
  };
  // Replying with TEXT already works with the older database (send_message has taken a reply since the start). What needs database update 0018 is
  // replying with a PICTURE and "Mark as unread": until it is applied those two are not offered (see caps.js); afterwards they appear by themselves.
  const capOn = (name) => !window.pgCaps || window.pgCaps.has(name);
  const actsHtml = (m) => (m.hidden_at ? '' : `<span class="acts"><button type="button" data-reply="${m.id}" title="Reply" aria-label="Reply to this message"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v3"/></svg>Reply</button>${m.author_id !== me.id && capOn('links') ? `<button type="button" data-unread-from="${m.id}" title="Mark as unread from here" aria-label="Mark as unread from this message">Mark unread</button>` : ''}</span>`);
  // scroll a message into the middle of the screen and flash it so it is easy to spot
  let lastFlash = null;
  function flash(el) {
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('hl'); void el.offsetWidth; el.classList.add('hl');
    lastFlash = { id: el.dataset.mid, at: Date.now() };
    setTimeout(() => el.classList.remove('hl'), 2800);
  }
  async function jumpTo(id) {
    const box = document.getElementById('msgs');
    const el = box && box.querySelector(`[data-mid="${id}"]`);
    if (el) return flash(el);
    if (current) await loadThread(current, { target: id });      // older than what is on screen: load back to it
  }
  // used by the router so a link to a message in the chat you already have open just scrolls, without rebuilding the page
  window.chatSameConv = function (hash) {
    const p = L.parseChatHash(hash);
    if (!p || !p.conv || p.conv !== current || !document.getElementById('msgs')) return false;
    if (p.msg) jumpTo(p.msg);
    return true;
  };

  async function loadThread(conv, opts = {}) {
    let limit = Math.max(200, viewLimit), missing = false;      // a chat opened at an old message keeps reaching back that far while it stays open
    if (opts.target) {
      // make sure the page of messages we load reaches back to the one we want (never the whole history)
      const { data: t } = await sb.from('messages').select('sent_at').eq('id', opts.target).eq('conversation_id', conv).maybeSingle();
      if (t) {
        const { count } = await sb.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv).gte('sent_at', t.sent_at);
        limit = Math.max(limit, L.windowSize(count, 200, 600));
        viewLimit = limit;
      } else missing = true;
    }
    const { data, error } = await sb.from('messages')
      .select('id,body,sent_at,author_id,reply_to_id,attachment_path,attachment_name,hidden_at,approved_by,approved_at,author:author_id(display_name),approver:approved_by(display_name),reply:reply_to_id(id,body,hidden_at,attachment_path,author:author_id(display_name))')
      .eq('conversation_id', conv).order('sent_at', { ascending: false }).limit(limit);
    const box = document.getElementById('msgs');
    if (!box || current !== conv) return;
    if (error) { box.innerHTML = `<div class="err">${esc(friendly(error))}</div>`; return; }
    const msgs = (data || []).reverse();
    lastMsgs = msgs;
    await signPics(msgs.filter((m) => m.attachment_path).map((m) => m.attachment_path));
    if (current !== conv) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const unreadAt = L.firstUnreadIndex(msgs, divAt, me.id);
    let lastDay = '', lastAuthor = '', lastT = 0;
    box.innerHTML = msgs.map((m, i) => {
      let h = '';
      const day = new Date(m.sent_at).toDateString(), t = +new Date(m.sent_at);
      if (day !== lastDay) { h += `<div class="day"><span>${esc(dayLabel(m.sent_at))}</span></div>`; lastAuthor = ''; }
      if (i === unreadAt) { h += '<div class="newdiv" id="newdiv" role="separator"><span>New messages</span></div>'; lastAuthor = ''; }
      const cont = m.author_id === lastAuthor && t - lastT < 5 * 60000;
      lastDay = day; lastAuthor = m.author_id; lastT = t;
      const name = m.author_id === me.id ? 'You' : (m.author?.display_name || '?');
      const inner = `${quoteHtml(m)}${bodyHtml(m)}${delBtn(m)}${actsHtml(m)}`;
      h += cont
        ? `<div class="msg cont ${m.author_id === me.id ? 'mine' : ''}" data-mid="${m.id}"><span class="gut">${esc(timeOf(m.sent_at))}</span><div class="bd">${inner}</div></div>`
        : `<div class="msg ${m.author_id === me.id ? 'mine' : ''}" data-mid="${m.id}">${avatar(name === 'You' ? me.display_name : name)}<div><div class="hd"><b>${esc(name)}</b><span class="tm">${esc(timeOf(m.sent_at))}</span></div><div class="bd">${inner}</div></div></div>`;
      return h;
    }).join('') || '<div class="empty"><h3>No messages yet</h3>Say hello below.</div>';
    if (opts.target) {
      const el = missing ? null : box.querySelector(`[data-mid="${opts.target}"]`);
      if (el) flash(el);
      else { window.pgToast('That message is no longer available.', 'error'); box.scrollTop = box.scrollHeight; }
    } else if (atBottom || box.dataset.first !== '1') box.scrollTop = box.scrollHeight;
    if (lastFlash && Date.now() - lastFlash.at < 2800) {      // the list was redrawn while the flash was running: carry on where it left off
      const f = box.querySelector(`[data-mid="${lastFlash.id}"]`), done = Date.now() - lastFlash.at;
      if (f && !f.classList.contains('hl')) { f.style.animationDelay = '-' + done + 'ms'; f.classList.add('hl'); setTimeout(() => f.classList.remove('hl'), 2800 - done); }
    }
    box.dataset.first = '1';
    // only count the chat as read when you can actually see it (not while PressGO is hidden behind other windows)
    if (document.visibilityState === 'visible') {
      await sb.rpc('mark_read', { p_conv: conv });
      convs = convs.map((c) => (c.id === conv ? { ...c, unread: 0 } : c));
      renderSide();
    }
  }

  async function newDirect() {
    const opts = '<option value="">Pick a department…</option>' + depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('') + '<option value="all">All staff</option>';
    const go = async (ids) => {
      dlg.close();
      try { location.hash = '#/chat/' + (await call('start_chat', { p_people: ids })); } catch (e) { window.pgToast(friendly(e), 'error'); }
    };
    const asked = ask('New private message',
      `<label>Department<select name="grp">${opts}</select></label><div id="pp" class="note">Pick a department. Then click one person to message just them, or message everyone in it. Only you and the people you message can see it.</div>`, 'Cancel');
    dlg.querySelector('button.primary').style.display = 'none';
    const sel = dlg.querySelector('[name=grp]'), pp = dlg.querySelector('#pp');
    sel.onchange = async () => {
      if (!sel.value) { pp.textContent = 'Pick a department.'; return; }
      pp.textContent = 'Loading…';
      let list;
      if (sel.value === 'all') {
        const { data } = await sb.from('employees').select('id,display_name').eq('active', true).order('display_name');
        list = (data || []).map((x) => ({ employee_id: x.id, display_name: x.display_name }));
      } else ({ data: list } = await sb.rpc('department_staff', { p_dept: sel.value }));
      list = (list || []).filter((x) => x.employee_id !== me.id);
      pp.className = '';
      if (!list.length) { pp.innerHTML = '<span class="note">Nobody else is in this department yet.</span>'; return; }
      const label = sel.options[sel.selectedIndex].text;
      pp.innerHTML = `<button type="button" class="primary" id="msgall" style="width:100%;margin-bottom:8px">Message everyone in ${esc(label)} (${list.length})</button>`
        + `<div class="note" style="margin-bottom:4px">…or just one person:</div>`
        + list.map((x) => `<button type="button" data-id="${x.employee_id}" style="display:block;width:100%;text-align:left;margin-bottom:6px">${esc(x.display_name)}</button>`).join('');
      pp.querySelector('#msgall').onclick = () => go(list.map((x) => x.employee_id));
      pp.querySelectorAll('button[data-id]').forEach((b) => { b.onclick = () => go([b.dataset.id]); });
    };
    await asked;
  }

  window.viewChat = async function (hash) {
    window.chatLeave();
    viewLimit = 200;                                    // a fresh chat starts with the usual window
    let conv = null, target = null;
    const ph = L.parseChatHash(hash);                   // #/chat/<chat>, #/chat/<chat>/<message> or #/chat/job/<job>
    if (ph && ph.conv) { conv = ph.conv; target = ph.msg; }
    if (ph && ph.job) {
      const { data } = await sb.from('conversations').select('id').eq('job_id', ph.job).maybeSingle();
      if (data) { location.hash = L.chatHref(data.id); return; }
      return shell('chat', '<div class="card"><h2>Job chat</h2><p class="note">This job\'s chat isn\'t available to you.</p><a href="#/jobs">Back to jobs</a></div>');
    }
    shell('chat', '');
    let list = convs;
    try { list = await loadList(); convs = list; } catch (e) { return shell('chat', `<div class="card err">${esc(friendly(e))}</div>`); }
    let info = conv ? list.find((c) => c.id === conv) : null;
    if (conv && !info) {
      // a job chat nobody has written in yet is not in the list: look it up so it can still be opened
      const { data: c } = await sb.from('conversations').select('id,type,name,job_id').eq('id', conv).maybeSingle();
      if (c) {
        let name = c.name;
        if (c.type === 'job') { const { data: j } = await sb.from('jobs').select('job_number,customer_name').eq('id', c.job_id).maybeSingle(); name = j ? `Job #${j.job_number} · ${j.customer_name}` : 'Job chat'; }
        info = { ...c, name, unread: 0 };
      } else conv = null;
    }
    current = conv;
    curType = info ? info.type : null;
    renderSide();
    document.querySelector('.content').classList.add('chatmode');
    const main = document.querySelector('main');
    if (!conv) {
      main.innerHTML = `<div class="thread"><div class="empty"><h3>Messages</h3>Pick a channel or a person on the left,<br>or start a private message with the + button.<br><br><button class="primary" id="newdm">+ New private message</button></div></div>`;
      document.getElementById('newdm').onclick = newDirect;
      return;
    }
    const isChan = ['general', 'urgent', 'department'].includes(info.type);
    const sub = info.type === 'direct' ? 'Private conversation — only the people in this chat can see it'
      : info.type === 'job' ? 'Everyone working on this job'
      : info.type === 'department' ? 'Department channel — this department and managers' : info.type === 'urgent' ? 'Urgent updates for everyone' : 'Everyone at PressGO';
    const who = info.type === 'direct' ? `<span class="pstat" data-n="${esc(info.name)}"></span>` : `<span class="pstat on" id="onl"></span>`;
    main.innerHTML = `<div class="thread"><div class="th-head"><div class="th-l"><div class="ttl">${info.type === 'direct' ? avatar(info.name, 34) : `<span class="th-ic">${isChan ? '#' : window.pgIcon('jobs')}</span>`}<span class="tt">${esc(info.name || '')}</span></div><div class="sub">${sub} · ${who}</div></div><div class="th-r">${capOn('links') ? '<button type="button" class="sm" id="mkun" title="Mark this chat as unread and go back to the list">Mark as unread</button>' : ''}${info.type === 'job' && info.job_id ? `<a class="th-job" href="#/job/${info.job_id}">${window.pgIcon('jobs')} Open job</a>` : ''}</div></div>
      <div class="msgs" id="msgs"><div class="msk" aria-busy="true" aria-label="Loading messages"><i></i><i></i><i></i></div></div>
      <div class="typing" id="typing" hidden></div>
      <div class="pend" id="pend" hidden></div>
      <div class="replybar" id="replybar" hidden></div>
      <form class="send" id="sendf"><button type="button" class="clip" id="clip" title="Add a picture" aria-label="Add a picture"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg></button><input type="file" id="pic" accept="image/*" hidden><textarea name="body" maxlength="4000" rows="1" placeholder="Message ${esc(info.name || '')}"></textarea><button class="primary" type="submit">Send</button></form></div>`;
    // when did I last read this chat? (before opening it marks it read) - the "New messages" line goes after that moment
    divAt = null;
    try { const { data: rd } = await sb.from('conversation_reads').select('last_read_at').eq('conversation_id', conv).maybeSingle(); divAt = rd ? rd.last_read_at : null; } catch (e) { /* no marker, that is fine */ }
    document.addEventListener('visibilitychange', onVis);
    await loadThread(conv, { target });
    paintStatus();
    const f = document.getElementById('sendf'), ta = f.body;
    if (!target) ta.focus();
    // ---- replying: pick a message, a bar shows who and what you reply to, Esc or x cancels
    let replyTo = null;
    const rbar = document.getElementById('replybar');
    const setReply = (r) => {
      replyTo = r;
      if (!r) { rbar.hidden = true; rbar.innerHTML = ''; ta.placeholder = 'Message ' + (info.name || ''); return; }
      rbar.hidden = false;
      rbar.innerHTML = `<div class="rb"><span>Replying to <b>${esc(r.who)}</b></span><span>${esc(r.preview)}</span></div><button type="button" id="rbx" aria-label="Cancel reply" title="Cancel reply">✕</button>`;
      rbar.querySelector('#rbx').onclick = () => { setReply(null); ta.focus(); };
      ta.placeholder = 'Write your reply';
      ta.focus();
    };
    const mkun = document.getElementById('mkun');   // not there until database update 0018 is applied
    if (mkun) mkun.onclick = async () => {
      try { await call('mark_unread', { p_conv: conv }); window.pgToast('Marked as unread.'); location.hash = '#/chat'; window.chatSidebar(); }
      catch (e) { if (window.pgCaps && window.pgCaps.isMissing(e)) window.pgCaps.markMissing('links'); window.pgToast(friendly(e), 'error'); }
    };
    ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
    ta.onkeydown = (e) => {
      if (e.key === 'Escape' && replyTo) { e.preventDefault(); setReply(null); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); }
    };
    const msgsEl = document.getElementById('msgs');
    msgsEl.onkeydown = (e) => {
      const pv = e.target.closest?.('[data-view]');
      if (pv && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); window.pgViewImage(pv.dataset.view, pv.getAttribute('alt')); }
    };
    msgsEl.onclick = async (e) => {
      const pv = e.target.closest('[data-view]');
      if (pv) { e.preventDefault(); window.pgViewImage(pv.dataset.view, pv.getAttribute('alt')); return; }
      const rp = e.target.closest('[data-reply]');
      if (rp) {
        const rm = lastMsgs.find((x) => x.id === rp.dataset.reply);
        if (rm) setReply({ id: rm.id, who: rm.author_id === me.id ? 'yourself' : (rm.author?.display_name || 'someone'), preview: L.quoteInfo(rm).preview });
        return;
      }
      const jp = e.target.closest('[data-jump]');
      if (jp) { jumpTo(jp.dataset.jump); return; }
      const uf = e.target.closest('[data-unread-from]');
      if (uf) {
        try { await call('mark_unread', { p_conv: conv, p_msg: uf.dataset.unreadFrom }); window.pgToast('Marked as unread from that message.'); location.hash = '#/chat'; window.chatSidebar(); }
        catch (err) { if (window.pgCaps && window.pgCaps.isMissing(err)) window.pgCaps.markMissing('links'); window.pgToast(friendly(err), 'error'); }
        return;
      }
      const ap = e.target.closest('[data-appr],[data-unappr]');
      if (ap) {
        const un = !!ap.dataset.unappr;
        if (un && !(await ask('Take back approval?', '<p>The picture will go back to "Waiting for approval".</p>', 'Take back'))) return;
        try { await call('approve_picture', { p_msg: un ? ap.dataset.unappr : ap.dataset.appr, p_approve: !un }); await loadThread(conv); window.chatSidebar(); }
        catch (err) { window.pgToast(friendly(err), 'error'); }
        return;
      }
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const yes = await ask('Delete this message?', '<p>Everyone in this chat will see "This message was deleted". This cannot be undone.</p>', 'Delete');
      if (!yes) return;
      try { await call('delete_message', { p_msg: b.dataset.del }); await loadThread(conv); window.chatSidebar(); }
      catch (err) { window.pgToast(friendly(err), 'error'); }
    };
    // "Ana is typing..." : tiny live signals sent between the people who have this chat open (nothing is saved)
    const typers = new Map(); let lastSent = 0;
    const tbox = document.getElementById('typing');
    const drawTyping = () => {
      const now = Date.now();
      for (const [k, v] of typers) if (v.until < now) typers.delete(k);
      const names = [...typers.values()].map((v) => v.name);
      if (!names.length) { tbox.hidden = true; tbox.innerHTML = ''; return; }
      const who = names.length === 1 ? names[0] : names.length === 2 ? names.join(' and ') : 'Several people';
      tbox.hidden = false;
      tbox.innerHTML = `${names.slice(0, 3).map((n) => avatar(n, 20)).join('')}<span><b>${esc(who)}</b> ${names.length === 1 ? 'is' : 'are'} typing</span><i class="dots"><b></b><b></b><b></b></i>`;
    };
    clearTyper = (id) => { if (typers.delete(id)) drawTyping(); };
    tch = sb.channel('typing:' + conv, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.id === me.id) return;
        typers.set(payload.id, { name: String(payload.name || '?').slice(0, 60), until: Date.now() + 4500 });
        drawTyping(); setTimeout(drawTyping, 4600);
      }).subscribe();
    ta.addEventListener('input', () => {
      const n = Date.now();
      if (ta.value.trim() && n - lastSent > 2500 && tch) { lastSent = n; tch.send({ type: 'broadcast', event: 'typing', payload: { id: me.id, name: me.display_name } }); }
    });
    let pending = null;
    const pend = document.getElementById('pend'), pic = document.getElementById('pic');
    const showPend = () => {
      if (!pending) { pend.hidden = true; pend.innerHTML = ''; return; }
      pend.hidden = false;
      pend.innerHTML = `<img src="${esc(pending.preview)}" alt=""><span>${esc(pending.file.name)}</span><button type="button" id="unpic" aria-label="Remove picture">×</button>`;
      pend.querySelector('#unpic').onclick = () => { URL.revokeObjectURL(pending.preview); pending = null; showPend(); };
    };
    const take = async (file) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) { window.pgToast('Only pictures can be sent here.', 'error'); return; }
      const small = await shrink(file);
      if (small.size > 10 * 1024 * 1024) { window.pgToast('That picture is too big (10 MB at most).', 'error'); return; }
      if (pending) URL.revokeObjectURL(pending.preview);
      pending = { file: small, preview: URL.createObjectURL(small) };
      showPend(); ta.focus();
    };
    document.getElementById('clip').onclick = () => pic.click();
    pic.onchange = () => { take(pic.files[0]); pic.value = ''; };
    ta.onpaste = (e) => { const it = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (it) { e.preventDefault(); take(it); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value;
      if (!text.trim() && !pending) return;
      // a picture sent as a reply needs database update 0018: say so BEFORE anything is uploaded, and keep the text, the picture and the reply as they are
      if (pending && replyTo && !capOn('links')) { window.pgToast('A picture cannot be sent as a reply yet. Send it on its own, or cancel the reply.', 'error'); return; }
      const btn = f.querySelector('button.primary'); btn.disabled = true;
      try {
        if (pending) {
          const file = pending.file;
          const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'photo.jpg';
          const path = `${conv}/${crypto.randomUUID()}-${safe}`;
          const up = await sb.storage.from('chat-files').upload(path, file, { contentType: file.type, upsert: false });
          if (up.error) throw up.error;
          // p_reply is only sent when replying, so an ordinary picture is sent exactly as before
          await call('send_attachment', { p_conv: conv, p_caption: text, p_path: path, p_name: file.name, p_mime: file.type, p_size: file.size, ...(replyTo ? { p_reply: replyTo.id } : {}) });
          URL.revokeObjectURL(pending.preview); pending = null; showPend();
        } else await call('send_message', { p_conv: conv, p_body: text, ...(replyTo ? { p_reply: replyTo.id } : {}) });
        ta.value = ''; ta.style.height = '44px'; setReply(null); await loadThread(conv); window.chatSidebar();
      } catch (err) {
        // a picture reply needs database update 0018: if it is not there, say so, drop the reply, keep what was typed and do NOT claim anything was sent
        if (window.pgCaps && window.pgCaps.isMissing(err) && pending && replyTo) { window.pgCaps.markMissing('links'); setReply(null); }
        window.pgToast(friendly(err), 'error');
      }
      btn.disabled = false;
      ta.focus();
    };
    timer = setInterval(() => { if (current === conv) loadThread(conv); }, 8000);   // safety net if live updates are off
  };
})();
