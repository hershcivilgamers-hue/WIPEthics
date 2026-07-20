// =============================================================================
// insight.js — Command analytics (REC-08).
//
// Oversight, not operations: this view aggregates across organisations, so it
// is CL5-gated at the router. It answers two questions Command actually asks —
// "where do candidates stall?" (recruitment funnel + conversion) and "is the
// docket moving, and how are matters resolving?" (tribunal throughput + outcome
// mix). All data is already client-side and reflects the viewer's redaction.
//
// Marks follow the dataviz method: magnitude is a single hue (amber), status is
// the reserved tones shipped WITH a label (never colour-alone), and every datum
// carries its value in text — so the chart is also its own accessible table.
// =============================================================================

import {
  RECRUIT_STAGE, RECRUIT_STAGE_ORDER, RULING_FINDING, RULING_FINDING_ORDER,
  CASE_KIND, CASE_KIND_ORDER,
} from '../constants.js';
import { recruits, cases } from '../storage.js';
import { esc, fmtDate } from '../ui.js';

const DAY = 86400000;
const LIVE_STAGES = RECRUIT_STAGE_ORDER.filter((s) => s !== 'archived');

// --- Pure aggregations (exported for unit testing) --------------------------

// Count of live candidates at each pipeline stage (the terminal 'archived' is
// not a stage you sit in — it is the exit, measured by conversion() instead).
export function funnel(list) {
  const live = list.filter((r) => !r.deleted && r.stage !== 'archived');
  return LIVE_STAGES.map((stage) => ({
    stage,
    label: RECRUIT_STAGE[stage]?.label || stage,
    count: live.filter((r) => r.stage === stage).length,
  }));
}

// Approved / denied among decided (archived) candidates, and the approval rate.
export function conversion(list) {
  const decided = list.filter((r) => !r.deleted && r.stage === 'archived'
    && (r.archiveStatus === 'approved' || r.archiveStatus === 'denied'));
  const approved = decided.filter((r) => r.archiveStatus === 'approved').length;
  const denied = decided.filter((r) => r.archiveStatus === 'denied').length;
  const total = approved + denied;
  return { approved, denied, total, rate: total ? approved / total : null };
}

// When a candidate entered its current stage — the latest comment stamped with
// that stage, falling back to record creation. Approximate but from real data.
function stageEntry(r) {
  const stamps = (r.comments || [])
    .filter((c) => c.stage === r.stage)
    .map((c) => +new Date(c.ts || c.at)) // recruit comments are stamped `ts`
    .filter((n) => !Number.isNaN(n));
  return stamps.length ? Math.max(...stamps) : +new Date(r.createdAt || Date.now());
}

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

// Median days-in-current-stage per stage — surfaces where candidates stall.
export function medianAgeByStage(list, now = Date.now()) {
  const live = list.filter((r) => !r.deleted && r.stage !== 'archived');
  const out = {};
  for (const stage of LIVE_STAGES) {
    const ages = live
      .filter((r) => r.stage === stage)
      .map((r) => Math.max(0, Math.round((now - stageEntry(r)) / DAY)));
    out[stage] = median(ages);
  }
  return out;
}

// Cases opened (createdAt) and concluded (ruling.ts) per week, most-recent last.
export function throughput(list, weeks = 8, now = Date.now()) {
  const live = list.filter((c) => !c.deleted);
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * 7 * DAY;
    const start = end - 7 * DAY;
    const inWin = (t) => !Number.isNaN(t) && t > start && t <= end;
    out.push({
      start,
      opened: live.filter((c) => inWin(+new Date(c.createdAt))).length,
      concluded: live.filter((c) => c.ruling && inWin(+new Date(c.ruling.ts))).length,
    });
  }
  return out;
}

// Distribution of ruling findings across ruled cases.
export function outcomeMix(list) {
  const ruled = list.filter((c) => !c.deleted && c.ruling && c.ruling.finding);
  return RULING_FINDING_ORDER.map((finding) => ({
    finding,
    label: RULING_FINDING[finding]?.label || finding,
    tone: RULING_FINDING[finding]?.tone || 'muted',
    count: ruled.filter((c) => c.ruling.finding === finding).length,
  }));
}

// Live cases by type (magnitude, single hue).
export function byKind(list) {
  const live = list.filter((c) => !c.deleted);
  return CASE_KIND_ORDER.map((kind) => ({
    kind,
    label: CASE_KIND[kind]?.label || kind,
    count: live.filter((c) => c.kind === kind).length,
  }));
}

// --- Marks (CSS-driven; token colours, theme-aware, no external library) ----

// A horizontal magnitude/■status bar row: label · fill · value.
function bar(label, count, max, { tone = '', suffix = '', title = '' } = {}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const fillCls = tone ? `ins-fill--${tone}` : '';
  return `
    <div class="ins-bar" title="${esc(title || `${label}: ${count}`)}">
      <span class="ins-bar__label">${esc(label)}</span>
      <span class="ins-bar__track"><span class="ins-bar__fill ${fillCls}" style="width:${pct}%"></span></span>
      <span class="ins-bar__val">${count}${suffix ? ` <span class="muted-text">${esc(suffix)}</span>` : ''}</span>
    </div>`;
}

