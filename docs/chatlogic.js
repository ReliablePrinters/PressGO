'use strict';
// PressGO messaging helpers: the small rules behind message links, replies, unread markers, alert grouping and sounds.
// Pure functions only (no screen, no network) so desktop/test/chatlogic.test.js can check every rule without a browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.pgChat = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isId = (v) => typeof v === 'string' && UUID.test(v);
  const oneLine = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

  // ---- where a link goes:  #/chat/<chat>            the chat
  //                         #/chat/<chat>/<message>   the chat, scrolled to that message
  //                         #/chat/job/<job>          the chat of a job
  function parseChatHash(hash) {
    const h = String(hash || '');
    let m = /^#\/chat\/job\/([0-9a-f-]{36})$/i.exec(h);
    if (m && isId(m[1])) return { job: m[1] };
    m = /^#\/chat\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?$/i.exec(h);
    if (!m || !isId(m[1])) return null;
    if (m[2] && !isId(m[2])) return null;
    return { conv: m[1], msg: m[2] || null };
  }
  function chatHref(conv, msg) {
    if (!isId(conv)) return null;
    return '#/chat/' + conv + (isId(msg) ? '/' + msg : '');
  }
  // an alert opens the exact message when it knows one, otherwise the chat, otherwise the job, otherwise nothing
  function alertHref(n) {
    if (!n) return null;
    if (isId(n.conversation_id)) return chatHref(n.conversation_id, n.message_id);
    if (isId(n.job_id)) return '#/job/' + n.job_id;
    return null;
  }

  // ---- the quoted preview shown above a reply. `reply` is the original message row (or null if it cannot be read).
  function quoteInfo(reply) {
    if (!reply) return { gone: true, who: '', preview: 'The original message is not available', id: null };
    const who = (reply.author && reply.author.display_name) || '';
    if (reply.hidden_at) return { gone: true, who, preview: 'This message was deleted', id: reply.id || null };
    const pic = !!reply.attachment_path;
    const body = oneLine(reply.body, 140);
    const preview = pic ? (body && body !== 'Photo' ? 'Picture: ' + body : 'Picture') : body;
    return { gone: false, who, preview, id: reply.id || null };
  }

  // ---- unread marker inside a chat: the first message from someone else that arrived after you last read the chat
  function firstUnreadIndex(msgs, lastReadAt, meId) {
    if (!lastReadAt) return -1;
    const t = Date.parse(lastReadAt);
    if (Number.isNaN(t)) return -1;
    for (let i = 0; i < msgs.length; i++) if (msgs[i].author_id !== meId && Date.parse(msgs[i].sent_at) > t) return i;
    return -1;
  }
  // the loaded page of messages must reach back to the one we want to show. Returns how many to load (never the whole history).
  function windowSize(totalSinceTarget, base, cap) {
    const b = base || 200, c = cap || 600;
    return Math.min(c, Math.max(b, (totalSinceTarget || 0) + 20));
  }

  // ---- alerts: unread / all views and grouping of related alerts (same kind, same chat or job, next to each other)
  const unreadOf = (list) => (list || []).filter((n) => !n.read_at);
  function view(list, tab) { return tab === 'unread' ? unreadOf(list) : (list || []); }
  function groupKey(n) { return n.kind + '|' + (n.conversation_id || n.job_id || ''); }
  function groupAlerts(list) {
    const groups = [];
    for (const n of list || []) {
      const last = groups[groups.length - 1];
      const key = groupKey(n);
      if (last && last.key === key && (n.conversation_id || n.job_id)) last.items.push(n);
      else groups.push({ key, kind: n.kind, items: [n] });
    }
    return groups.map((g) => ({ ...g, latest: g.items[0], unread: g.items.filter((x) => !x.read_at).length }));
  }

  // ---- sounds and the window title
  // mode: 'dm' = private messages and Urgent only (same words as the desktop notification setting), 'all', 'off'
  function soundAllowed(conv, mode) {
    if (mode === 'off') return false;
    if (mode === 'all') return true;
    return !!conv && (conv.type === 'direct' || conv.type === 'urgent');
  }
  // Play for a new message from somebody else when you are not already reading that chat in the window you are using.
  function shouldPlaySound(o) {
    if (!o || o.mode === 'off') return false;
    if (o.row && (o.row.author_id === o.meId || o.row.hidden_at)) return false;
    if (!soundAllowed(o.conv, o.mode)) return false;
    const reading = o.row && o.currentConv === o.row.conversation_id && o.visible && o.focused;
    return !reading;
  }
  function titleWith(base, unreadMessages, unreadAlerts) {
    const n = (Number(unreadMessages) || 0) + (Number(unreadAlerts) || 0);
    return n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base;
  }

  // ---- alert types as people see them in Settings > Notifications. Turning a type off hides its banner, sound and Windows
  // notification on this computer; the alert itself always still appears on the Alerts page.
  const ALERT_GROUPS = [
    { id: 'reply', label: 'Replies to my messages', kinds: ['reply'] },
    { id: 'approval', label: 'Picture approvals (approved, or taken back)', kinds: ['approved', 'approval_withdrawn'] },
    { id: 'assigned', label: 'Jobs given to me, or deleted', kinds: ['assigned', 'job_deleted'] },
    { id: 'handoff', label: 'Jobs handed to my department', kinds: ['handoff'] },
    { id: 'problem', label: 'Problems raised on my jobs', kinds: ['problem'] },
    { id: 'task', label: 'Tasks', kinds: ['task'] },
  ];
  const alertGroup = (kind) => { const g = ALERT_GROUPS.find((x) => x.kinds.includes(kind)); return g ? g.id : 'other'; };

  return { UUID, isId, parseChatHash, chatHref, alertHref, quoteInfo, firstUnreadIndex, windowSize, unreadOf, view, groupKey, groupAlerts, soundAllowed, shouldPlaySound, titleWith, oneLine, ALERT_GROUPS, alertGroup };
});
