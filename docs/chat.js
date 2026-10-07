'use strict';
// PressGO chat, Slack-style: channels and private messages live in the left sidebar, the conversation fills the page.
// Uses helpers from app.js (sb, me, depts, esc, shell, ask, call, alert2, friendly).
(function () {
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
.thread .av{flex:none;width:36px;height:36px;border-radius:8px;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}
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
`;
  document.head.appendChild(css);

  let timer = null, sideTimer = null, rt = null, current = null, convs = [];

  const color = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 50% 42%)`; };
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const avatar = (n) => `<span class="av" style="background:${color(n)}">${esc(initials(n))}</span>`;
  const timeOf = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayLabel = (d) => {
    const t = new Date(d), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
    return t.toDateString() === n.toDateString() ? 'Today' : t.toDateString() === y.toDateString() ? 'Yesterday'
      : t.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  };

  window.chatLeave = function () {
    if (timer) { clearInterval(timer); timer = null; }
    current = null;
  };

  async function loadList() {
    const { data, error } = await sb.rpc('my_conversations');
    if (error) throw error;
    return data || [];
  }

  // ---------------------------------------------------------------- sidebar (channels + private messages)
  function renderSide() {
    const box = document.getElementById('sidechats');
    if (!box) return;
    const item = (c, pre) => `<a class="nav ch ${c.id === current ? 'on' : ''} ${Number(c.unread) ? 'unread' : ''}" href="#/chat/${c.id}"><span class="nm">${pre}${esc(c.name || '')}</span>${Number(c.unread) ? `<span class="dot">${c.unread}</span>` : ''}</a>`;
    const chans = convs.filter((c) => ['general', 'urgent', 'department'].includes(c.type));
    const jobs = convs.filter((c) => c.type === 'job').slice(0, 8);
    const dms = convs.filter((c) => c.type === 'direct');
    box.innerHTML = `<h4>Channels</h4>${chans.map((c) => item(c, '# ')).join('') || '<div class="note" style="padding:4px 10px">Loading…</div>'}
      ${jobs.length ? `<h4>Job chats</h4>${jobs.map((c) => item(c, '')).join('')}` : ''}
      <h4>Direct messages <button id="sidenew" title="New private message">+</button></h4>
      ${dms.map((c) => item(c, '')).join('') || '<div class="note" style="padding:4px 10px">No private messages yet.</div>'}`;
    box.querySelector('#sidenew').onclick = newDirect;
  }
  function ensureRealtime() {
    if (rt) return;
    rt = sb.channel('chat-all').on('postgres_changes', { event: 'INSERT', schema: 'pressgo', table: 'messages' }, (p) => {
      if (p.new.conversation_id === current) loadThread(current); else window.chatSidebar();
    }).subscribe();
  }
  window.chatSidebar = async function () {
    if (!me) return;
    renderSide();
    try { convs = await loadList(); renderSide(); } catch (e) { /* keep what we have */ }
    ensureRealtime();
    if (!sideTimer) sideTimer = setInterval(() => { if (me) window.chatSidebar(); }, 30000);
  };
  window.chatBadge = window.chatSidebar;

  // ---------------------------------------------------------------- conversation
  async function loadThread(conv) {
    const { data, error } = await sb.from('messages')
      .select('id,body,sent_at,author_id,author:author_id(display_name)')
      .eq('conversation_id', conv).order('sent_at', { ascending: false }).limit(200);
    const box = document.getElementById('msgs');
    if (!box || current !== conv) return;
    if (error) { box.innerHTML = `<div class="err">${esc(friendly(error))}</div>`; return; }
    const msgs = (data || []).reverse();
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    let lastDay = '', lastAuthor = '', lastT = 0;
    box.innerHTML = msgs.map((m) => {
      let h = '';
      const day = new Date(m.sent_at).toDateString(), t = +new Date(m.sent_at);
      if (day !== lastDay) { h += `<div class="day"><span>${esc(dayLabel(m.sent_at))}</span></div>`; lastAuthor = ''; }
      const cont = m.author_id === lastAuthor && t - lastT < 5 * 60000;
      lastDay = day; lastAuthor = m.author_id; lastT = t;
      const name = m.author_id === me.id ? 'You' : (m.author?.display_name || '?');
      h += cont
        ? `<div class="msg cont ${m.author_id === me.id ? 'mine' : ''}"><span class="gut">${esc(timeOf(m.sent_at))}</span><div class="bd">${esc(m.body)}</div></div>`
        : `<div class="msg ${m.author_id === me.id ? 'mine' : ''}">${avatar(name === 'You' ? me.display_name : name)}<div><div class="hd"><b>${esc(name)}</b><span class="tm">${esc(timeOf(m.sent_at))}</span></div><div class="bd">${esc(m.body)}</div></div></div>`;
      return h;
    }).join('') || '<div class="empty"><h3>No messages yet</h3>Say hello below.</div>';
    if (atBottom || box.dataset.first !== '1') box.scrollTop = box.scrollHeight;
    box.dataset.first = '1';
    await sb.rpc('mark_read', { p_conv: conv });
    convs = convs.map((c) => (c.id === conv ? { ...c, unread: 0 } : c));
    renderSide();
  }

  async function newDirect() {
    const opts = '<option value="">Pick a department…</option>' + depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('') + '<option value="all">All staff</option>';
    const go = async (ids) => {
      dlg.close();
      try { location.hash = '#/chat/' + (await call('start_chat', { p_people: ids })); } catch (e) { alert2(friendly(e)); }
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
    let conv = null;
    const m = hash.match(/^#\/chat\/([0-9a-f-]{36})$/);
    const jm = hash.match(/^#\/chat\/job\/([0-9a-f-]{36})$/);
    if (m) conv = m[1];
    if (jm) {
      const { data } = await sb.from('conversations').select('id').eq('job_id', jm[1]).maybeSingle();
      if (data) { location.hash = '#/chat/' + data.id; return; }
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
    renderSide();
    document.querySelector('.content').classList.add('chatmode');
    const main = document.querySelector('main');
    if (!conv) {
      main.innerHTML = `<div class="thread"><div class="empty"><h3>Messages</h3>Pick a channel or a person on the left,<br>or start a private message with the + button.<br><br><button class="primary" id="newdm">+ New private message</button></div></div>`;
      document.getElementById('newdm').onclick = newDirect;
      return;
    }
    const sub = info.type === 'direct' ? 'Private — only the people in this chat can see it'
      : info.type === 'job' ? `<a href="#/job/${info.job_id}">Open this job</a>`
      : info.type === 'department' ? 'Department channel — this department and managers' : 'Everyone';
    main.innerHTML = `<div class="thread"><div class="th-head"><div class="ttl">${esc((['general', 'urgent', 'department'].includes(info.type) ? '# ' : '') + (info.name || ''))}</div><div class="sub">${sub}</div></div>
      <div class="msgs" id="msgs"><p class="note">Loading…</p></div>
      <form class="send" id="sendf"><textarea name="body" maxlength="4000" rows="1" placeholder="Message ${esc(info.name || '')}" required></textarea><button class="primary" type="submit">Send</button></form></div>`;
    await loadThread(conv);
    const f = document.getElementById('sendf'), ta = f.body;
    ta.focus();
    ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value;
      if (!text.trim()) return;
      f.querySelector('button').disabled = true;
      try { await call('send_message', { p_conv: conv, p_body: text }); ta.value = ''; ta.style.height = '44px'; await loadThread(conv); window.chatSidebar(); }
      catch (err) { alert2(friendly(err)); }
      f.querySelector('button').disabled = false;
      ta.focus();
    };
    timer = setInterval(() => { if (current === conv) loadThread(conv); }, 8000);   // safety net if live updates are off
  };
})();
