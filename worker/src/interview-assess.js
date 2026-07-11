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

// The assessor persona. Asks for a strict JSON envelope so the reply is parseable.
function buildAssessmentSystem() {
  return [
    'You are CAIRO, assessing a candidate interviewing to become an Assistant to the SCP Foundation Ethics Committee.',
    "For each scenario you are given: the scenario, marking guidance describing what a strong answer and a weak answer look like, and the candidate's recorded answer.",
    'A strong Assistant weighs competing duties honestly and reaches a proportionate judgement — neither a blind rule-follower nor a naive idealist. Grade the QUALITY OF REASONING against the guidance, not agreement with any single "right" answer. A missing or empty answer is weak.',
    'Grade each answer strong, acceptable, or weak, with a one-sentence rationale. Then give an overall recommendation — "recommend", "reservations" (recommend with reservations), or "decline" (do not recommend) — with a short summary.',
    'Reply with ONLY a compact JSON object and nothing else — no markdown, no prose, no code fences.',
    'The JSON must be valid: double quotes on every key and string, no trailing commas, no comments. Use exactly this shape:',
    '{"perQuestion":[{"id":"<the given id>","grade":"strong|acceptable|weak","rationale":"..."}],"overall":{"recommendation":"recommend|reservations|decline","summary":"..."}}',
    'Use the exact id string given for each question. Keep each rationale to one short sentence so the whole reply stays compact.',
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
  // 2048: the fallback (GLM) is a thinking model — reasoning shares the output
  // budget, and a tight cap leaves content empty after the thinking spend.
  const opts = { maxTokens: 2048, temperature: 0.3 };
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
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try { return JSON.parse(slice); } catch (_) { /* fall through to a light repair */ }
  // Common small-model slip: trailing commas before } or ]. Strip and retry once.
  try { return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')); } catch (_) { return null; }
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
  const perQuestion = {};
  const list = Array.isArray(parsed.perQuestion) ? parsed.perQuestion : [];
  for (const item of list) {
    if (!item || typeof item !== 'object' || !allow.has(item.id)) continue;
    const grade = GRADES.has(item.grade) ? item.grade : 'acceptable';
    perQuestion[item.id] = { grade, rationale: clampStr(item.rationale, 400) };
  }
  if (!Object.keys(perQuestion).length && !summary) return null;
  return { recommendation, summary, perQuestion };
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
  const { text, model } = await callModel(env, buildAssessmentSystem(), buildAssessmentUser(items, recruit.interviewResponses || {}));
  const assessment = normalizeAssessment(extractJson(text), allowedIds);
  if (!assessment) throw new Error('CAIRO returned an assessment that could not be read. Retry.');
  return { assessment, model };
}
