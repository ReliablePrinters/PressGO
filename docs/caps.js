'use strict';
// PressGO database capabilities.
//
// PressGO 2.0 can be published before the database updates 0015 to 0018 are applied. Until then the features that need them are switched off
// (hidden, or replaced by a short explanation); the moment the updates are applied they switch on by themselves (no new release, a page reload is enough).
//
//   0015 avatars    profile pictures            (table employee_avatars, functions set_avatar / remove_avatar, bucket "avatars")
//   0016 prefs      the saved look              (table employee_preferences, function set_preferences)
//   0017 deleteJob  deleting a job              (columns jobs.deleted_at/deleted_by/delete_reason, function delete_job)
//   0018 links      "mark as unread", replying with a PICTURE, alerts that open the message
//                                              (columns notifications.conversation_id/message_id, function mark_unread, the reply argument of send_attachment)
//                  Replying with TEXT is not in this list: send_message has taken a reply since migration 0005, so it works with the older database too
//                  (only the "someone replied to you" alert for it needs 0018).
//
// How it knows: once after sign-in, start() reads zero rows of one column per update. That is a read that cannot change anything. A missing table or column
// means "not applied yet". Any OTHER kind of failure (network, permissions) leaves the feature in its normal state, and every call that needs a
// feature is guarded as well (isMissing + markMissing), so a wrong guess shows the same error message as before and never a success message.
// The pure parts can be tested without a browser (desktop/test/caps.test.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgCaps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // feature -> the update that adds it, and the cheapest proof that the update is there (one column of one table, zero rows read)
  const FEATURES = {
    avatars:   { migration: '0015', table: 'employee_avatars',     column: 'employee_id', text: 'Profile pictures are not available yet. Your initials are shown instead.' },
    prefs:     { migration: '0016', table: 'employee_preferences', column: 'theme',       text: 'Choosing a look (light, dark and accent colour) is not available yet.' },
    deleteJob: { migration: '0017', table: 'jobs',                 column: 'deleted_at',  text: 'Deleting a job is not available yet.' },
    links:     { migration: '0018', table: 'notifications',        column: 'message_id',  text: 'Marking a chat as unread, and replying with a picture, are not available yet.' }
  };
  const NAMES = Object.keys(FEATURES);
  const GENERIC = 'This feature is not available yet. Nothing was changed.';
  // PostgREST / PostgreSQL codes for "that function, table or column does not exist (yet)"
  const MISSING_CODES = ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703'];

  // Is this error "the database does not have it", as opposed to a real failure? Errors raised by PressGO's own functions (P0001 and friends),
  // constraint errors and network errors are never treated as "missing".
  function isMissing(err) {
    if (!err) return false;
    const o = typeof err === 'object' ? err : { message: String(err) };
    const code = String(o.code || '').toUpperCase();
    const status = Number(o.status || o.statusCode || 0);
    const msg = String(o.message || o.error || o.details || '').toLowerCase();
    if (MISSING_CODES.includes(code)) return true;
    if (/^P\d{4}$/.test(code) || /^(22|23|28|40|42501|53|54|55|57|58)/.test(code)) return false;
    if (/bucket not found/.test(msg)) return true;                                   // storage: the "avatars" bucket does not exist
    if (/could not find the (function|table|column)\b/.test(msg) || /in the schema cache/.test(msg)) return true;
    if ((!code || /^PGRST/.test(code) || /^42/.test(code) || status === 404 || status === 400)
        && /\b(function|table|column|relation)\b[\s\S]{0,160}?does not exist/.test(msg)) return true;
    return false;
  }

  const state = {};            // feature -> false (known missing) | true (known present); absent = not known
  const listeners = [];
  let readyPromise = null;
  const snapshot = () => Object.fromEntries(NAMES.map((n) => [n, state[n] === undefined ? null : state[n]]));
  const fire = (name) => { listeners.slice().forEach((f) => { try { f(name, state[name]); } catch (e) { /* a listener must never break the app */ } }); };

  // unknown counts as available: the features work exactly as before, and each call is guarded
  const has = (name) => state[name] !== false;
  function markMissing(name) { if (NAMES.includes(name) && state[name] !== false) { state[name] = false; fire(name); } }
  function markPresent(name) { if (NAMES.includes(name) && state[name] !== true) { state[name] = true; fire(name); } }
  const unavailable = (name) => (FEATURES[name] ? FEATURES[name].text : GENERIC);
  const onChange = (f) => { listeners.push(f); };

  // zero rows of one column: PostgREST answers 200 and [] when it exists, and a "not found" error when it does not
  async function probe(sb) {
    await Promise.all(NAMES.map(async (n) => {
      const f = FEATURES[n];
      let r;
      try { r = await sb.from(f.table).select(f.column).limit(0); } catch (e) { r = { error: e }; }
      if (!r || !r.error) markPresent(n);
      else if (isMissing(r.error)) markMissing(n);
      // anything else (network, permissions): not known, stays available
    }));
    return snapshot();
  }
  // Called once after sign-in. Resolves when the check is done, or after maxMs at the latest (a slow network must never keep anyone waiting).
  function start(sb, maxMs) {
    readyPromise = probe(sb).catch(() => snapshot());
    return Promise.race([readyPromise, new Promise((r) => setTimeout(() => r(snapshot()), maxMs || 4000))]);
  }
  const ready = () => readyPromise || Promise.resolve(snapshot());
  function reset() { NAMES.forEach((n) => { delete state[n]; }); readyPromise = null; }

  // run something that needs a feature; if the database says the feature is missing, remember it and report that instead of failing noisily
  async function guard(name, fn, onUnavailable) {
    try { return await fn(); } catch (e) {
      if (isMissing(e)) { markMissing(name); if (onUnavailable) onUnavailable(unavailable(name)); return undefined; }
      throw e;
    }
  }
  // the text people see for an error: "not available yet" for a missing feature, the normal text otherwise
  const friendlyText = (err, fallback) => (isMissing(err) ? GENERIC : fallback);

  return { FEATURES, NAMES, GENERIC, MISSING_CODES, isMissing, has, markMissing, markPresent, unavailable, onChange, probe, start, ready, reset, guard, friendlyText, snapshot };
});
