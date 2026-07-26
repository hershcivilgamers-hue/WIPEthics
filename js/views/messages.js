// =============================================================================
// views/messages.js — Operator messaging.
//
// Private operator-to-operator comms. A conversation is simply a set of
// participants — no separate thread record — so a message carries its own
// participant list, and the redactor ships it only to those people (or an
// Administrator, for moderation). A message is immutable once sent; a sender may
// withdraw their own. Read state is per-browser (msg-read.js). One route,
// #/messages: an inbox that opens into a thread in place.
// =============================================================================

import { messages, getMessage, upsertMessage, users, getUser, newId } from '../storage.js';
import { canMessage, canViewMessage, isAdmin } from '../permissions.js';
import { logAction } from '../audit.js';
import { markRead, isUnread, unreadCount } from '../msg-read.js';
import { esc, fmtDateTime, relTime, monogram, toast, openModal, confirmDialog } from '../ui.js';
import { ORGS } from '../constants.js';

const convKey = (participants) => [...participants].sort().join('|');
let openConv = null; // the participant-set key of the thread being read, or null
let lastActor = null; // reset the open thread when a different operator signs in

// All messages this operator may see, newest last within a conversation.
function myMessages(actor) {
  return messages()
    .filter((m) => !m.deleted && canViewMessage(actor, m))
    .sort((a, b) => (a.at || '').localeCompare(b.at || ''));
}

function othersLabel(participants, actorId) {
  const others = participants.filter((id) => id !== actorId).map((id) => {
    const u = getUser(id);
    return u ? `${u.designation} · ${u.codename}` : 'Unknown operator';
  });
  return others.length ? others.join(', ') : 'You';
}

