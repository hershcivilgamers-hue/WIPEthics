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
  RANKS, ENGAGEMENT_SECTIONS, ENGAGEMENT_MANUAL_KEYS, ENGAGEMENT_OVERRIDE_KEYS,
  ENGAGEMENT_MAX, ENGAGEMENT_TOTAL_MAX, ENGAGEMENT_WEEK_MS, engagementWeekStart, rankIndex,
} from '../constants.js';
import { engagementModel } from '../engagement.js';
import { users, getEngagement, getEngagementFor, upsertEngagement, newId } from '../storage.js';
import { isCL5, canManageOrg } from '../permissions.js';
import { logAction } from '../audit.js';
import { esc, fmtDate, toast, openModal } from '../ui.js';

const ORG = 'omega-1';
let viewWeek = engagementWeekStart();

const canEdit = (actor) => isCL5(actor) || canManageOrg(actor, ORG);

function weekLabel(ws) {
  return `${fmtDate(new Date(ws).toISOString())} – ${fmtDate(new Date(ws + 6 * 86400000).toISOString())}`;
}

// The active Omega-1 roster, most-senior rank first (rows grouped by rank).
function roster() {
  return users()
    .filter((u) => !u.deleted && u.org === ORG && u.accountStatus === 'active' && u.status !== 'discharged')
    .sort((a, b) => (rankIndex(ORG, a.rank) - rankIndex(ORG, b.rank)) || (a.designation || '').localeCompare(b.designation || ''));
}

export function render(host, app) {
  const actor = app.user;
  const editable = canEdit(actor);
  const list = roster();

  const models = new Map(list.map((u) => [u.id, engagementModel(u, viewWeek)]));

  const scoreCell = (m, key) => {
    const v = m.val[key]; const src = m.src[key];
    const mark = src === 'override' ? ' eng-cell--ov' : (src === 'manual' ? ' eng-cell--man' : '');
    const title = src === 'override' ? 'quality override' : (src === 'manual' ? 'entered by reviewer' : 'derived from logs');
    return `<td class="cell-num eng-cell${mark}" title="${title}">${v}<span class="eng-max">/${ENGAGEMENT_MAX[key]}</span></td>`;
  };
  const reqDot = (ok, label) => `<span class="eng-req ${ok ? 'eng-req--ok' : 'eng-req--no'}" title="${esc(label)}">${ok ? '✓' : '✕'}</span>`;

  // Rows, with a rank subheader inserted whenever the rank changes.
  let lastRank = null;
  const bodyRows = list.map((u) => {
    const m = models.get(u.id);
    const header = u.rank !== lastRank ? `<tr class="eng-rankrow"><td colspan="${ENGAGEMENT_SECTIONS.length + 4}">${esc(u.rank || 'Unranked')}</td></tr>` : '';
    lastRank = u.rank;
    const totalTone = m.total >= ENGAGEMENT_TOTAL_MAX * 0.6 ? 'ok' : (m.total >= ENGAGEMENT_TOTAL_MAX * 0.3 ? 'warn' : 'bad');
    return `${header}
      <tr data-user="${esc(u.id)}" ${editable ? 'tabindex="0" class="row-click"' : ''}>
        <td class="cell-name"><span class="mono">${esc(u.designation)}</span> ${esc(u.codename || '')}</td>
        ${ENGAGEMENT_SECTIONS.map((s) => scoreCell(m, s.key)).join('')}
        <td class="cell-num"><span class="badge badge--${totalTone}">${m.total}<span class="eng-max">/${ENGAGEMENT_TOTAL_MAX}</span></span></td>
        <td class="cell-center">${reqDot(m.reqs.req1, '1 Scouting/Order/Evidence/PoI this week')} ${reqDot(m.reqs.req2, '1 training host in 3 weeks')}</td>
        <td class="cell-right">${editable ? '<span class="row-go">Score →</span>' : ''}</td>
      </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">CAIRO · Omega-1</div>
        <h1 class="page-title">Engagement</h1>
        <div class="page-sub">Weekly engagement score · five sections derived from the logs, three entered by Sr CL4</div>
      </div>
    </div>

    <div class="toolbar eng-weeknav">
      <button class="btn btn--sm" id="eng-prev">◀ Previous week</button>
      <span class="eng-week">${weekLabel(viewWeek)}</span>
      <button class="btn btn--sm" id="eng-next" ${viewWeek + ENGAGEMENT_WEEK_MS > engagementWeekStart() + 1 ? 'disabled' : ''}>Next week ▶</button>
      ${viewWeek !== engagementWeekStart() ? '<button class="btn btn--sm btn--ghost" id="eng-now">This week</button>' : ''}
    </div>

    <div class="card">
      <table class="table eng-table">
        <thead><tr>
          <th>Operator</th>
          ${ENGAGEMENT_SECTIONS.map((s) => `<th class="cell-num" title="Max ${s.max}">${esc(s.label)}</th>`).join('')}
          <th class="cell-num">Total</th><th class="cell-center">Reqs</th><th></th>
        </tr></thead>
        <tbody>${list.length ? bodyRows : `<tr><td colspan="${ENGAGEMENT_SECTIONS.length + 4}" class="empty">No active Omega-1 operators.</td></tr>`}</tbody>
      </table>
    </div>
    <p class="field__hint" style="margin-top:12px">Derived sections (Scouting, Orders, PoIs, Trainings, Activity) come from the week's logs; Evidence, Squadron and RP are entered by a reviewer, who may override any derived score for quality. Expectation: one Scouting/Order/Evidence/PoI engagement a week, one training host every three weeks.</p>
  `;

  host.querySelector('#eng-prev').addEventListener('click', () => { viewWeek -= ENGAGEMENT_WEEK_MS; render(host, app); });
  const nx = host.querySelector('#eng-next');
  if (nx) nx.addEventListener('click', () => { viewWeek += ENGAGEMENT_WEEK_MS; render(host, app); });
  const nowBtn = host.querySelector('#eng-now');
  if (nowBtn) nowBtn.addEventListener('click', () => { viewWeek = engagementWeekStart(); render(host, app); });

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
  const m = engagementModel(user, viewWeek);
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

  const manualSecs = ENGAGEMENT_SECTIONS.filter((s) => s.mode === 'manual');
  const autoSecs = ENGAGEMENT_SECTIONS.filter((s) => s.mode === 'auto');

  openModal({
    title: `Engagement — ${user.designation}`,
    wide: true,
    body: `
      <p class="modal__message">Week of ${weekLabel(viewWeek)}. Enter the reviewer sections; leave an override blank to keep the derived score (its auto value is shown as the placeholder).</p>
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
      id: newId('eng'), userId: user.id, org: ORG, weekStart: viewWeek,
      manual, overrides, note, by: app.user.designation,
      createdBy: app.user.designation, createdAt: now, updatedAt: now,
      version: 1, deleted: false, deletedAt: null,
    });
  }
  logAction(app.user, existing ? 'EDIT_ENGAGEMENT' : 'CREATE_ENGAGEMENT', `Engagement scored for ${user.designation}.`);
  app.refresh();
}
