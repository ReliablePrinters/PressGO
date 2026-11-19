'use strict';
// PressGO Settings: the small rules behind the Settings page (which section a link opens, password checks, how a person is described).
// Pure functions only (no screen, no network) so desktop/test/settings.test.js can check every rule without a browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgSettings = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SECTIONS = [
    { id: 'profile', label: 'Profile', hint: 'Your picture and account details' },
    { id: 'security', label: 'Security', hint: 'Change your password' },
    { id: 'notifications', label: 'Notifications', hint: 'Sounds, banners and alert types' },
    { id: 'appearance', label: 'Appearance', hint: 'Light, dark and accent colour' },
    { id: 'keyboard', label: 'Keyboard', hint: 'Shortcuts for faster navigation' },
    { id: 'about', label: 'About', hint: 'Version and app information' },
  ];
  const IDS = SECTIONS.map((s) => s.id);

  // #/settings -> profile, #/settings/security -> security. Anything that is not a Settings link returns null; an unknown section opens the first.
  function parseSettingsHash(hash) {
    const m = /^#\/settings(?:\/([a-z-]*))?$/.exec(String(hash || ''));
    if (!m) return null;
    return IDS.includes(m[1]) ? m[1] : IDS[0];
  }
  const settingsHref = (id) => '#/settings' + (IDS.includes(id) && id !== IDS[0] ? '/' + id : '');

  // The server (admin-users) accepts 8 to 72 characters; 72 is the most the password scheme can use.
  const PASSWORD = { MIN: 8, MAX: 72 };
  // What a person sees while typing: each rule is true/false, `errors` are plain sentences for whatever is wrong right now.
  function checkPassword(o) {
    const cur = String((o && o.current) || ''), next = String((o && o.next) || ''), again = String((o && o.again) || '');
    const rules = {
      current: cur.length > 0,
      length: next.length >= PASSWORD.MIN && next.length <= PASSWORD.MAX,
      different: next.length > 0 && next !== cur,
      match: next.length > 0 && next === again,
    };
    const errors = [];
    if (!rules.current) errors.push('Type your current password.');
    if (next.length < PASSWORD.MIN) errors.push(`The new password must be at least ${PASSWORD.MIN} characters.`);
    else if (next.length > PASSWORD.MAX) errors.push(`The new password is too long (${PASSWORD.MAX} characters at most).`);
    else if (cur && next === cur) errors.push('The new password must be different from your current one.');
    if (next.length >= PASSWORD.MIN && again !== next) errors.push('The two new passwords do not match.');
    return { ok: errors.length === 0, rules, errors };
  }
  // Supabase's own messages are technical; give the ones people can actually meet a plain sentence.
  function friendlyAuthError(message) {
    const m = String(message || '');
    if (/invalid login|invalid credentials/i.test(m)) return 'Your current password is not right.';
    if (/same.*password|different from the old/i.test(m)) return 'The new password must be different from your current one.';
    if (/at least \d+ char|too short|weak|should contain/i.test(m)) return 'That password is not strong enough. Try a longer one with a mix of letters and numbers.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Please wait a minute and try again.';
    if (/network|fetch|failed to/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
    return m ? 'Your password was not changed: ' + m : 'Your password was not changed. Please try again.';
  }

  const roleText = (me) => [me && me.manager_role ? 'Manager' : '', me && me.front_desk ? 'Front Desk' : ''].filter(Boolean).join(' · ') || 'Staff';
  const joinNames = (names) => (names && names.length ? names.join(', ') : 'None yet');
  function sinceText(iso) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
  }

  return { SECTIONS, IDS, parseSettingsHash, settingsHref, PASSWORD, checkPassword, friendlyAuthError, roleText, joinNames, sinceText };
});
