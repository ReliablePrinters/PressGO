// PressGO picture preview. Clicking a picture (an <img> marked data-zoom) opens it large inside PressGO,
// above the current page. Close with the X button, the Escape key, or a click outside the picture.
// It never navigates and never opens a browser, so the page underneath is exactly as it was.
// It sets no right-click handler, so the normal Copy image / Save image as menu keeps working on the big picture.
(function () {
  let dlg = null, imgEl = null, msgEl = null;

  function build() {
    if (dlg) return;
    dlg = document.createElement('dialog');
    dlg.id = 'lightbox';
    dlg.setAttribute('aria-label', 'Picture preview');
    dlg.innerHTML = '<button type="button" class="lbx" aria-label="Close preview">×</button><p class="lbm" role="status"></p><img alt="">';
    document.body.appendChild(dlg);
    imgEl = dlg.querySelector('img');
    msgEl = dlg.querySelector('.lbm');
    dlg.addEventListener('click', (e) => { if (e.target !== imgEl) dlg.close(); });      // X button, or anywhere outside the picture
    dlg.addEventListener('close', () => { imgEl.removeAttribute('src'); imgEl.alt = ''; msgEl.textContent = ''; });
    imgEl.addEventListener('load', () => { msgEl.textContent = ''; imgEl.classList.add('on'); });
    imgEl.addEventListener('error', () => { imgEl.classList.remove('on'); msgEl.textContent = 'This picture could not be loaded.'; });
    window.addEventListener('hashchange', () => { if (dlg.open) dlg.close(); });
  }

  function open(src, alt) {
    if (!src || typeof src !== 'string') return;
    if (!/^(https?:|blob:|data:image\/)/i.test(src)) return;     // pictures only, never scripts or file paths
    build();
    imgEl.classList.remove('on');
    msgEl.textContent = 'Loading…';
    imgEl.alt = alt || 'Picture';
    imgEl.src = src;
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('.lbx').focus();
  }

  function zoomTarget(e) {
    const t = e.target;
    return t && t.closest ? t.closest('img[data-zoom]') : null;
  }

  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.defaultPrevented) return;            // left click only
    const img = zoomTarget(e);
    if (!img) return;
    e.preventDefault();                                          // a picture inside a link opens here, not on another page
    open(img.currentSrc || img.src, img.alt);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const img = zoomTarget(e);
    if (!img) return;
    e.preventDefault();
    open(img.currentSrc || img.src, img.alt);
  });

  window.pgLightbox = { open };
})();