// --- Inbox ------------------------------------------------------------------
function renderInbox(host, app) {
  const actor = app.user;
  const mine = myMessages(actor);

  // Group into conversations by participant set; keep the latest per conversation.
  const convs = new Map();
  for (const m of mine) {
    const k = convKey(m.participants);
    const c = convs.get(k) || { key: k, participants: m.participants, latest: m, unread: 0 };
    c.latest = m; // list is time-sorted ascending, so the last seen wins
    if (isUnread(m, actor.id)) c.unread += 1;
    convs.set(k, c);
  }
  const rows = [...convs.values()].sort((a, b) => (b.latest.at || '').localeCompare(a.latest.at || ''));

  const list = rows.length ? rows.map((c) => `
    <button class="msg-row ${c.unread ? 'msg-row--unread' : ''}" data-conv="${esc(c.key)}">
      <span class="msg-row__who">${esc(othersLabel(c.participants, actor.id))}${c.participants.length > 2 ? ` <span class="badge badge--muted">${c.participants.length} people</span>` : ''}</span>
      <span class="msg-row__preview">${c.latest.from === actor.id ? 'You: ' : ''}${esc((c.latest.body || '').slice(0, 90))}</span>
      <span class="msg-row__meta">${esc(relTime(c.latest.at))}${c.unread ? ` <span class="badge badge--warn">${c.unread}</span>` : ''}</span>
    </button>`).join('') : '<div class="req-empty">No messages yet. Start a conversation.</div>';

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · Comms</div>
        <h1 class="page-title">Messages</h1>
        <div class="page-sub">Private operator-to-operator comms${isAdmin(actor) ? ' · you hold Administrator read-through' : ''}</div>
      </div>
      <button class="btn btn--primary" id="msg-new">+ New message</button>
    </div>
    <div class="card"><div class="card__body msg-list">${list}</div></div>`;

  host.querySelector('#msg-new').addEventListener('click', () => openCompose(app));
  host.querySelectorAll('[data-conv]').forEach((b) => b.addEventListener('click', () => { openConv = b.dataset.conv; app.refresh(); }));
}

// --- Thread -----------------------------------------------------------------
function renderThread(host, app, key) {
  const actor = app.user;
  const thread = myMessages(actor).filter((m) => convKey(m.participants) === key);
  if (!thread.length) { openConv = null; renderInbox(host, app); return; }
  const participants = thread[0].participants;

  // Opening the thread reads everything currently in it.
  markRead(actor.id, thread.map((m) => m.id));

  const bubbles = thread.map((m) => {
    const mine = m.from === actor.id;
    const u = getUser(m.from);
    return `<div class="msg-bubble ${mine ? 'msg-bubble--mine' : ''}">
      <div class="msg-bubble__head">
        <span class="mono">${esc(u ? u.designation : 'Unknown')}</span>
        <span class="msg-bubble__time">${esc(fmtDateTime(m.at))}</span>
        ${(mine || isAdmin(actor)) ? `<button class="msg-bubble__del" data-del="${esc(m.id)}" title="Withdraw" aria-label="Withdraw message">✕</button>` : ''}
      </div>
      <div class="msg-bubble__body">${esc(m.body)}</div>
    </div>`;
  }).join('');

  host.innerHTML = `
    <div class="file-actions">
      <button class="btn btn--ghost btn--sm" id="msg-back">← Messages</button>
    </div>
    <div class="page-head"><div>
      <div class="eyebrow">Conversation</div>
      <h1 class="page-title">${esc(othersLabel(participants, actor.id))}</h1>
      ${participants.length > 2 ? '<div class="page-sub">Group conversation</div>' : ''}
    </div></div>
    <div class="card"><div class="card__body msg-thread">${bubbles}</div></div>
    <div class="card"><div class="card__body">
      <div class="field"><textarea id="msg-reply" rows="3" placeholder="Write a reply…"></textarea></div>
      <div class="btn-row" style="margin-top:8px;justify-content:flex-end"><button class="btn btn--primary" id="msg-send">Send</button></div>
    </div></div>`;

  host.querySelector('#msg-back').addEventListener('click', () => { openConv = null; app.refresh(); });
  host.querySelector('#msg-send').addEventListener('click', () => {
    const body = host.querySelector('#msg-reply').value;
    if (!body.trim()) { toast('Write a message first.', 'error'); return; }
    send(app, participants, body);
  });
  host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => withdraw(app, b.dataset.del)));
}

// --- Actions ----------------------------------------------------------------
function send(app, participants, body) {
  const now = new Date().toISOString();
  const rec = {
    id: newId('msg'),
    from: app.user.id,
    participants: [...new Set(participants)].sort(),
    body: body.trim(),
    at: now,
    deleted: false, deletedAt: null,
    version: 1, createdAt: now, updatedAt: now,
  };
  upsertMessage(rec);
  markRead(app.user.id, rec.id);
  logAction(app.user, 'SEND_MESSAGE', `Sent a message to ${rec.participants.length - 1} recipient${rec.participants.length - 1 === 1 ? '' : 's'}.`);
  openConv = convKey(rec.participants);
  app.refresh();
}

async function withdraw(app, id) {
  const m = getMessage(id);
  if (!m) return;
  const ok = await confirmDialog({ title: 'Withdraw message', message: 'Withdraw this message? It will be removed for everyone.', confirmLabel: 'Withdraw', danger: true });
  if (!ok) return;
  const fresh = getMessage(id);
  if (!fresh) { app.refresh(); return; }
  fresh.deleted = true; fresh.deletedAt = new Date().toISOString();
  fresh.version = (fresh.version || 1) + 1; fresh.updatedAt = fresh.deletedAt;
  upsertMessage(fresh);
  logAction(app.user, 'REMOVE_MESSAGE', 'Withdrew a message.');
  toast('Message withdrawn.', 'success');
  app.refresh();
}

function openCompose(app) {
  const actor = app.user;
  const roster = users()
    .filter((u) => !u.deleted && u.accountStatus === 'active' && u.id !== actor.id)
    .sort((a, b) => (a.designation || '').localeCompare(b.designation || ''));
  const opts = roster.map((u) => `<label class="msg-pick"><input type="checkbox" value="${esc(u.id)}" /> <span class="mono">${esc(u.designation)}</span> ${esc(u.codename)}</label>`).join('');
  openModal({
    title: 'New message',
    wide: true,
    body: `<div class="field"><label>Recipients</label><div class="msg-picks">${opts || '<span class="muted-text">No other active operators.</span>'}</div></div>
      <div class="field"><label>Message</label><textarea id="msg-body" rows="4" placeholder="Write your message…"></textarea></div>
      <div id="msg-err" class="auth__error" hidden></div>`,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Send', tone: 'primary', onClick: (c, d) => {
          const to = [...d.querySelectorAll('.msg-picks input:checked')].map((i) => i.value);
          const body = d.querySelector('#msg-body').value;
          const err = d.querySelector('#msg-err');
          err.hidden = true;
          if (!to.length) { err.textContent = 'Choose at least one recipient.'; err.hidden = false; return; }
          if (!body.trim()) { err.textContent = 'Write a message.'; err.hidden = false; return; }
          send(app, [actor.id, ...to], body);
          c();
          toast('Message sent.', 'success');
        } },
    ],
  });
}

export function render(host, app) {
  if (lastActor !== app.user.id) { openConv = null; lastActor = app.user.id; }
  if (!canMessage(app.user)) { host.innerHTML = '<div class="req-empty">Messaging is available to active operators.</div>'; return; }
  if (openConv) renderThread(host, app, openConv);
  else renderInbox(host, app);
}

// Exported for the notification feed: the operator's total unread count.
export function unreadMessages(actor) {
  return unreadCount(myMessages(actor), actor.id);
}
