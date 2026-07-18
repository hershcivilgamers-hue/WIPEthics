// =============================================================================
// interview-assess.js — CAIRO's advisory grading of an Ethics Assistant interview.
//
// Runs the same free-tier model provider the CAIRO terminal uses (Gemini when
// GEMINI_API_KEY is set, else Cloudflare Workers AI via env.AI), with an
// assessor persona instead of the chat persona. It grades each recorded answer
// strong / acceptable / weak and gives an overall recommendation. The model is
// never trusted to return clean JSON: we extract the first {...} block, parse it
// defensively, and clamp every value to a known enum. The result is ADVISORY —
// the endpoint writes it to the record, but CL5 still enters the pass/fail.
// =============================================================================

import { callGemini, callWorkersAI } from './terminal.js';
import { interviewSetFor, INTERVIEW_GRADE, INTERVIEW_RECOMMENDATION } from '../../js/interview-bank.js';

const GRADES = new Set(Object.keys(INTERVIEW_GRADE));            // strong | acceptable | weak
const RECS = new Set(Object.keys(INTERVIEW_RECOMMENDATION));     // recommend | reservations | decline
const clampStr = (s, n) => String(s == null ? '' : s).slice(0, n);

// Workers AI JSON mode schema for the verdict — the model is constrained to this
// shape instead of merely being asked for it in prose. Kept deliberately simple
// (the docs warn overly complex schemas fail).
// https://developers.cloudflare.com/workers-ai/features/json-mode/
// `overall` is deliberately FIRST: if the model runs out of output tokens
// mid-reply, truncation then costs per-question rationales, not the verdict.
const ASSESSMENT_SCHEMA = {
  type: 'object',
  properties: {
    overall: {
      type: 'object',
      properties: {
        recommendation: { type: 'string', enum: [...RECS] },
        summary: { type: 'string' },
        strengths: { type: 'string' },
        improvements: { type: 'string' },
      },
      required: ['recommendation'],
    },
    perQuestion: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          grade: { type: 'string', enum: [...GRADES] },
          rationale: { type: 'string' },
          feedback: { type: 'string' },
        },
        required: ['id', 'grade'],
      },
    },
  },
  required: ['overall', 'perQuestion'],
};

// The assessor persona. Asks for a strict JSON envelope so the reply is parseable.
function buildAssessmentSystem(member) {
  const becoming = member ? 'a Member of' : 'an Assistant to';
  const strongLine = member
    ? 'A strong Member reasons at the level of the institution — weighing precedent, the Committee’s authority, and the people a ruling binds — not merely their own conscience. Grade the QUALITY OF INSTITUTIONAL JUDGEMENT against the guidance, not agreement with any single "right" answer. A missing or empty answer is weak.'
    : 'A strong Assistant weighs competing duties honestly and reaches a proportionate judgement — neither a blind rule-follower nor a naive idealist. Grade the QUALITY OF REASONING against the guidance, not agreement with any single "right" answer. A missing or empty answer is weak.';
  return [
    `You are CAIRO, assessing a candidate interviewing to become ${becoming} the SCP Foundation Ethics Committee.`,
    "For each scenario you are given: the scenario, marking guidance describing what a strong answer and a weak answer look like, and the candidate's recorded answer.",
    strongLine,
    'Grade each answer strong, acceptable, or weak, with a one-sentence rationale for the interviewing Member. Then give an overall recommendation — "recommend", "reservations" (recommend with reservations), or "decline" (do not recommend) — with a short summary.',
    'Also produce CANDIDATE-FACING feedback: for each question a "feedback" sentence addressed to the candidate as "you" (constructive, specific, never mentioning grades or the marking guidance), and in "overall" a "strengths" and an "improvements" passage of two or three sentences each, likewise addressed to the candidate.',
    'Reply with ONLY a compact JSON object and nothing else — no markdown, no prose, no code fences, no step-by-step reasoning.',
    'The JSON must be valid: double quotes on every key and string, no trailing commas, no comments. Use exactly this shape, with "overall" FIRST:',
    '{"overall":{"recommendation":"recommend|reservations|decline","summary":"...","strengths":"...","improvements":"..."},"perQuestion":[{"id":"<the given id>","grade":"strong|acceptable|weak","rationale":"...","feedback":"..."}]}',
    'Use the exact id string given for each question. Keep the summary to two sentences, each rationale to at most twelve words, and each feedback sentence to at most twenty words.',
  ].join('\n');
}

