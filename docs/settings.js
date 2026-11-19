'use strict';
// PressGO Settings page: Profile, Security, Notifications, Appearance and About.
// The rules (which link opens which section, what makes a password acceptable) are in settingslogic.js and are unit-tested.
// This file only draws the page and talks to the database through the same calls the rest of PressGO already uses.
(function (root) {
  const S = root.pgSettings;

  const panels = {
    // ---------- Profile: your picture, and who the system says you are ----------
    profile(el) {
      const deptNames = (typeof depts !== 'undefined' ? depts : []).filter((d) => myDepts.has(d.id)).map((d) => d.name);
      const since = me.created_at ? S.sinceText(me.created_at) : '';
      const rows = [
        ['Name', me.display_name],
        ['Role', S.roleText(me)],
        ['Departments', S.joinNames(deptNames)],
      ];
      if (since) rows.push(['Account created', since]);
      el.innerHTML = `<div class="fgroup"><h4>Profile picture</h4><div id="pfhost"></div></div>
        <div class="fgroup"><h4>Account details</h4><dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <span class="hint">Your name, role and departments are set by a manager. If something here is wrong, ask a manager to change it.</span></div>`;
      root.pgProfile.mountPicture(el.querySelector('#pfhost'));
    },

    // ---------- Security: change your own password ----------
    security(el) {
      const P = S.PASSWORD;
      el.innerHTML = `<form id="pwf" novalidate autocomplete="off">
        <div class="fgroup"><h4>Change password</h4>
        <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="next" type="password" autocomplete="new-password" required maxlength="${P.MAX + 20}" aria-describedby="pwrules"></label>
        <label>Type the new password again<input name="again" type="password" autocomplete="new-password" required maxlength="${P.MAX + 20}"></label>
        <ul class="rules" id="pwrules" aria-live="polite">
          <li data-r="length">${P.MIN} to ${P.MAX} characters</li>
          <li data-r="different">Different from your current password</li>
          <li data-r="match">Both new passwords match</li></ul>
        <div class="err" id="pwerr" role="alert"></div>
        <button class="primary" type="submit" id="pwgo">Change password</button>
        <span class="hint">You stay signed in on this computer. Forgot your current password? Ask a manager to reset it.</span></div></form>`;
      const f = el.querySelector('#pwf'), err = el.querySelector('#pwerr'), go = el.querySelector('#pwgo');
      const read = () => ({ current: f.current.value, next: f.next.value, again: f.again.value });
      const paint = () => {
        const c = S.checkPassword(read());
        el.querySelectorAll('[data-r]').forEach((li) => { const on = c.rules[li.dataset.r]; li.classList.toggle('ok', on); li.setAttribute('data-state', on ? 'met' : 'unmet'); });
        return c;
      };
      f.addEventListener('input', () => { err.textContent = ''; paint(); });
      paint();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const v = read(), c = paint();
        if (!c.ok) { err.textContent = c.errors[0]; return; }
        go.disabled = true; err.textContent = '';
        try {
          // Prove it is really you first: sign in again with the current password.
          const { data: s } = await sb.auth.getSession();
          const email = s && s.session && s.session.user && s.session.user.email;
          if (!email) throw new Error('Please sign in again.');
          const re = await sb.auth.signInWithPassword({ email, password: v.current });
          if (re.error) throw re.error;
          const up = await sb.auth.updateUser({ password: v.next });
          if (up.error) throw up.error;
          f.reset(); paint();
          toast('Your password has been changed.');
        } catch (ex) { err.textContent = S.friendlyAuthError(ex && ex.message); }
        go.disabled = false;
      };
    },

    // ---------- Notifications: sounds, banners, which alerts, Windows notifications ----------
    notifications(el) {
      const N = root.pgNotify;
      if (!N || !N.view) { el.innerHTML = '<p class="note">Notification settings are not available in this version.</p>'; return; }
      el.innerHTML = `<form id="nf">${N.view.html(me)}<div class="savebar"><button class="primary" type="submit">Save notification settings</button><span class="hint" id="nfres" role="status"></span></div></form>
        <p class="note">These choices are kept on this computer, for your account only. They do not change what other people see.</p>`;
      const f = el.querySelector('#nf');
      N.view.bind(f);
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = {};
        for (const [k, val] of new FormData(f)) v[k] = val;
        N.view.save(v);
        el.querySelector('#nfres').textContent = '';
        toast('Notification settings saved.');
      };
    },

    // ---------- Appearance: light / dark / follow the computer, and the accent colour (saved to your account) ----------
    appearance(el) {
      // Saving a look needs database update 0016. Until it is applied there is nothing that could be saved: explain instead of offering controls that would fail.
      if (root.pgCaps && !root.pgCaps.has('prefs')) {
        el.innerHTML = `<div class="fgroup"><h4>Appearance</h4><p class="note" role="status">${esc(root.pgCaps.unavailable('prefs'))} PressGO keeps following your computer's light or dark setting.</p></div>`;
        return;
      }
      const P = root.pgPrefs;
      let saved = P.get();
      const scheme = document.documentElement.getAttribute('data-scheme') === 'dark' ? 'dark' : 'light';
      const themes = [['system', 'Match my computer', 'Follows your computer, day and night'], ['light', 'Light', 'Light background'], ['dark', 'Dark', 'Dark background']];
      el.innerHTML = `<div class="fgroup"><h4>Appearance</h4><div class="optgrid" role="radiogroup" aria-label="Appearance">${themes.map(([v, l, d]) =>
          `<label class="opt"><input type="radio" name="theme" value="${v}" ${saved.theme === v ? 'checked' : ''}><span><b>${l}</b><small>${d}</small></span></label>`).join('')}</div></div>
        <div class="fgroup"><h4>Accent colour</h4><div class="optgrid swatches" role="radiogroup" aria-label="Accent colour">${Object.entries(P.ACCENTS).map(([k, a]) =>
          `<label class="opt"><input type="radio" name="accent" value="${k}" ${saved.accent === k ? 'checked' : ''}><span class="sw" style="background:${a[scheme].btn}" aria-hidden="true"></span><span><b>${esc(a.label)}</b></span></label>`).join('')}</div>
        <span class="hint" id="aphint" role="status">Used for buttons, links and highlights. A change is applied and saved straight away, and follows you to any computer you sign in on.</span></div>`;
      const hint = el.querySelector('#aphint');
      const idle = hint.textContent;
      el.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.name !== 'theme' && t.name !== 'accent') return;
        const next = { ...saved, [t.name]: t.value };
        P.apply(next);                                                       // you see it at once
        try {
          await call('set_preferences', { p_theme: next.theme, p_accent: next.accent });
          saved = P.normalize(next); P.remember(saved);
          hint.style.color = ''; hint.textContent = 'Saved.'; setTimeout(() => { if (hint.textContent === 'Saved.') hint.textContent = idle; }, 2500);
        } catch (ex) {
          P.apply(saved);                                                    // not stored: go back to what is saved
          if (root.pgCaps && root.pgCaps.isMissing(ex)) root.pgCaps.markMissing('prefs');   // update 0016 is not there: the controls are replaced by the explanation on the next visit
          el.querySelectorAll(`input[name="${t.name}"]`).forEach((r) => { r.checked = r.value === saved[t.name]; });
          hint.style.color = 'var(--bad)'; hint.textContent = 'Your look was not saved: ' + friendly(ex);
        }
      });
    },

    // ---------- Keyboard: the shortcut list and the switch for letter shortcuts ----------
    keyboard(el) {
      if (root.pgShortcuts) root.pgShortcuts.panel(el);
      else el.innerHTML = '<p class="note">Keyboard shortcuts are not available in this version.</p>';
    },

    // ---------- About: which version is running ----------
    about(el) {
      const v = root.PG_VERSION || {};
      const desk = root.pressgoDesktop;
      const rows = [['PressGO', v.version ? 'Version ' + v.version : 'Version not available']];
      if (v.build) rows.push(['Released', v.build]);
      rows.push(['Running as', desk ? 'Windows desktop app' : 'Web browser']);
      if (desk) rows.push(['Desktop app version', '<span id="dver">checking…</span>']);
      rows.push(['Signed in as', esc(me.display_name) + ' (' + esc(S.roleText(me)) + ')']);
      el.innerHTML = `<div class="fgroup"><h4>About PressGO</h4><dl class="facts">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${k === 'Desktop app version' ? val : (k === 'Signed in as' ? val : esc(val))}</dd>`).join('')}</dl>
        <p class="note">PressGO is the job tracking and team chat for Reliable Printers &amp; Stationery Ltd. If something is not working, tell a manager which page you were on and what you clicked.</p></div>`;
      if (desk && desk.update && desk.update.getState) {
        Promise.resolve(desk.update.getState()).then((s) => {
          const d = el.querySelector('#dver'); if (d) d.textContent = (s && s.currentVersion) || 'not available';
        }).catch(() => { const d = el.querySelector('#dver'); if (d) d.textContent = 'not available'; });
      }
    },
  };

  root.viewSettings = function viewSettings(section) {
    const id = S.IDS.includes(section) ? section : S.IDS[0];
    const nav = S.SECTIONS.map((s) => `<a class="snav ${s.id === id ? 'on' : ''}" href="${S.settingsHref(s.id)}" ${s.id === id ? 'aria-current="page"' : ''}><b>${esc(s.label)}</b><small>${esc(s.hint)}</small></a>`).join('');
    const title = S.SECTIONS.find((s) => s.id === id).label;
    shell('settings', `<div class="pagehead"><div><h2>Settings</h2></div></div>
      <div class="settings"><nav class="snavlist" aria-label="Settings sections">${nav}</nav>
      <section class="card spanel" aria-labelledby="sh"><h3 id="sh">${esc(title)}</h3><div id="sbody"></div></section></div>`);
    panels[id](document.getElementById('sbody'));
    const on = document.querySelector('.snav.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });   // on a phone the section list scrolls sideways: show the open one
  };
})(window);
