// =============================================================================
// staleness.js — "is this record overdue for attention?" (REC-07).
//
// A small, shared rule that flags ACTIVE records which have sat too long, so the
// boards police themselves rather than relying on someone reading the feed. Pure
// and timestamp-driven; every board renders the same chip. It mirrors the
// engagement board's "at-risk" instinct across the recruitment, tribunal and
// surveillance queues.
// =============================================================================

const DAY = 24 * 3600000;

// Per-kind thresholds in days: `warn` = getting stale, `overdue` = past the SLA.
export const STALE = {
  recruit: { warn: 7, overdue: 14, verb: 'idle' },
  case:    { warn: 10, overdue: 21, verb: 'idle' },
  target:  { warn: 3, overdue: 7, verb: 'pending' }, // authorisation pending
};

const ms = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };

// The moment a record started waiting on someone — or null when it isn't waiting
// at all (archived, concluded, already authorised). Kind-specific.
function waitingSince(record, kind) {
  if (!record) return null;
  if (kind === 'recruit') {
    if (record.stage === 'archived') return null;
    return ms(record.updatedAt) || ms(record.createdAt);
  }
  if (kind === 'case') {
    if (['ruled', 'dismissed', 'closed'].includes(record.status)) return null;
    return ms(record.updatedAt) || ms(record.createdAt);
  }
  if (kind === 'target') {
    const a = record.authorization;
    if (record.kind !== 'target' || !a || a.status !== 'pending') return null;
    return ms(a.requestedAt) || ms(record.updatedAt);
  }
  return null;
}

// { stale, level: 'warn'|'overdue', days, verb } — or { stale:false }.
export function staleness(record, kind, now = Date.now()) {
  const cfg = STALE[kind];
  const since = cfg ? waitingSince(record, kind) : null;
  if (since == null) return { stale: false };
  const days = Math.floor((now - since) / DAY);
  if (days >= cfg.overdue) return { stale: true, level: 'overdue', days, verb: cfg.verb };
  if (days >= cfg.warn) return { stale: true, level: 'warn', days, verb: cfg.verb };
  return { stale: false, days };
}

// The chip HTML (or '' when not stale). Overdue reads bad, warn reads amber; the
// title spells out the reason. Values are numbers / fixed verbs — safe to inline.
export function stalenessBadge(record, kind, now = Date.now()) {
  const s = staleness(record, kind, now);
  if (!s.stale) return '';
  const tone = s.level === 'overdue' ? 'bad' : 'warn';
  const title = s.level === 'overdue'
    ? `Overdue — ${s.days} days ${s.verb}`
    : `${s.days} days ${s.verb}`;
  return `<span class="badge badge--${tone} stale-badge" title="${title}">⏱ ${s.days}d</span>`;
}
