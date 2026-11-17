'use strict';
// PressGO personal look: appearance (System / Light / Dark) and accent colour.
// Loaded in <head> so a saved choice is applied before the first paint (no flash). The saved copy that lives on the
// server (table employee_preferences) is what counts; the copy in this browser only avoids the flash and is replaced
// by the server's copy as soon as someone signs in. Pure functions are exported so they can be tested without a browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.pgPrefs = api; api.start(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const THEMES = ['system', 'light', 'dark'];
  // The accent changes buttons, links and highlights. Every colour here is checked for readable contrast (on the page, cards and raised
  // surfaces) in desktop/test/prefs-web.test.js, and must match the same colours in style.css and the list in migration 0016.
  // brand = links and highlights (text on the page), btn = button fill (white text on it), btnH = button hover.
  const ACCENTS = {
    // The default. Its stored name stays "purple" because the database already lists that name; it is Press Blue (from the logo).
    purple:   { label: 'Press Blue', light: { brand: '#0a6a9e', btn: '#0a6a9e', btnH: '#085784' }, dark: { brand: '#5cc0f2', btn: '#0a6fa8', btnH: '#095f90' } },
    blue:     { label: 'Royal blue',     light: { brand: '#1d4ed8', btn: '#1d4ed8', btnH: '#1e40af' }, dark: { brand: '#8fb4ff', btn: '#2f66e0', btnH: '#2457cc' } },
    teal:     { label: 'Teal',     light: { brand: '#0f766e', btn: '#0f766e', btnH: '#115e59' }, dark: { brand: '#5eead4', btn: '#0e7a70', btnH: '#0b6a61' } },
    green:    { label: 'Green',    light: { brand: '#13763a', btn: '#13763a', btnH: '#115c2e' }, dark: { brand: '#6ee7a0', btn: '#147d40', btnH: '#106e37' } },
    orange:   { label: 'Orange',   light: { brand: '#a84c08', btn: '#a84c08', btnH: '#8a3f07' }, dark: { brand: '#fdba74', btn: '#b9500a', btnH: '#a24509' } },
    graphite: { label: 'Graphite', light: { brand: '#475569', btn: '#475569', btnH: '#334155' }, dark: { brand: '#b6c2d4', btn: '#5a6b82', btnH: '#4c5c72' } }
  };
  const DEFAULTS = Object.freeze({ theme: 'system', accent: 'purple' });
  const KEY = 'pressgo.look.v1';

  // anything unexpected becomes the default, so a bad saved value can never break the page
  function normalize(p) {
    const o = p && typeof p === 'object' ? p : {};
    return {
      theme: THEMES.includes(o.theme) ? o.theme : DEFAULTS.theme,
      accent: Object.prototype.hasOwnProperty.call(ACCENTS, o.accent) ? o.accent : DEFAULTS.accent
    };
  }
  const resolveScheme = (theme, systemDark) => (theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : systemDark ? 'dark' : 'light');

  let current = { ...DEFAULTS }, mq = null;
  const systemDark = () => !!(mq && mq.matches);

  // put the choice on <html>: style.css does the rest
  function apply(prefs, doc) {
    current = normalize(prefs);
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return current;
    const el = d.documentElement;
    el.setAttribute('data-scheme', resolveScheme(current.theme, systemDark()));
    el.setAttribute('data-accent', current.accent);
    // native controls (date pickers, scrollbars) follow an explicit choice; "System" leaves the browser's own behaviour alone
    el.style.colorScheme = current.theme === 'system' ? '' : current.theme;
    return current;
  }
  function recall(storage) {
    try { return normalize(JSON.parse((storage || localStorage).getItem(KEY))); } catch (e) { return { ...DEFAULTS }; }
  }
  function remember(prefs, storage) {
    try { (storage || localStorage).setItem(KEY, JSON.stringify(normalize(prefs))); } catch (e) { /* private mode: the server copy still works */ }
  }
  function start() {
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { mq = null; }
    apply(recall());
    // "System" follows the computer live, e.g. when it switches to dark at sunset
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (current.theme === 'system') apply(current); });
  }
  return { THEMES, ACCENTS, DEFAULTS, normalize, resolveScheme, apply, recall, remember, start, get: () => ({ ...current }) };
});
