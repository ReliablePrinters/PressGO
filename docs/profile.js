'use strict';
// PressGO profile: your picture (edited on Settings > Profile) and your saved look (loaded after sign-in; edited on Settings > Appearance).
// Uses helpers from app.js (sb, me, ask, call, toast, esc, friendly) and docs/prefs.js. The rules (who may change what, which
// files are accepted) are enforced by the database (migrations 0015 and 0016); the checks here only give friendlier messages.
// Pure functions are exported so they can be tested without a browser.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgProfile = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  const AVATAR = {
    BUCKET: 'avatars',
    TYPES: ['image/jpeg', 'image/png', 'image/webp'],   // same list as the bucket and set_avatar()
    MAX_PICK: 10 * 1024 * 1024,                         // biggest file someone may choose (it is shrunk before upload)
    SIZE: 256,                                          // stored picture: 256 x 256 JPEG, a few tens of KB
    MAX_STORED: 2 * 1024 * 1024                         // the server's limit (bucket and set_avatar())
  };

  function validateAvatarFile(f) {
    if (!f || typeof f.size !== 'number') return { ok: false, error: 'Choose a picture first.' };
    if (!AVATAR.TYPES.includes(f.type)) return { ok: false, error: 'Please choose a JPEG, PNG or WebP picture.' };
    if (f.size <= 0) return { ok: false, error: 'That file is empty.' };
    if (f.size > AVATAR.MAX_PICK) return { ok: false, error: 'That picture is too big (10 MB at most).' };
    return { ok: true, error: '' };
  }
  // the biggest centred square inside a w x h picture
  function cropBox(w, h) {
    const s = Math.min(w, h);
    return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), s };
  }
  // stored in my own folder (the first part of the path is my employee id), under a fresh name so nothing is overwritten
  const avatarPath = (empId, uniqueId) => `${empId}/${uniqueId}.jpg`;

  const pure = { AVATAR, validateAvatarFile, cropBox, avatarPath };
  if (typeof document === 'undefined') return pure;

  // ---------------------------------------------------------------- browser part
  const store = { byName: new Map(), urls: new Map(), pathByEmp: new Map(), timer: null };

  // a picture inside the coloured initials circle; if it fails to load the initials simply stay
  function setImg(el, url) {
    let img = el.querySelector(':scope > img');
    if (!url) { if (img) img.remove(); return; }
    if (!img) { img = document.createElement('img'); img.alt = ''; img.draggable = false; el.appendChild(img); }
    if (img.getAttribute('src') !== url) img.setAttribute('src', url);
  }
  const paint = () => document.querySelectorAll('.av[data-n]').forEach((el) => setImg(el, store.byName.get(el.dataset.n) || null));
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.closest && t.closest('.av')) t.remove(); }, true);
  root.pgAvatarUrl = (name) => store.byName.get(name) || null;

  async function loadAvatars() {
    if (typeof me === 'undefined' || !me) return;
    const { data, error } = await sb.from('employee_avatars').select('employee_id,avatar_path,emp:employee_id(display_name)');
    if (error || !data || !me) return;                                     // keep what is on screen
    const now = Date.now();
    const need = data.map((r) => r.avatar_path).filter((p) => !(store.urls.get(p) && store.urls.get(p).exp > now));
    if (need.length) {
      const { data: signed } = await sb.storage.from(AVATAR.BUCKET).createSignedUrls(need, 3600);
      (signed || []).forEach((s) => { if (s.signedUrl) store.urls.set(s.path, { url: s.signedUrl, exp: now + 50 * 60000 }); });   // reused, so pictures do not reload on every refresh
    }
    if (!me) return;
    const byName = new Map(), pathByEmp = new Map();
    data.forEach((r) => {
      pathByEmp.set(r.employee_id, r.avatar_path);
      const u = store.urls.get(r.avatar_path);
      if (u && r.emp) byName.set(r.emp.display_name, u.url);
    });
    store.byName = byName; store.pathByEmp = pathByEmp;
    paint();
  }

  async function loadPrefs() {
    const { data, error } = await sb.from('employee_preferences').select('theme,accent').maybeSingle();
    if (error) return;                                                      // keep the look from this browser
    const p = root.pgPrefs.apply(data);
    root.pgPrefs.remember(p);
  }

  // called when someone has signed in
  function init() {
    loadPrefs();
    loadAvatars();
    if (!store.timer) store.timer = setInterval(() => { if (typeof me !== 'undefined' && me) loadAvatars(); }, 5 * 60000);
  }
  function reset() {
    store.byName = new Map(); store.urls = new Map(); store.pathByEmp = new Map();
    if (store.timer) { clearInterval(store.timer); store.timer = null; }
  }

  function processAvatar(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const { sx, sy, s } = cropBox(img.naturalWidth, img.naturalHeight);
          if (!s) throw new Error('empty');
          const c = document.createElement('canvas'); c.width = c.height = AVATAR.SIZE;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, sx, sy, s, s, 0, 0, c.width, c.height);   // re-drawing also drops any hidden data (e.g. location) in the original
          c.toBlob((b) => (b && b.size <= AVATAR.MAX_STORED ? resolve(b) : reject(new Error('That picture could not be prepared.'))), 'image/jpeg', 0.9);
        } catch (e) { reject(new Error('That picture could not be read.')); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture PressGO can read.')); };
      img.src = url;
    });
  }

  // The picture editor on Settings > Profile. Choosing a picture shows a preview; nothing is stored until "Save picture".
  function mountPicture(host) {
    let pending = null, previewUrl = null, removing = false, busy = false;
    const hasPic = () => !!root.pgAvatarUrl(me.display_name);
    const drop = () => { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } };
    const idle = 'JPEG, PNG or WebP. It is cropped to a square. Everyone at PressGO can see it. Without one, your initials are shown.';
    host.innerHTML = `<div class="pfrow"><span class="pfprev" id="pfprev">${root.pgAvatar(me.display_name, 96)}</span>
        <div class="pfctl"><label>Choose a picture<input type="file" id="pffile" accept="image/jpeg,image/png,image/webp"></label>
          <button type="button" id="pfrm" ${hasPic() ? '' : 'hidden'}>Remove my picture</button>
          <span id="pfsave" hidden><button type="button" class="primary" id="pfgo">Save picture</button> <button type="button" id="pfno">Discard</button></span></div></div>
      <span class="hint" id="pfhint" role="status">${idle}</span>`;
    const $ = (s) => host.querySelector(s);
    const hint = $('#pfhint'), prev = $('#pfprev'), rm = $('#pfrm'), save = $('#pfsave'), file = $('#pffile');
    const note = (m, bad) => { hint.textContent = m; hint.style.color = bad ? 'var(--bad)' : ''; };
    const staged = (on) => { save.hidden = !on; };
    const reset = () => {
      drop(); pending = null; removing = false; file.value = '';
      prev.innerHTML = root.pgAvatar(me.display_name, 96); rm.hidden = !hasPic(); staged(false); note(idle, false);
    };
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      const v = validateAvatarFile(f);
      if (!v.ok) { file.value = ''; note(v.error, true); return; }
      try {
        const blob = await processAvatar(f);
        drop(); pending = blob; removing = false; previewUrl = URL.createObjectURL(blob);
        prev.innerHTML = `<span class="av" style="width:96px;height:96px"><img src="${esc(previewUrl)}" alt="Your new picture"></span>`;
        rm.hidden = false; staged(true); note('New picture ready. Press Save picture to keep it.', false);
      } catch (err) { file.value = ''; note(err.message, true); }
    });
    rm.addEventListener('click', () => {
      drop(); pending = null; removing = true; file.value = '';
      prev.innerHTML = `<span class="av" style="width:96px;height:96px;background:var(--mut)" aria-hidden="true"></span>`;
      rm.hidden = true; staged(true); note('Your picture will be removed when you press Save picture. Your initials will be shown instead.', false);
    });
    $('#pfno').addEventListener('click', reset);
    $('#pfgo').addEventListener('click', async () => {
      if (busy) return;
      busy = true; $('#pfgo').disabled = true;
      const tidy = (path) => { if (path) sb.storage.from(AVATAR.BUCKET).remove([path]).catch(() => {}); };   // best effort: the old file is no longer used
      try {
        if (pending) {
          const old = store.pathByEmp.get(me.id);
          const path = avatarPath(me.id, crypto.randomUUID());
          const up = await sb.storage.from(AVATAR.BUCKET).upload(path, pending, { contentType: 'image/jpeg', upsert: false });
          if (up.error) throw up.error;
          await call('set_avatar', { p_path: path, p_mime: 'image/jpeg', p_size: pending.size });
          if (old && old !== path) tidy(old);
        } else if (removing) {
          tidy(await call('remove_avatar'));
        }
        await loadAvatars();
        if (window.chatSidebar) window.chatSidebar();
        reset(); toast('Picture saved.');
      } catch (err) { note('Your picture was not saved: ' + friendly(err), true); toast('Your picture was not saved: ' + friendly(err), 'error'); }
      busy = false; $('#pfgo').disabled = false;
    });
  }

  return Object.assign(pure, { init, reset, open: () => { root.location.hash = '#/settings'; }, mountPicture, reload: loadAvatars });
});
