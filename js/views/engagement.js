// =============================================================================
// views/engagement.js — Omega-1 weekly engagement board.
//
// One row per active Omega-1 operator, grouped by rank, scoring eight sections
// out of a weekly total. Five sections are derived live from the logs
// (engagement.js); a Sr CL4 reviewer enters the judgement sections (Evidence,
// Squadron, RP) and may override any derived score for quality. The review week
// runs Sunday→Saturday; ◀ / ▶ move between weeks. Every manual write routes
// through the permission engine and is re-authorised by the Worker (Sr CL4 with
// an Omega stake, or CL5).
// =============================================================================

import {
  ORGS, engagementSections, engagementMaxFor, engagementTotalMax,
  engagementWeekStart, engagementWeekShift, rankIndex,
  ACTIVITY_STATUS, ACTIVITY_REQ_SETTING_ID, mergeActivityReqs, activityStatus,
} from '../constants.js';
import { engagementModel } from '../engagement.js';
import { users, getEngagement, getEngagementFor, upsertEngagement, newId, getActivityForUser, getSetting } from '../storage.js';
import { isCL5, canManageOrg, isISD, canManageISD } from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, fmtDate, toast, openModal } from '../ui.js';
import { exportEngagementSummary } from '../export.js';

// The board is per-organisation. `curOrg` tracks the board being viewed so the
// editor/save helpers below score against the right section set.
let curOrg = 'omega-1';
let viewWeek = engagementWeekStart();

// Omega scoring is a Sr CL4 command tool; ISD scoring belongs to ISD command
// (judged on the ISD ladder, never the cover clearance).
const canEdit = (actor, org = curOrg) => (org === 'isd' ? canManageISD(actor) : (isCL5(actor) || canManageOrg(actor, org)));

function weekLabel(ws) {
  return `${fmtDate(new Date(ws).toISOString())} – ${fmtDate(new Date(ws + 6 * 86400000).toISOString())}`;
}

// The active Omega-1 roster, most-senior rank first (rows grouped by rank).
function roster(org) {
  const isd = org === 'isd';
  return users()
    .filter((u) => !u.deleted && u.accountStatus === 'active' && u.status !== 'discharged'
      && (isd ? isISD(u) : u.org === org))
    .sort((a, b) => {
      const ra = isd ? rankIndex('isd', a.isd?.rank) : rankIndex(org, a.rank);
      const rb = isd ? rankIndex('isd', b.isd?.rank) : rankIndex(org, b.rank);
      return (ra - rb) || (a.designation || '').localeCompare(b.designation || '');
    });
}