// One block per question — scenario, both marking-guidance lines, and the answer.
function buildAssessmentUser(items, responses) {
  const blocks = items.map((q, i) => {
    const stored = responses && responses[q.id];
    const answer = (stored && String(stored.text || '').trim()) || '(no answer recorded)';
    return [
      `QUESTION ${i + 1} [id: ${q.id}] — ${q.category || 'Committee-added'}`,
      `Scenario: ${q.prompt}`,
      `Marking guidance — a strong answer: ${q.valid || 'n/a'}`,
      `Marking guidance — a weak answer: ${q.weak || 'n/a'}`,
      `Candidate's recorded answer: ${answer}`,
    ].join('\n');
  });
  return `Assess the following ${items.length} interview answers. Use the exact id given for each question.\n\n${blocks.join('\n\n')}`;
}

// Run the model, single-shot (no history). The verdict is a larger structured
// reply than a chat turn, so give it room (a small token cap truncates the JSON
// mid-object) and a low temperature for consistency. Prefers Gemini when a key is
// set, but FALLS BACK to the zero-cost Workers AI binding when Gemini fails —
// its free tier is easily exhausted (HTTP 429 / quota). Returns { text, model }
// so the stored provenance reflects the provider that actually answered.
async function callModel(env, system, user) {
  // The fallback (GLM) is a thinking model: reasoning shares the output budget
  // and was observed truncating the verdict mid-JSON. So: disable thinking via
  // chat_template_kwargs (in the model schema), give generous headroom, and
  // constrain the output to the verdict schema (JSON mode).
  const opts = {
    maxTokens: 4096,
    temperature: 0.3,
    responseFormat: { type: 'json_schema', json_schema: ASSESSMENT_SCHEMA },
    chatTemplateKwargs: { enable_thinking: false },
  };
  const hasGemini = !!(env && env.GEMINI_API_KEY);
  const hasAI = !!(env && env.AI);
  if (hasGemini) {
    try {
      const text = await callGemini(env, system, [], user, opts);
      return { text, model: env.GEMINI_MODEL || 'gemini-2.0-flash' };
    } catch (e) {
      if (!hasAI) throw e; // nothing to fall back to
      console.error('[assess] Gemini unavailable, falling back to Workers AI:', (e && e.message) || e);
    }
  }
  if (hasAI) {
    const text = await callWorkersAI(env, system, [], user, opts);
    return { text, model: env.WORKERS_AI_MODEL || '@cf/zai-org/glm-4.7-flash' };
  }
  const err = new Error('COGNITION CORE OFFLINE — no model provider is configured for this site.');
  err.offline = true;
  throw err;
}

// Pull the first {...} block out of a possibly-chatty reply and JSON.parse it.
// Returns null on any failure — never throws.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  // Thinking models may wrap deliberation in <think>…</think> before the answer;
  // its prose (often containing braces) must not join the extraction span.
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const tryParse = (s) => {
    try { return JSON.parse(s); } catch (_) { /* retry with trailing commas stripped */ }
    try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch (_) { return null; }
  };
  // First the simple span (first { to last }) — correct when the reply is one
  // object, even with braces inside its strings.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const whole = tryParse(cleaned.slice(start, end + 1));
  if (whole) return whole;
  // Otherwise collect each balanced top-level {...} and try them last-first —
  // the answer follows any leftover prose. ponytail: brace-depth scan ignores
  // braces inside strings; acceptable because the whole-span attempt above
  // already handled the pure-JSON case.
  const candidates = [];
  let depth = 0; let at = -1;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === '{') { if (depth === 0) at = i; depth += 1; }
    else if (ch === '}') { if (depth > 0) { depth -= 1; if (depth === 0) candidates.push(cleaned.slice(at, i + 1)); } }
  }
  for (const c of candidates.reverse()) {
    const parsed = tryParse(c);
    if (parsed) return parsed;
  }
  // Last resort: the reply ran out of tokens mid-JSON (observed live: the object
  // never closes). Salvage what completed by closing the open structures.
  return repairTruncated(cleaned.slice(start), tryParse);
}

