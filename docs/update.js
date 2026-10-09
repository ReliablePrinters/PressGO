// PressGO desktop update button. It only does anything inside the PressGO Windows app, which provides
// window.pressgoDesktop. In a normal browser this file does nothing at all.
(function () {
  const api = window.pressgoDesktop && window.pressgoDesktop.update;
  if (!api) return;
  let st = null;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function html() {
    if (!st) return '';
    if (st.status === 'available') {
      return `<div class="upd" role="status"><div class="uh"><b>Update available</b><span>PressGO ${esc(st.version)}</span></div>${st.notes ? `<p class="un">${esc(st.notes)}</p>` : ''}<button type="button" class="primary" data-u="start">Update PressGO</button></div>`;
    }
    if (st.status === 'downloading') {
      return `<div class="upd" role="status" aria-live="polite"><div class="uh"><b>Downloading update</b><span>${st.percent}%</span></div><div class="ubar"><i style="width:${st.percent}%"></i></div><p class="un">Keep working. PressGO will not restart until you say so.</p></div>`;
    }
    if (st.status === 'ready') {
      return `<div class="upd ok" role="status"><div class="uh"><b>Update ready</b><span>PressGO ${esc(st.version)}</span></div><p class="un">PressGO will close and reopen. Finish anything you are typing first.</p><button type="button" class="primary" data-u="install">Restart and install</button></div>`;
    }
    if (st.status === 'error') {
      return `<div class="upd bad" role="alert"><div class="uh"><b>Update did not finish</b></div><p class="un">${esc(st.message)}</p><button type="button" data-u="check">Try again</button></div>`;
    }
    return '';
  }

  function paint() {
    const box = document.getElementById('updbox');
    if (!box) return;
    const h = html();
    if (box.dataset.h !== h) { box.dataset.h = h; box.innerHTML = h; }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#updbox [data-u]');
    if (!b) return;
    b.disabled = true;
    const act = b.dataset.u;
    (act === 'start' ? api.start() : act === 'install' ? api.install() : api.check()).then((s) => { if (s) { st = s; paint(); } }).catch(() => {});
  });

  api.onState((s) => { st = s; paint(); });
  api.getState().then((s) => { st = s; paint(); }).catch(() => {});
  // The sidebar is drawn again on each page change, so put the box back each time.
  new MutationObserver(paint).observe(document.getElementById('app'), { childList: true });
  window.pgUpdatePaint = paint;
})();
