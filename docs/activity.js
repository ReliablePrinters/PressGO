'use strict';
// PressGO job activity: draws the Activity section of the job page from the audit records the database already keeps
// (audit_events, written by database triggers, so it is complete whether a change came from the app or from anywhere else).
// The rules that turn those records into readable entries live in activitylogic.js and are tested. This file only fetches names and draws.
// It reads with the signed-in person's own login: the database only returns audit records of jobs that person may open.
(function (root) {
  const A = root.pgActivity;
  if (!A || !A.build) return;
  const doc = root.document;
  const SHOW_FIRST = 8;                                  // the newest entries shown before "Show earlier"
  const FILTER_FROM = 8;                                 // filters appear only once a timeline is long enough to need them
  const ICON = { created: 'plus', status: 'check', owner: 'user', department: 'swap', details: 'tasks', file: 'inbox', artwork: 'check', picture: 'check', problem: 'alert', handoff: 'swap', delete: 'alert', gap: 'clock', other: 'clock' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n) => (root.pgIcon ? root.pgIcon(n) : '');
  const clock = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const full = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }); };
  const rel = (iso) => (root.pgUI && root.pgUI.rel ? root.pgUI.rel(iso) : '');

  let pending = null;                                    // what card() prepared for mount()

  // names for the people and departments mentioned in the records (one request each, only when needed)
  async function context(events, job) {
    const names = new Map();
    const ids = A.idsNeeded(events, job);
    const depts = new Map();
    const jobs = [];
    if (ids.length) jobs.push(sb.from('employees').select('id,display_name').in('id', ids).then(({ data }) => { for (const e of data || []) names.set(e.id, e.display_name); }));
    jobs.push(sb.from('departments').select('id,name').then(({ data }) => { for (const d of data || []) depts.set(d.id, d.name); }));
    try { await Promise.all(jobs); } catch (e) { /* names are a nicety: the entries still draw with generic wording */ }
    return { job, nameOf: (id) => names.get(id) || '', deptName: (id) => depts.get(id) || '' };
  }

  function chipHtml(c) {
    if (c.status) return `<span class="act-chip"><span class="act-cl">${esc(c.label)}</span> <span class="badge st" data-s="${esc(c.from)}">${esc(c.from)}</span><span class="act-arrow" aria-label="changed to">→</span><span class="badge st" data-s="${esc(c.to)}">${esc(c.to)}</span></span>`;
    if (c.from !== undefined) return `<span class="act-chip"><span class="act-cl">${esc(c.label)}</span> <span class="act-old">${esc(c.from)}</span><span class="act-arrow" aria-label="changed to">→</span><b>${esc(c.to)}</b></span>`;
    return `<span class="act-chip"><span class="act-cl">${esc(c.label)}</span> <b>${esc(c.value)}</b></span>`;
  }

  function entryHtml(e, i, o) {
    if (e.type === 'gap') {
      return `<li class="act-i act-gap"><span class="act-dot" aria-hidden="true">${ic('clock')}</span><div class="act-main"><div class="act-line"><b>${esc(e.verb)}</b></div><div class="act-note">${esc(e.detail || '')}</div></div></li>`;
    }
    const who = e.actor || (e.source === 'record' ? 'Someone' : 'System');
    const extra = (e.extra || []).map((x) => `<span class="act-x"><span class="act-cl">${esc(x.label)}</span> ${esc(x.value)}</span>`).join('');
    const latest = o.latestKey === e.key ? '<span class="act-latest">Latest</span>' : '';
    return `<li class="act-i k-${esc(e.kind)}${e.source === 'record' ? ' from-record' : ''}" data-cat="${esc(e.category)}">
      <span class="act-dot" aria-hidden="true">${ic(ICON[e.kind] || 'clock')}</span>
      <div class="act-main">
        <div class="act-line">${root.pgAvatar ? root.pgAvatar(who, 20) : ''}<b>${esc(who)}</b> ${esc(e.verb)} ${latest}</div>
        ${e.chips && e.chips.length ? `<div class="act-chips">${e.chips.slice(0, 8).map(chipHtml).join('')}${e.chips.length > 8 ? `<span class="act-more">+${e.chips.length - 8} more</span>` : ''}</div>` : ''}
        ${extra ? `<div class="act-extras">${extra}</div>` : ''}
        ${e.quote ? `<blockquote class="act-q">${esc(e.quote)}</blockquote>` : ''}
        ${e.reason ? `<div class="act-r"><span class="act-cl">Reason</span> ${esc(e.reason)}</div>` : ''}
        ${e.source === 'record' ? '<div class="act-note">Taken from the job record. The original activity entry was not kept.</div>' : ''}
      </div>
      <span class="act-t"><time datetime="${esc(e.at)}" title="${esc(full(e.at))}">${esc(clock(e.at))}</time>${o.recent && Date.now() - new Date(e.at).getTime() < 864e5 ? `<span class="act-rel">${esc(rel(e.at))}</span>` : ''}</span>
    </li>`;
  }

  // the section's shell: the list inside it is drawn by mount()
  function card(events, job, ctx) {
    const built = A.build(events, ctx);
    pending = { built, ctx, job };
    return `<section class="card act" id="activity" aria-labelledby="act-h"><div id="act-body"></div></section>`;
  }
  // one line for the top of the job page
  function latestLine() {
    if (!pending) return '';
    const e = A.latest(pending.built.entries);
    if (!e) return '';
    return `<div class="lastact"><span class="act-cl">Last activity</span> <span class="lastact-t">${root.pgAvatar ? root.pgAvatar(e.actor || 'System', 18) : ''} <b>${esc(e.actor || 'System')}</b> ${esc(e.verb)}</span> <span class="lastact-w">${esc(rel(e.at))}</span> <button type="button" class="ghost sm" id="goact">View activity</button></div>`;
  }

  function mount(el) {
    if (!el || !pending) return;
    const { built } = pending;
    pending = null;
    const real = built.entries.filter((e) => e.type !== 'gap');
    const st = { order: 'newest', filter: 'all', expanded: false };
    const latestKey = (A.latest(built.entries) || {}).key;
    const body = el.querySelector('#act-body');
    const showFilters = real.length > FILTER_FROM;
    body.innerHTML = `<div class="act-head"><h3 id="act-h">Activity</h3><span class="act-count">${real.length} ${real.length === 1 ? 'entry' : 'entries'}</span><span class="spacer"></span>
        ${real.length > 1 ? '<button type="button" class="sm" id="act-sort"></button>' : ''}</div>
      ${showFilters ? `<div class="act-filters chipbar" role="group" aria-label="Show">${A.CATEGORIES.map(([k, l]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="false">${esc(l)}</button>`).join('')}</div>` : ''}
      <div id="act-list" aria-live="polite"></div>`;
    const list = body.querySelector('#act-list'), sortBtn = body.querySelector('#act-sort');

    function paint() {
      const sel = A.select(built.entries, { filter: st.filter, order: st.order, limit: SHOW_FIRST, expanded: st.expanded });
      if (sortBtn) {
        sortBtn.textContent = st.order === 'newest' ? 'Newest first' : 'Oldest first';
        sortBtn.setAttribute('aria-label', st.order === 'newest' ? 'Newest first. Press to show oldest first.' : 'Oldest first. Press to show newest first.');
      }
      body.querySelectorAll('[data-f]').forEach((b) => { const on = b.dataset.f === st.filter; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      if (!real.length) { list.innerHTML = '<p class="note act-empty">No activity has been recorded for this job yet.</p>'; return; }
      if (!sel.items.length) { list.innerHTML = '<p class="note act-empty">Nothing in this category yet.</p>'; return; }
      const more = sel.hidden > 0 ? `<button type="button" class="sm act-showmore" id="act-more">Show ${sel.hidden} earlier ${sel.hidden === 1 ? 'entry' : 'entries'}</button>` : '';
      const days = A.groupByDay(sel.items, {}).map((g) => `<div class="act-day"><h4>${esc(g.label)}</h4><ol class="act-ol">${g.items.map((e, i) => entryHtml(e, i, { latestKey: st.filter === 'all' ? latestKey : null, recent: g.label === 'Today' || g.label === 'Yesterday' })).join('')}</ol></div>`).join('');
      list.innerHTML = (st.order === 'oldest' ? more : '') + days + (st.order === 'newest' ? more : '');
    }
    body.addEventListener('click', (ev) => {
      const f = ev.target.closest('[data-f]');
      if (f) { st.filter = f.dataset.f; st.expanded = false; return paint(); }
      if (ev.target.closest('#act-sort')) { st.order = st.order === 'newest' ? 'oldest' : 'newest'; return paint(); }
      if (ev.target.closest('#act-more')) { st.expanded = true; paint(); }
    });
    paint();
    const go = doc.getElementById('goact');
    if (go) go.onclick = () => {
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      const h = el.querySelector('#act-h'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    };
  }

  Object.assign(A, { context, card, mount, latestLine, _entryHtml: entryHtml });
})(window);
