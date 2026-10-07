'use strict';
// PressGO chat: General, Urgent Jobs, department channels, private messages and job chat.
// Uses the helpers from app.js (sb, me, esc, fmt, shell, ask, call, alert2, friendly).
(function () {
  const css = document.createElement('style');
  css.textContent = `
.chat{display:grid;grid-template-columns:280px 1fr;gap:14px;min-height:60vh}
.chat .list,.chat .thread{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.chat .list .head{padding:10px;border-bottom:1px solid var(--line)}
.chat .list .items{overflow:auto;max-height:70vh}
.chat .conv{display:block;padding:10px 12px;border-bottom:1px solid var(--line);color:inherit;text-decoration:none}
.chat .conv:hover,.chat .conv.on{background:color-mix(in srgb,var(--brand) 10%,transparent)}
.chat .conv .t{display:flex;justify-content:space-between;gap:8px;font-weight:600}
.chat .conv .p{color:var(--mut);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat .dot{background:var(--brand);color:#fff;border-radius:99px;font-size:12px;padding:0 7px;min-width:20px;text-align:center}
.chat .th-head{padding:10px 14px;border-bottom:1px solid var(--line);font-weight:600}
.chat .msgs{flex:1;overflow:auto;padding:12px 14px;max-height:60vh;min-height:40vh}
.chat .m{margin-bottom:10px;max-width:80%}
.chat .m .by{font-size:12px;color:var(--mut)}
.chat .m .b{white-space:pre-wrap;word-wrap:break-word;background:color-mix(in srgb,var(--mut) 14%,transparent);padding:7px 11px;border-radius:12px;display:inline-block}
.chat .m.mine{margin-left:auto;text-align:right}
.chat .m.mine .b{background:color-mix(in srgb,var(--brand) 22%,transparent);text-align:left}
.chat form.send{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line)}
.chat form.send textarea{resize:none;height:44px}
.chat .empty{padding:30px;color:var(--mut);text-align:center}
@media(max-width:700px){.chat{grid-template-columns:1fr}.chat.open .list{display:none}.chat:not(.open) .thread{display:none}}
`;
  document.head.appendChild(css);

  let channel = null, timer = null, current = null, badgeTimer = null;

  window.chatLeave = function () {
    if (channel) { sb.removeChannel(channel); channel = null; }
    if (timer) { clearInterval(timer); timer = null; }
    current = null;
  };

  window.chatBadge = async function () {
    const el = document.getElementById('chatlink');
    if (!el || !me) return;
    const { data } = await sb.rpc('my_conversations');
    const n = (data || []).reduce((a, c) => a + Number(c.unread || 0), 0);
    el.textContent = n ? `Chat (${n})` : 'Chat';
    if (!badgeTimer) badgeTimer = setInterval(() => { if (me) window.chatBadge(); }, 30000);
  };

  const preview = (c) => (c.last_body ? `${c.last_author === me.display_name ? 'You' : c.last_author}: ${c.last_body}` : 'No messages yet');
  const kind = (c) => (c.type === 'department' ? '# ' : c.type === 'direct' ? '' : c.type === 'job' ? '' : '# ');

  async function loadList() {
    const { data, error } = await sb.rpc('my_conversations');
    if (error) throw error;
    return data || [];
  }
  function renderList(list) {
    const box = document.getElementById('convs');
    if (!box) return;
    box.innerHTML = list.map((c) => `<a class="conv ${c.id === current ? 'on' : ''}" href="#/chat/${c.id}">
      <div class="t"><span>${esc(kind(c) + (c.name || ''))}</span>${Number(c.unread) ? `<span class="dot">${c.unread}</span>` : ''}</div>
      <div class="p">${esc(preview(c))}</div></a>`).join('') || '<div class="empty">No chats yet.</div>';
  }

  async function loadThread(conv, list) {
    const { data, error } = await sb.from('messages')
      .select('id,body,sent_at,author_id,author:author_id(display_name)')
      .eq('conversation_id', conv).order('sent_at', { ascending: false }).limit(200);
    const box = document.getElementById('msgs');
    if (!box) return;
    if (error) { box.innerHTML = `<div class="err">${esc(friendly(error))}</div>`; return; }
    const msgs = (data || []).reverse();
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = msgs.map((m) => `<div class="m ${m.author_id === me.id ? 'mine' : ''}">
      <div class="by">${m.author_id === me.id ? 'You' : esc(m.author?.display_name || '?')} · ${esc(fmt(m.sent_at))}</div><div class="b">${esc(m.body)}</div></div>`).join('')
      || '<div class="empty">No messages yet. Say hello.</div>';
    if (atBottom || box.dataset.first !== '1') box.scrollTop = box.scrollHeight;
    box.dataset.first = '1';
    await sb.rpc('mark_read', { p_conv: conv });
    renderList((list || (await loadList())).map((c) => (c.id === conv ? { ...c, unread: 0 } : c)));
    window.chatBadge();
  }

  async function newDirect() {
    const { data } = await sb.from('employees').select('id,display_name').eq('active', true).neq('id', me.id).order('display_name');
    if (!data || !data.length) return alert2('There is nobody else to message yet.');
    const r = await ask('New private message',
      `<label>Who do you want to message?<select name="who" required>${data.map((p) => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('')}</select></label>`, 'Open chat');
    if (!r) return;
    try { location.hash = '#/chat/' + (await call('start_direct', { p_other: r.who })); } catch (e) { alert2(friendly(e)); }
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
    shell('chat', '<p class="note">Loading…</p>');
    let list;
    try { list = await loadList(); } catch (e) { return shell('chat', `<div class="card err">${esc(friendly(e))}</div>`); }
    const found = conv ? list.find((c) => c.id === conv) : null;
    if (conv && !found) {
      // a job chat nobody has written in yet is not in the list: look it up so it can still be opened
      const { data: c } = await sb.from('conversations').select('id,type,name,job_id').eq('id', conv).maybeSingle();
      if (c) {
        let name = c.name;
        if (c.type === 'job') { const { data: j } = await sb.from('jobs').select('job_number,customer_name').eq('id', c.job_id).maybeSingle(); name = j ? `Job #${j.job_number} · ${j.customer_name}` : 'Job chat'; }
        list = [{ ...c, name, unread: 0, last_body: null }, ...list];
      } else conv = null;
    }
    current = conv;
    const title = conv ? (list.find((c) => c.id === conv) || {}).name : '';
    document.querySelector('main').innerHTML = `<div class="chat ${conv ? 'open' : ''}">
      <div class="list"><div class="head"><button class="primary" id="newdm" style="width:100%">+ New private message</button></div><div class="items" id="convs"></div></div>
      <div class="thread">${conv ? `<div class="th-head"><a href="#/chat" class="note" style="margin-right:8px">← Chats</a>${esc(title)}</div>
        <div class="msgs" id="msgs"><p class="note">Loading…</p></div>
        <form class="send" id="sendf"><textarea name="body" maxlength="4000" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" required></textarea><button class="primary" type="submit">Send</button></form>`
        : '<div class="empty">Pick a chat on the left, or start a private message.</div>'}</div></div>`;
    renderList(list);
    document.getElementById('newdm').onclick = newDirect;
    if (!conv) return;
    await loadThread(conv, list);
    const f = document.getElementById('sendf');
    const ta = f.body;
    ta.focus();
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value;
      if (!text.trim()) return;
      f.querySelector('button').disabled = true;
      try { await call('send_message', { p_conv: conv, p_body: text }); ta.value = ''; await loadThread(conv); }
      catch (err) { alert2(friendly(err)); }
      f.querySelector('button').disabled = false;
      ta.focus();
    };
    // live updates (instant when Realtime is on), plus a gentle refresh as a safety net
    const refresh = async () => { if (current !== conv) return; await loadThread(conv); };
    channel = sb.channel('chat-' + conv)
      .on('postgres_changes', { event: 'INSERT', schema: 'pressgo', table: 'messages' }, async (p) => {
        if (p.new.conversation_id === conv) refresh(); else { renderList(await loadList()); window.chatBadge(); }
      }).subscribe();
    timer = setInterval(async () => { if (current === conv) { await refresh(); } }, 8000);
  };
})();
