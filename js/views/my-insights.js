// =============================================================================
// my-insights.js — an operator's own activity insights (self only).
//
// Reads only data the operator already receives in their snapshot (their
// activity log, trainings, awards), so there is no new access surface — no gate
// or redaction change. Shows weekly activity hours over time against their
// requirement, and training currency. Engagement (Omega/ISD) is scored on its
// own board, linked here rather than reproduced.
// =============================================================================

import { esc, fmtDate, readoutStrip, countUp } from '../ui.js';
import { getActivityForUser, getSetting, getTraining } from '../storage.js';
import {
  activityStatus, mergeActivityReqs, ACTIVITY_REQ_SETTING_ID,
  weekStart, sumHours, ACTIVITY_STATUS,
} from '../constants.js';

const WEEKS = 10;
const WEEK_MS = 7 * 24 * 3600000;
const h = (n) => (Number.isInteger(n) ? n : +Number(n).toFixed(1));
const statusTone = (t) => (t === 'ok' ? 'ok' : t === 'warn' ? 'warn' : t === 'bad' ? 'alert' : undefined);

export function render(host, app) {
  const actor = app.user;
  const reqs = mergeActivityReqs((getSetting(ACTIVITY_REQ_SETTING_ID) || {}).data);
  const record = getActivityForUser(actor.id);
  const log = (record && record.log) || [];
  const now = Date.now();
  const st = activityStatus(actor, record, reqs, now);
  const weekly = (st.req && st.req.weekly) || 0;

  // Weekly hours, most-recent-last (Monday-start weeks).
  const thisWk = weekStart(now);
  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const ws = thisWk - i * WEEK_MS;
    weeks.push({ ws, hours: sumHours(log, ws, ws + WEEK_MS - 1) });
  }
  const maxH = Math.max(weekly, ...weeks.map((w) => w.hours), 1);
  const metWeeks = weekly ? weeks.filter((w) => w.hours >= weekly).length : 0;

  const bars = weeks.map((w) => {
    const pct = Math.max(2, Math.round((w.hours / maxH) * 100));
    const cls = weekly ? (w.hours >= weekly ? 'ins-bar--ok' : 'ins-bar--under') : '';
    const d = new Date(w.ws);
    return `<div class="ins-bar ${cls}" title="${d.toLocaleDateString()} — ${h(w.hours)}h">
      <span class="ins-bar__val">${w.hours ? h(w.hours) : ''}</span>
      <span class="ins-bar__track"><span class="ins-bar__fill" style="height:${pct}%"></span></span>
      <span class="ins-bar__lbl">${d.getDate()}/${d.getMonth() + 1}</span>
    </div>`;
  }).join('');

  // Training currency — latest completion per course.
  const byCourse = new Map();
  for (const t of (actor.trainings || [])) {
    const prev = byCourse.get(t.courseId);
    if (!prev || new Date(t.awardedAt) > new Date(prev.awardedAt)) byCourse.set(t.courseId, t);
  }
  const trList = [...byCourse.values()];
  const trCur = trList.filter((t) => !t.expiresAt || new Date(t.expiresAt).getTime() > now).length;
  const soon = now + 30 * 24 * 3600000;
  const trRows = trList.sort((a, b) => new Date(b.awardedAt) - new Date(a.awardedAt)).map((t) => {
    const c = getTraining(t.courseId);
    const name = c ? `${c.code ? `${esc(c.code)} — ` : ''}${esc(c.title)}` : esc(t.courseId);
    let tag = '<span class="badge badge--ok">Current</span>';
    if (t.expiresAt) {
      const exp = new Date(t.expiresAt).getTime();
      if (exp <= now) tag = '<span class="badge badge--bad">Expired</span>';
      else if (exp <= soon) tag = '<span class="badge badge--warn">Expiring soon</span>';
    }
    return `<tr><td>${name}</td><td class="cell-right">${t.expiresAt ? fmtDate(t.expiresAt) : '—'}</td><td class="cell-right">${tag}</td></tr>`;
  }).join('');

  const statusMeta = ACTIVITY_STATUS[st.key] || { label: st.key };
  const readout = readoutStrip([
    { k: 'This week', value: `${h(st.weekHours)}${weekly ? `<small>/${weekly}h</small>` : 'h'}`, frac: weekly ? Math.min(1, st.weekHours / weekly) : (st.weekHours ? 1 : 0), tone: weekly ? (st.weekHours >= weekly ? 'ok' : 'warn') : undefined },
    { k: 'Status', value: esc(statusMeta.label), frac: st.key === 'active' ? 1 : (st.key === 'semi' ? 0.5 : 0), tone: statusTone(statusMeta.tone) },
    { k: `Weeks met of ${WEEKS}`, count: metWeeks, frac: metWeeks / WEEKS, tone: metWeeks >= Math.ceil(WEEKS * 0.7) ? 'ok' : 'warn' },
    { k: 'Trainings current', value: trList.length ? `${trCur}<small>/${trList.length}</small>` : '0', frac: trList.length ? trCur / trList.length : 0, tone: trList.length ? (trCur < trList.length ? 'warn' : 'ok') : undefined },
    { k: 'Decorations', count: (actor.awards || []).length, frac: Math.min(1, (actor.awards || []).length / 5) },
  ]);

  const engHash = actor.org === 'isd' ? '#/isd/engagement' : '#/engagement';
  const engLink = (actor.org === 'omega-1' || actor.org === 'isd')
    ? `<section class="card rise" style="margin-top:16px"><div class="card__body"><p class="restricted-line">Your weekly engagement is scored on the <a class="rec-link" href="${engHash}">Engagement board</a>.</p></div></section>`
    : '';

  host.innerHTML = `
    <div class="page-head rise">
      <div>
        <div class="eyebrow">CAIRO · Personal</div>
        <h1 class="page-title">My Insights</h1>
        <div class="page-sub">Your activity, readiness and qualifications over time</div>
      </div>
    </div>
    ${readout}
    <section class="card rise" style="margin-top:16px">
      <div class="card__title">Activity — last ${WEEKS} weeks${weekly ? ` · requirement ${weekly}h / week` : ' · no weekly requirement'}</div>
      <div class="card__body"><div class="ins-bars">${bars}</div></div>
    </section>
    <section class="card rise" style="margin-top:16px">
      <div class="card__title">Qualifications${trList.length ? ` · ${trCur}/${trList.length} current` : ''}</div>
      <div class="card__body">${trList.length
        ? `<table class="table"><thead><tr><th>Training</th><th class="cell-right">Expires</th><th class="cell-right">Status</th></tr></thead><tbody>${trRows}</tbody></table>`
        : '<p class="restricted-line">No trainings recorded yet.</p>'}</div>
    </section>
    ${engLink}
  `;
  countUp(host);
}