export function render(host, app, org = 'omega-1') {
  curOrg = org;
  const actor = app.user;
  const editable = canEdit(actor, org);
  const list = roster(org);
  const SECTIONS = engagementSections(org);
  const MAXES = engagementMaxFor(org);
  const TOTAL_MAX = engagementTotalMax(org);
  const isd = org === 'isd';

  const models = new Map(list.map((u) => [u.id, engagementModel(u, viewWeek, Date.now(), org)]));

  const scoreCell = (m, key) => {
    const v = m.val[key]; const src = m.src[key];
    const mark = src === 'override' ? ' eng-cell--ov' : (src === 'manual' ? ' eng-cell--man' : '');
    const title = src === 'override' ? 'quality override' : (src === 'manual' ? 'entered by reviewer' : 'derived from logs');
    return `<td class="cell-num eng-cell${mark}" title="${title}">${v}<span class="eng-max">/${MAXES[key]}</span></td>`;
  };
  // Playtime is judged by the chain of command doing the looking: an agent logs
  // hours once under their cover post, so the ISD board judges those same hours
  // against the Department's threshold rather than Omega's.
  const actReqs = mergeActivityReqs((getSetting(ACTIVITY_REQ_SETTING_ID) || {}).data);
  const readiness = (u) => {
    const st = activityStatus(u, getActivityForUser(u.id), actReqs, Date.now(), org);
    const m = ACTIVITY_STATUS[st.key] || { label: st.key, tone: 'muted' };
    const need = st.req && st.req.weekly ? ` · needs ${st.req.weekly}h` : '';
    return `<span class="badge badge--${m.tone}" title="${esc(st.weekHours)}h logged this week${esc(need)}">${esc(m.label)}</span>`;
  };
  const reqDot = (ok, label) => `<span class="eng-req ${ok ? 'eng-req--ok' : 'eng-req--no'}" title="${esc(label)}">${ok ? '✓' : '✕'}</span>`;

  // Trend: the last few weeks' totals as a compact spark, computed from the same
  // engagementModel the board uses (cheap at unit scale) so the two always agree.
  const SPARK = '▁▂▃▄▅▆▇█';
  const TREND_WEEKS = 5;
  const sparkline = (u) => {
    const totals = [];
    for (let k = TREND_WEEKS - 1; k >= 0; k--) totals.push(engagementModel(u, engagementWeekShift(viewWeek, -k), Date.now(), org).total);
    const bars = totals.map((t) => SPARK[Math.max(0, Math.min(7, Math.round((t / TOTAL_MAX) * 7)))]).join('');
    return `<span class="eng-spark" title="Totals, last ${TREND_WEEKS} weeks (oldest → newest): ${totals.join(' → ')}">${bars}</span>`;
  };

  // Operators below either weekly requirement — surfaced as an at-risk banner.
  const atRisk = list.filter((u) => { const m = models.get(u.id); return !m.reqs.req1 || !m.reqs.req2; });

  // Rows, with a rank subheader inserted whenever the rank changes.
  let lastRank = null;
  const bodyRows = list.map((u) => {
    const m = models.get(u.id);
    const header = u.rank !== lastRank ? `<tr class="eng-rankrow"><td colspan="${SECTIONS.length + 6}">${esc(u.rank || 'Unranked')}</td></tr>` : '';
    lastRank = u.rank;
    const totalTone = m.total >= TOTAL_MAX * 0.6 ? 'ok' : (m.total >= TOTAL_MAX * 0.3 ? 'warn' : 'bad');
    return `${header}
      <tr data-user="${esc(u.id)}" ${editable ? 'tabindex="0" class="row-click"' : ''}>
        <td class="cell-name"><span class="mono">${esc(u.designation)}</span> ${esc(u.codename || '')}</td>
        ${SECTIONS.map((s) => scoreCell(m, s.key)).join('')}
        <td class="cell-num"><span class="badge badge--${totalTone}">${m.total}<span class="eng-max">/${TOTAL_MAX}</span></span></td>
        <td class="cell-center">${sparkline(u)}</td>
        <td class="cell-center">${readiness(u)}</td>
        <td class="cell-center">${reqDot(m.reqs.req1, isd ? '1 investigative contribution this week' : '1 Scouting/Order/Evidence/PoI this week')} ${reqDot(m.reqs.req2, isd ? '1 matter carried in 3 weeks' : '1 training host in 3 weeks')}</td>
        <td class="cell-right">${editable ? '<span class="row-go">Score →</span>' : ''}</td>
      </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · ${esc(ORGS[org].short)}</div>
        <h1 class="page-title">Engagement</h1>
        <div class="page-sub">${isd ? 'Weekly casework score · five sections derived from the investigative record, two entered by ISD command' : 'Weekly engagement score · six sections derived from the records, two entered by Sr CL4'}</div>
      </div>
    </div>

    <div class="toolbar eng-weeknav">
      <button class="btn btn--sm" id="eng-prev">◀ Previous week</button>
      <span class="eng-week">${weekLabel(viewWeek)}</span>
      <button class="btn btn--sm" id="eng-next" ${engagementWeekShift(viewWeek, 1) > engagementWeekStart() ? 'disabled' : ''}>Next week ▶</button>
      ${viewWeek !== engagementWeekStart() ? '<button class="btn btn--sm btn--ghost" id="eng-now">This week</button>' : ''}
      <button class="btn btn--sm" id="eng-export" style="margin-left:auto">⤓ Export sheet</button>
    </div>

    ${atRisk.length ? `<div class="readiness-banner readiness-banner--warn"><strong>${atRisk.length}</strong> of ${list.length} operator${list.length === 1 ? '' : 's'} below the weekly engagement requirement this week.</div>` : ''}

    <div class="card">
      <table class="table eng-table">
        <thead><tr>
          <th>Operator</th>
          ${SECTIONS.map((s) => `<th class="cell-num" title="Max ${s.max}">${esc(s.label)}</th>`).join('')}
          <th class="cell-num">Total</th><th class="cell-center" title="Total score, last 5 weeks">Trend</th><th class="cell-center" title="Weekly hours against this organisation's own threshold">Readiness</th><th class="cell-center">Reqs</th><th></th>
        </tr></thead>
        <tbody>${list.length ? bodyRows : `<tr><td colspan="${SECTIONS.length + 6}" class="empty">${isd ? 'No active Internal Security agents.' : `No active ${esc(ORGS['omega-1'].short)} operators.`}</td></tr>`}</tbody>
      </table>
    </div>
    ${isd
      ? '<p class="field__hint" style="margin-top:12px">Derived sections (Referrals, Casework, Dispositions, Trainings, Activity) come from the week’s <a class="rec-link" href="#/investigations">investigative record</a>; Discretion and Conduct are entered by ISD command, who may override any derived score. Expectation: one investigative contribution a week, and a matter carried in the trailing three weeks.</p>'
      : '<p class="field__hint" style="margin-top:12px">Derived sections (Scouting, Orders, Evidence, PoIs, Trainings, Activity) come from the week’s records — Evidence from the <a class="rec-link" href="#/evidence">evidence submissions</a>; Squadron and RP are entered by a reviewer, who may override any derived score for quality. Expectation: one Scouting/Order/Evidence/PoI engagement a week, one training host every three weeks.</p>'}
  `;

  host.querySelector('#eng-prev').addEventListener('click', () => { viewWeek = engagementWeekShift(viewWeek, -1); render(host, app, org); });
  const nx = host.querySelector('#eng-next');
  if (nx) nx.addEventListener('click', () => { viewWeek = engagementWeekShift(viewWeek, 1); render(host, app, org); });
  host.querySelector('#eng-export').addEventListener('click', () => exportEngagementSummary(app, {
    org, orgLabel: ORGS[org].name,
    weekLabel: weekLabel(viewWeek),
    sections: SECTIONS,
    totalMax: TOTAL_MAX,
    atRisk: atRisk.length,
    rows: list.map((u) => { const m = models.get(u.id); return { designation: u.designation, codename: u.codename, rank: u.rank, val: m.val, total: m.total, req1: m.reqs.req1, req2: m.reqs.req2 }; }),
  }));
  const nowBtn = host.querySelector('#eng-now');
  if (nowBtn) nowBtn.addEventListener('click', () => { viewWeek = engagementWeekStart(); render(host, app, org); });

  if (editable) {
    host.querySelectorAll('tr[data-user]').forEach((tr) => {
      const open = () => openEditor(app, tr.dataset.user);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }
}

// --- Reviewer editor --------------------------------------------------------
function openEditor(app, userId) {
  const actor = app.user;
  if (!canEdit(actor)) { toast('Engagement scoring is maintained by Sr CL4 command.', 'error'); return; }
  const user = users().find((u) => u.id === userId);
  if (!user) return;
  const m = engagementModel(user, viewWeek, Date.now(), curOrg);
  const rec = m.record;
  const man = (rec && rec.manual) || {};
  const ov = (rec && rec.overrides) || {};

  const manualField = (s) => `
    <div class="field eng-field">
      <label>${esc(s.label)} <span class="muted-text">/ ${s.max}</span></label>
      <input id="eng-m-${s.key}" type="number" min="0" max="${s.max}" step="1" value="${man[s.key] != null ? esc(String(man[s.key])) : ''}" placeholder="0" />
    </div>`;
  const overrideField = (s) => `
    <div class="field eng-field">
      <label>${esc(s.label)} <span class="muted-text">/ ${s.max}</span></label>
      <input id="eng-o-${s.key}" type="number" min="0" max="${s.max}" step="1" value="${ov[s.key] != null && ov[s.key] !== '' ? esc(String(ov[s.key])) : ''}" placeholder="auto: ${m.auto[s.key]}" />
    </div>`;

  const manualSecs = engagementSections(curOrg).filter((s) => s.mode === 'manual');
  const autoSecs = engagementSections(curOrg).filter((s) => s.mode === 'auto');

  // Last week's record, so the reviewer can carry its entries forward.
  const lastRec = getEngagementFor(user.id, engagementWeekShift(viewWeek, -1));

  const dialog = openModal({
    title: `Engagement — ${user.designation}`,
    wide: true,
    body: `
      <p class="modal__message">Week of ${weekLabel(viewWeek)}. Enter the reviewer sections; leave an override blank to keep the derived score (its auto value is shown as the placeholder).</p>
      <div class="ev-item__actions" style="margin-bottom:10px"><button class="btn btn--sm" id="eng-copy-last" ${lastRec ? '' : 'disabled title="No scores recorded last week"'}>Copy last week’s entries</button></div>
      <div class="card__subtitle">Reviewer sections</div>
      <div class="eng-grid">${manualSecs.map(manualField).join('')}</div>
      <div class="card__subtitle" style="margin-top:10px">Quality overrides <span class="muted-text">(blank = derived)</span></div>
      <div class="eng-grid">${autoSecs.map(overrideField).join('')}</div>
      <div class="field"><label>Note <span class="muted-text">(optional)</span></label><textarea id="eng-note" rows="2" placeholder="Reviewer note…">${rec && rec.note ? esc(rec.note) : ''}</textarea></div>
    `,
    actions: [
      { label: 'Cancel', tone: 'ghost', onClick: (c) => c() },
      { label: 'Save score', tone: 'primary', onClick: (c, d) => {
          const manual = {};
          for (const s of manualSecs) { const v = d.querySelector(`#eng-m-${s.key}`).value; manual[s.key] = v === '' ? 0 : Math.max(0, Math.min(s.max, Math.round(+v) || 0)); }
          const overrides = {};
          for (const s of autoSecs) { const v = d.querySelector(`#eng-o-${s.key}`).value.trim(); if (v !== '') overrides[s.key] = Math.max(0, Math.min(s.max, Math.round(+v) || 0)); }
          const note = d.querySelector('#eng-note').value.trim();
          saveScore(app, user, manual, overrides, note);
          c();
          toast('Engagement score saved.', 'success');
        } },
    ],
  });

  // Carry last week's manual entries and quality overrides into the fields.
  const copyBtn = lastRec && dialog.querySelector('#eng-copy-last');
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const lm = lastRec.manual || {}; const lo = lastRec.overrides || {};
    for (const s of manualSecs) { const inp = dialog.querySelector(`#eng-m-${s.key}`); if (inp) inp.value = lm[s.key] != null ? String(lm[s.key]) : ''; }
    for (const s of autoSecs) { const inp = dialog.querySelector(`#eng-o-${s.key}`); if (inp) inp.value = (lo[s.key] != null && lo[s.key] !== '') ? String(lo[s.key]) : ''; }
    toast('Copied last week’s entries.', 'info');
  });
}

function saveScore(app, user, manual, overrides, note) {
  const now = new Date().toISOString();
  const existing = getEngagementFor(user.id, viewWeek);
  if (existing) {
    const fresh = getEngagement(existing.id) || existing;
    fresh.manual = manual; fresh.overrides = overrides; fresh.note = note;
    fresh.by = app.user.designation; fresh.updatedAt = now; fresh.version = (fresh.version || 1) + 1;
    upsertEngagement(fresh);
  } else {
    upsertEngagement({
      id: newId('eng'), userId: user.id, org: curOrg, weekStart: viewWeek,
      manual, overrides, note, by: app.user.designation,
      createdBy: app.user.designation, createdAt: now, updatedAt: now,
      version: 1, deleted: false, deletedAt: null,
    });
  }
  logAction(app.user, existing ? 'EDIT_ENGAGEMENT' : 'CREATE_ENGAGEMENT', `Engagement scored for ${user.designation}.`);
  app.refresh();
}