// Close a truncated JSON string: walk it tracking quote/escape state and the
// open-container stack, close any dangling string, append the missing closers,
// and parse. If the dangling fragment itself is unusable (e.g. a key with no
// value), chop back to the previous element boundary and try again.
function repairTruncated(s, tryParse) {
  let cur = s;
  for (let attempt = 0; attempt < 40 && cur; attempt += 1) {
    let inStr = false; let escaped = false; const stack = [];
    for (let i = 0; i < cur.length; i += 1) {
      const ch = cur[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
    let candidate = cur + (inStr ? '"' : '');
    candidate = candidate.replace(/[,:\s]+$/, '');
    const closers = stack.reverse().map((c) => (c === '{' ? '}' : ']')).join('');
    const parsed = tryParse(candidate + closers);
    if (parsed) return parsed;
    const cut = Math.max(cur.lastIndexOf(','), cur.lastIndexOf('{'), cur.lastIndexOf('['));
    if (cut <= 0) return null;
    cur = cur.slice(0, cut);
  }
  return null;
}

// Coerce a parsed reply into a safe assessment. Unknown grades -> 'acceptable',
// unknown recommendation -> 'reservations', unknown ids dropped. Returns null if
// there is nothing usable at all. Pure — exercised by tools/check-interview-assess.mjs.
export function normalizeAssessment(parsed, allowedIds) {
  if (!parsed || typeof parsed !== 'object') return null;
  const allow = new Set(allowedIds || []);
  const overall = (parsed.overall && typeof parsed.overall === 'object') ? parsed.overall : {};
  const recommendation = RECS.has(overall.recommendation) ? overall.recommendation : 'reservations';
  const summary = clampStr(overall.summary, 800);
  const strengths = clampStr(overall.strengths, 800);
  const improvements = clampStr(overall.improvements, 800);
  const perQuestion = {};
  const list = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || !allow.has(item.id)) continue;
    const grade = GRADES.has(item.grade) ? item.grade : 'acceptable';
    perQuestion[item.id] = { grade, rationale: clampStr(item.rationale, 400), feedback: clampStr(item.feedback, 400) };
  }
  if (!Object.keys(perQuestion).length && !summary) return null;
  return { recommendation, summary, strengths, improvements, perQuestion };
}

// Grade a candidate's interview. Rebuilds the same drawn set + custom questions
// the interviewers see, calls the model, and returns the validated assessment
// plus the model label. Throws (with `.offline` where relevant) on failure.
export async function assessInterview(env, recruit) {
  const bank = interviewSetFor(recruit);
  const custom = (recruit.customQuestions || []).map((q) => ({
    id: q.id, category: 'Committee-added', prompt: q.prompt, valid: q.valid || '', weak: q.weak || '',
  }));
  const items = [...bank, ...custom];
  const allowedIds = items.map((q) => q.id);
  const { text, model } = await callModel(env, buildAssessmentSystem(recruit && recruit.track === 'member'), buildAssessmentUser(items, recruit.interviewResponses || {}));
  const assessment = normalizeAssessment(extractJson(text), allowedIds);
  if (!assessment) {
    // Visible in `wrangler tail` — shows exactly what the model said when parsing fails.
    console.error(`[assess] unparseable reply from ${model}:`, String(text).slice(0, 800));
    throw new Error('CAIRO returned an assessment that could not be read. Retry.');
  }
  return { assessment, model };
}