// A row of weekly columns (single hue), scaled to a shared max.
function cols(series, max, label, buckets) {
  return `
    <div class="ins-tp__row">
      <span class="ins-tp__k">${esc(label)}</span>
      <span class="ins-cols">${series.map((n, i) => {
        const pct = max > 0 ? Math.round((n / max) * 100) : 0;
        const wk = fmtDate(new Date(buckets[i].start).toISOString());
        return `<span class="ins-col" title="Week of ${esc(wk)}: ${n} ${esc(label.toLowerCase())}"><span class="ins-col__fill" style="height:${Math.max(n ? 6 : 0, pct)}%"></span></span>`;
      }).join('')}</span>
    </div>`;
}

// --- View -------------------------------------------------------------------

export function render(host, app) {
  const rlist = recruits();
  const clist = cases();

  const f = funnel(rlist);
  const conv = conversion(rlist);
  const ages = medianAgeByStage(rlist);
  const fMax = Math.max(1, ...f.map((s) => s.count));

  const tp = throughput(clist);
  const tpMax = Math.max(1, ...tp.map((b) => Math.max(b.opened, b.concluded)));
  const mix = outcomeMix(clist);
  const mixMax = Math.max(1, ...mix.map((m) => m.count));
  const kinds = byKind(clist);
  const kindMax = Math.max(1, ...kinds.map((k) => k.count));

  const funnelBody = f.some((s) => s.count) ? f.map((s) => {
    const age = ages[s.stage];
    return bar(s.label, s.count, fMax, {
      suffix: age != null ? `· ${age}d median` : '',
      title: `${s.label}: ${s.count} candidate${s.count === 1 ? '' : 's'}${age != null ? `, median ${age} day${age === 1 ? '' : 's'} in stage` : ''}`,
    });
  }).join('') : '<div class="empty">No candidates in the pipeline.</div>';

  const convBody = conv.total ? `
    <div class="ins-conv">
      <div class="ins-conv__head">
        <span class="ins-conv__rate">${Math.round(conv.rate * 100)}%</span> approved
        <span class="muted-text">· ${conv.approved} of ${conv.total} decided</span>
      </div>
      <span class="ins-seg">
        <span class="ins-seg__part ins-fill--ok" style="width:${Math.round(conv.rate * 100)}%" title="Approved: ${conv.approved}"></span>
        <span class="ins-seg__part ins-fill--bad" style="width:${100 - Math.round(conv.rate * 100)}%" title="Denied: ${conv.denied}"></span>
      </span>
      <div class="ins-legend">
        <span><span class="ins-dot ins-fill--ok"></span>Approved (${conv.approved})</span>
        <span><span class="ins-dot ins-fill--bad"></span>Denied (${conv.denied})</span>
      </div>
    </div>` : '<div class="empty">No candidates decided yet.</div>';

  const tpBody = clist.length ? `
    <div class="ins-tp">
      ${cols(tp.map((b) => b.opened), tpMax, 'Opened', tp)}
      ${cols(tp.map((b) => b.concluded), tpMax, 'Concluded', tp)}
      <div class="ins-tp__axis"><span>${esc(fmtDate(new Date(tp[0].start).toISOString()))}</span><span class="muted-text">last 8 weeks</span><span>now</span></div>
    </div>` : '<div class="empty">No cases on the docket.</div>';

  const mixBody = mix.some((m) => m.count)
    ? mix.map((m) => bar(m.label, m.count, mixMax, { tone: m.tone })).join('')
    : '<div class="empty">No rulings entered yet.</div>';

  const kindBody = kinds.some((k) => k.count)
    ? kinds.map((k) => bar(k.label, k.count, kindMax)).join('')
    : '<div class="empty">No open cases.</div>';

  host.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Insight</h1>
        <div class="page-sub">Command analytics — recruitment and the docket, at a glance. Oversight view, CL5.</div>
      </div>
    </div>

    <div class="ins-grid">
      <section class="card">
        <div class="card__title">Recruitment Funnel <span class="muted-text">— candidates by stage</span></div>
        <div class="card__body">
          ${funnelBody}
          <div class="ins-sep"></div>
          ${convBody}
        </div>
      </section>

      <section class="card">
        <div class="card__title">Tribunal Docket <span class="muted-text">— throughput &amp; outcomes</span></div>
        <div class="card__body">
          ${tpBody}
          <div class="ins-sep"></div>
          <div class="ins-subhead">Outcome mix <span class="muted-text">— rulings entered</span></div>
          ${mixBody}
          <div class="ins-sep"></div>
          <div class="ins-subhead">Open cases by type</div>
          ${kindBody}
        </div>
      </section>
    </div>`;
}
