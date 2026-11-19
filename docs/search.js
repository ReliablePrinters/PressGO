'use strict';
// PressGO global search (Ctrl+K, or the Search button). One box that finds jobs, people, conversations and messages.
// It asks the database the same way every other screen does, with the signed-in person's own login, so the database's own rules
// decide what can be found: a job, a private chat or a department message the person may not open simply never comes back.
// No new database functions or tables are used. The rules (word matching, highlighting, keys) live in searchlogic.js and are tested.
(function (root) {
  const L = root.pgSearchLogic;
  if (!L) return;
  const doc = root.document;
  const DEBOUNCE_MS = 220;
  const isMac = /mac|iphone|ipad/i.test((root.navigator && (root.navigator.platform || root.navigator.userAgent)) || '');
  const keyHint = isMac ? '⌘K' : 'Ctrl K';
  // the signed-in person's record (a variable app.js keeps; it does not exist before sign-in)
  const currentMe = () => (typeof me !== 'undefined' ? me : null);
  const ic = (n) => (root.pgIcon ? root.pgIcon(n) : '');

  let dlg = null, input = null, list = null, stateEl = null, live = null, field = null;
  let state = 'idle', results = null, flat = [], active = -1, lastQuery = '';
  let timer = null, busyOpening = false, openedAt = '';
  let convsPromise = null;
  const gate = L.createGate();

  // ------------------------------------------------------------------ data
  function loadConversations() {
    convsPromise = Promise.resolve(sb.rpc('my_conversations')).then(({ data, error }) => { if (error) throw error; return data || []; });
    convsPromise.catch(() => {});
    return convsPromise;
  }
  // the same list, but a failure is reported (used by the Conversations results); the others carry on without it
  function conversationsStrict() { if (!convsPromise) loadConversations(); return convsPromise; }
  async function conversations() {
    if (!convsPromise) loadConversations();
    try { return await convsPromise; } catch (e) { return []; }
  }

  async function searchJobs(q) {
    const sel = 'id,job_number,customer_name,description,product,lifecycle_status,priority,due_at,departments:current_department_id(name),assignee:current_assignee_id(display_name)';
    const jobs = [];
    const n = L.jobNumberOf(q);
    const tasks = [];
    if (n != null) tasks.push(sb.from('jobs').select(sel).eq('job_number', n).limit(1));
    const ors = L.orSafeWords(q);
    if (ors.length) {
      let qb = sb.from('jobs').select(sel).limit(L.LIMITS.jobs * 2);
      for (const w of ors) qb = qb.or(`customer_name.ilike.%${w}%,description.ilike.%${w}%,product.ilike.%${w}%,customer_phone.ilike.%${w}%`);   // every word must match somewhere
      tasks.push(qb);
    }
    for (const r of await Promise.all(tasks)) { if (r.error) throw r.error; jobs.push(...(r.data || [])); }
    return L.rankJobs(L.uniqueById(jobs), q).slice(0, L.LIMITS.jobs).map((j) => ({ kind: 'job', id: j.id, job: j, href: '#/job/' + j.id }));
  }

  async function searchPeople(q) {
    let qb = sb.from('employees').select('id,display_name,manager_role,front_desk,active').eq('active', true).limit(L.LIMITS.people * 2);
    for (const w of L.words(q)) qb = qb.ilike('display_name', L.likeFor(w));
    const { data, error } = await qb;
    if (error) throw error;
    const me = currentMe() || {};
    const convs = await conversations();
    return L.dedupePeople((data || []).filter((p) => p.id !== me.id), convs).slice(0, L.LIMITS.people).map((p) => ({ kind: 'person', id: p.id, person: p }));
  }

  async function searchConversations(q) {
    const convs = L.filterConvs(await conversationsStrict(), q);
    return convs.map((c) => ({ kind: 'conv', id: c.id, conv: c, href: root.pgChat.chatHref(c.id) }));
  }

  async function searchMessages(q) {
    let qb = sb.from('messages').select('id,conversation_id,author_id,body,sent_at,attachment_path').is('hidden_at', null)
      .order('sent_at', { ascending: false }).limit(L.LIMITS.messages);
    for (const w of L.words(q)) qb = qb.ilike('body', L.likeFor(w));
    const { data, error } = await qb;
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return [];
    const convMap = new Map((await conversations()).map((c) => [c.id, c]));
    const ids = [...new Set(rows.map((m) => m.author_id))];
    const names = new Map();
    const emp = await sb.from('employees').select('id,display_name').in('id', ids);
    for (const e of emp.data || []) names.set(e.id, e.display_name);
    return rows.map((m) => {
      const c = convMap.get(m.conversation_id);
      return { kind: 'message', id: m.id, msg: m, convName: c ? c.name : 'Conversation', convType: c ? c.type : null,
        author: names.get(m.author_id) || 'Someone', href: root.pgChat.chatHref(m.conversation_id, m.id) };
    });
  }

  async function run(q) {
    loadConversations();                                    // fresh unread counts and names each search session
    const jobs = [['jobs', searchJobs], ['people', searchPeople], ['convs', searchConversations], ['messages', searchMessages]];
    const settled = await Promise.allSettled(jobs.map(([, fn]) => fn(q)));
    const out = { jobs: [], people: [], convs: [], messages: [], errors: {} };
    settled.forEach((r, i) => { const k = jobs[i][0]; if (r.status === 'fulfilled') out[k] = r.value; else out.errors[k] = L.friendlyError(r.reason); });
    return out;
  }

  // ------------------------------------------------------------------ drawing
  const esc = (s) => (root.esc ? root.esc(s) : String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const marked = (parts) => parts.map((p) => (p.hit ? `<mark>${esc(p.t)}</mark>` : esc(p.t))).join('');
  const hl = (text, q) => marked(L.highlight(text, q));
  const when = (iso) => (root.pgUI && root.pgUI.rel ? root.pgUI.rel(iso) : '');
  const shortDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };

  function rowHtml(it, i, q) {
    let icon, title, sub = '', extra = '', right = '';
    if (it.kind === 'job') {
      const j = it.job;
      icon = `<span class="gsi">${ic('jobs')}</span>`;
      title = `<span class="gsn">#${esc(j.job_number)}</span> ${hl(j.customer_name, q)}`;
      sub = hl(j.description || '', q);
      extra = `<span class="gss">${esc((j.departments && j.departments.name) || 'No department')} · ${esc((j.assignee && j.assignee.display_name) || 'Unassigned')} · Due ${esc(shortDate(j.due_at))}</span>`;
      right = `${root.pgUI ? root.pgUI.stBadge(j) : ''}${j.priority === 'Rush' ? '<span class="badge rush">Rush</span>' : ''}`;
    } else if (it.kind === 'person') {
      const p = it.person;
      icon = `<span class="gsi plain">${root.pgAvatar ? root.pgAvatar(p.display_name, 32) : ''}</span>`;
      title = hl(p.display_name, q);
      sub = esc(L.roleOf(p));
      right = '<span class="gsact">Message</span>';
    } else if (it.kind === 'conv') {
      const c = it.conv;
      icon = `<span class="gsi">${c.type === 'direct' ? ic('user') : c.type === 'job' ? ic('jobs') : '<b aria-hidden="true">#</b>'}</span>`;
      const label = c.type === 'direct' ? c.name : c.type === 'job' ? c.name : '#' + String(c.name || '').replace(/^#\s*/, '');
      title = hl(label, q);
      sub = c.last_body ? esc((c.last_author ? c.last_author + ': ' : '') + String(c.last_body).replace(/\s+/g, ' ').slice(0, 90)) : '<span class="gss">No messages yet</span>';
      right = Number(c.unread) > 0 ? `<span class="badge warn">${Number(c.unread)} unread</span>` : '';
    } else {
      icon = `<span class="gsi">${ic('chat')}</span>`;
      const where = it.convType === 'direct' || it.convType === 'job' ? it.convName : '#' + String(it.convName).replace(/^#\s*/, '');
      title = `${esc(where)} <span class="gss">· ${esc(it.author)}</span>`;
      sub = marked(L.snippet(it.msg.body, q));
      right = `<span class="gss">${esc(when(it.msg.sent_at))}</span>`;
    }
    return `<li role="option" id="gs-o-${i}" data-i="${i}" class="gso k-${it.kind}" aria-selected="${i === active}">${icon}<span class="gst"><span class="gstt">${title}</span>${sub ? `<span class="gssub">${sub}</span>` : ''}${extra}</span><span class="gsr">${right}</span></li>`;
  }

  function paint() {
    const q = input.value;
    const showList = state === 'results' || (state === 'loading' && results);
    let html = '';
    if (showList) {
      let i = 0;
      for (const g of L.groupsOf(results)) {
        html += `<li role="presentation" class="gsh">${esc(g.label)}</li>`;
        for (const it of g.items) html += rowHtml(it, i++, lastQuery);
        if (g.error) html += `<li role="presentation" class="gserr"><span>${esc(g.label)} could not be searched. ${esc(results.errors[g.key === 'convs' ? 'convs' : g.key])}</span> <button type="button" class="sm" data-retry>Try again</button></li>`;
      }
    }
    list.innerHTML = html;
    list.hidden = !html;
    list.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
    input.setAttribute('aria-expanded', html ? 'true' : 'false');
    stateEl.className = 'gsstate' + (state === 'loading' && results ? ' quiet' : '');
    stateEl.innerHTML = '';
    if (state === 'idle') stateEl.innerHTML = `<div class="gsmsg"><b>Search PressGO</b><span>Find a job by number or customer, a colleague by name, a conversation, or words inside a message.</span><span class="gsex">Try <kbd>1002</kbd>, a customer name, or a word someone wrote.</span><span class="gsnote">You only see jobs, chats and messages you have access to.</span></div>`;
    else if (state === 'short') stateEl.innerHTML = `<div class="gsmsg"><span>Keep typing. Search starts at ${L.MIN_CHARS} characters.</span></div>`;
    else if (state === 'loading' && !results) stateEl.innerHTML = '<div class="skel" aria-hidden="true"><i></i><i></i><i></i></div>';
    else if (state === 'empty') stateEl.innerHTML = `<div class="gsmsg">${ic('search')}<b>No results for “${esc(L.normalize(lastQuery))}”</b><span>Check the spelling, or try fewer words. Only jobs, chats and messages you have access to are searched.</span></div>`;
    else if (state === 'error') stateEl.innerHTML = `<div class="gsmsg err"><b>Search is not working right now</b><span>${esc((results && results.message) || 'Please try again.')}</span><button type="button" data-retry>Try again</button></div>`;
    stateEl.hidden = state === 'results' || (state === 'loading' && !!results);
    live.textContent = L.announce(state === 'results' ? 'results' : state === 'empty' ? 'results' : state, flat.length, lastQuery);
    const sel = list.querySelector('[aria-selected="true"]');
    if (sel) { input.setAttribute('aria-activedescendant', sel.id); sel.scrollIntoView({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  }

  // ------------------------------------------------------------------ searching
  async function search() {
    const q = input.value;
    const norm = L.normalize(q);
    if (!norm) { gate.cancel(); state = 'idle'; results = null; flat = []; active = -1; lastQuery = ''; return paint(); }
    if (!L.ready(q)) { gate.cancel(); state = 'short'; results = null; flat = []; active = -1; return paint(); }
    const id = gate.next();
    lastQuery = q;
    state = 'loading';
    paint();
    let res;
    try { res = await run(q); }
    catch (e) { if (!gate.isLatest(id)) return; state = 'error'; results = { message: L.friendlyError(e) }; flat = []; active = -1; return paint(); }
    if (!gate.isLatest(id)) return;                       // a newer search is running: drop this answer
    const groups = L.groupsOf(res);
    const failed = Object.keys(res.errors).length;
    results = res;
    flat = L.flatten(groups);
    if (failed === 4) { state = 'error'; results = { message: Object.values(res.errors)[0] }; flat = []; active = -1; }
    else if (!flat.length && !failed) state = 'empty';
    else state = 'results';
    active = flat.length ? 0 : -1;
    paint();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(search, DEBOUNCE_MS); };

  // ------------------------------------------------------------------ opening a result
  function finish(href) {
    close();
    if (!href) return;
    if (root.location.hash === href) route(); else root.location.hash = href;
  }
  async function go(it) {
    if (!it) return;
    if (it.kind === 'person') {
      if (busyOpening) return;
      busyOpening = true;
      try { const conv = await call('start_chat', { p_people: [it.id] }); finish(root.pgChat.chatHref(conv)); }
      catch (e) { root.pgToast && root.pgToast(friendly(e), 'error'); }
      busyOpening = false;
      return;
    }
    finish(it.href);
  }
  function setActive(i) {
    active = i;
    list.querySelectorAll('.gso').forEach((el, n) => el.setAttribute('aria-selected', String(n === i)));
    const sel = list.querySelector('[aria-selected="true"]');
    if (sel) { input.setAttribute('aria-activedescendant', sel.id); sel.scrollIntoView({ block: 'nearest' }); }
  }

  // ------------------------------------------------------------------ the window
  function build() {
    dlg = doc.createElement('dialog');
    dlg.id = 'gsearch'; dlg.className = 'gs'; dlg.setAttribute('aria-label', 'Search PressGO');
    dlg.innerHTML = `<div class="gs-top"><label class="gs-field" for="gs-q"><span class="gs-mag" aria-hidden="true">${ic('search')}</span>
        <input id="gs-q" type="text" role="combobox" aria-expanded="false" aria-controls="gs-list" aria-autocomplete="list" aria-label="Search jobs, people, conversations and messages"
          placeholder="Search jobs, people, chats and messages" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search"></label>
      <button type="button" id="gs-x" class="gs-close">Close</button></div>
      <div class="gs-body"><ul id="gs-list" role="listbox" aria-label="Search results" hidden></ul><div id="gs-state" class="gsstate"></div></div>
      <div class="gs-foot" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
      <div class="sr-only" role="status" aria-live="polite" id="gs-live"></div>`;
    doc.body.appendChild(dlg);
    input = dlg.querySelector('#gs-q'); list = dlg.querySelector('#gs-list'); stateEl = dlg.querySelector('#gs-state'); live = dlg.querySelector('#gs-live'); field = dlg.querySelector('.gs-field');
    input.addEventListener('input', () => { active = -1; schedule(); });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) setActive(L.move(active, 1, flat.length)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) setActive(L.move(active, -1, flat.length)); }
      else if (e.key === 'Home' && flat.length && !input.value) { e.preventDefault(); setActive(0); }
      else if (e.key === 'End' && flat.length && !input.value) { e.preventDefault(); setActive(flat.length - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (timer) { clearTimeout(timer); timer = null; if (state !== 'results') return search(); }   // typed and pressed Enter at once: search first
        if (state === 'results' && flat[active]) go(flat[active]);
      }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());                 // keep the cursor in the box
    list.addEventListener('mousemove', (e) => { const li = e.target.closest('.gso'); if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i)); });
    list.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) return search();
      const li = e.target.closest('.gso'); if (li) go(flat[Number(li.dataset.i)]);
    });
    stateEl.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) search(); });
    dlg.querySelector('#gs-x').addEventListener('click', close);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });       // the dimmed area outside the box
    dlg.addEventListener('close', () => { clearTimeout(timer); timer = null; gate.cancel(); if (input) input.blur(); });   // leave no focus behind in the closed window
    // going to another page closes search; but a page change that was already under way when it opened must not (the event arrives late)
    root.addEventListener('hashchange', () => { if (dlg.open && root.location.hash !== openedAt) dlg.close(); });
  }
  function open() {
    if (!currentMe() || !doc.getElementById('appbox')) return;                          // only inside the signed-in app
    if (!dlg) build();
    if (dlg.open) { input.focus(); input.select(); return; }
    openedAt = root.location.hash;
    input.value = ''; state = 'idle'; results = null; flat = []; active = -1; lastQuery = '';
    loadConversations();
    paint();
    dlg.showModal();
    input.focus();
  }
  function close() { if (dlg && dlg.open) dlg.close(); }

  const typingNow = (el) => !!el && !(el.closest && el.closest('dialog:not([open])')) && L.isTypingTarget(el);   // (not a box inside a window that just closed)
  // Ctrl+K (Command+K on a Mac) from anywhere in the app, except while typing in a box or while another window is open
  doc.addEventListener('keydown', (e) => {
    const ok = L.shouldOpen(e, { signedIn: !!(currentMe() && doc.getElementById('appbox')), modalOpen: !!doc.querySelector('dialog[open]'), typing: typingNow(e.target) || typingNow(doc.activeElement) });
    if (ok) { e.preventDefault(); open(); }
  });

  root.pgSearch = { open, close, keyHint, _run: run };
})(window);
