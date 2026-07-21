// =============================================================================
// isd-induction.js — the Internal Security induction assessment.
//
// A fixed multiple-choice test with an objective answer key, so the score is
// DERIVED from the recorded answers and never stored — a recruiter cannot inflate
// a result, and re-scoring is always consistent. Section 1 (candidate + recruiter
// identity) is administrative; Section 2 is the ten scored questions below.
//
// Scoring: each correct option is worth +1, each incorrect option chosen is -1,
// floored at 0 per question (so "select everything" cannot pass). Max 14; a pass
// is 10. Single-answer questions are the same rule with one correct option.
// =============================================================================

export const INDUCTION_PASS_MARK = 10;

export const INDUCTION_QUESTIONS = [
  {
    id: 'q1', type: 'single',
    prompt: 'What is the primary responsibility of the Internal Security Department?',
    options: [
      { id: 'a', label: 'Guard SCP Containment Cells' },
      { id: 'b', label: 'Enforce the Foundation Legal Codex', correct: true },
      { id: 'c', label: 'Lead Mobile Task Force operations' },
      { id: 'd', label: 'Conduct scientific research' },
    ],
  },
  {
    id: 'q2', type: 'multi',
    prompt: 'Which of the following are acceptable forms of evidence before making an arrest?',
    options: [
      { id: 'a', label: 'Witness statements', correct: true },
      { id: 'b', label: 'Bodycam', correct: true },
      { id: 'c', label: 'Comms logs', correct: true },
      { id: 'd', label: 'A D-Class telling you' },
    ],
  },
  {
    id: 'q3', type: 'multi',
    prompt: 'Which disguises are you allowed to take?',
    options: [
      { id: 'a', label: 'Sr. Researcher', correct: true },
      { id: 'b', label: 'DEA Senior Agent' },
      { id: 'c', label: 'Tech Expert', correct: true },
      { id: 'd', label: 'Janitor', correct: true },
      { id: 'e', label: 'GSD Captain' },
    ],
  },
  {
    id: 'q4', type: 'single',
    prompt: 'What ways can you punish someone for breaking the FLC?',
    options: [
      { id: 'a', label: 'You can only arrest them' },
      { id: 'b', label: 'You can only arrest or fine them' },
      { id: 'c', label: 'You can only give them a PT' },
      { id: 'd', label: 'You can either Fine, arrest or give them a PT.', correct: true },
    ],
  },
  {
    id: 'q5', type: 'single',
    prompt: 'During Code Black your PRIMARY responsibility is to?',
    options: [
      { id: 'a', label: 'Stay in ISD until told what to do' },
      { id: 'b', label: 'Escort all non-combative to garage', correct: true },
      { id: 'c', label: 'Stand in D-Block to help GSD' },
      { id: 'd', label: 'Fight the SCP’s' },
    ],
  },
  {
    id: 'q6', type: 'single',
    prompt: 'Who may overrule an ISD arrest?',
    options: [
      { id: 'a', label: 'GSD Captains' },
      { id: 'b', label: 'Ethics Committee or Site Inspectorate', correct: true },
      { id: 'c', label: 'Research Director' },
      { id: 'd', label: 'Nobody.' },
    ],
  },
  {
    id: 'q7', type: 'single',
    prompt: 'During Code 5, you hear an arrest request over comms. What should happen first?',
    options: [
      { id: 'a', label: 'Ignore the arrest' },
      { id: 'b', label: 'Retrieve SCRAMBLE gear' },
      { id: 'c', label: 'Go directly to the arrest', correct: true },
      { id: 'd', label: 'Run to surface' },
    ],
  },
  {
    id: 'q8', type: 'single',
    prompt: 'An ISD Agent wants to turn off their headcam during a normal patrol. Is this allowed?',
    options: [
      { id: 'a', label: 'Yes' },
      { id: 'b', label: 'Only if they choose to' },
      { id: 'c', label: 'Only if ordered by a superior', correct: true },
      { id: 'd', label: 'Always during investigations' },
    ],
  },
  {
    id: 'q9', type: 'single',
    prompt: 'Who can authorise an audit of another department?',
    options: [
      { id: 'a', label: 'Commissioner +', correct: true },
      { id: 'b', label: 'E-11' },
      { id: 'c', label: 'Site Administration' },
      { id: 'd', label: 'Director of Medical' },
    ],
  },
  {
    id: 'q10', type: 'single',
    prompt: 'During Code Black where is the checkpoint established?',
    options: [
      { id: 'a', label: 'Secondary' },
      { id: 'b', label: 'MTF Loop' },
      { id: 'c', label: 'LCZ' },
      { id: 'd', label: 'EZ BD', correct: true },
    ],
  },
];

// The most points obtainable — the total number of correct options.
export const INDUCTION_MAX = INDUCTION_QUESTIONS
  .reduce((sum, q) => sum + q.options.filter((o) => o.correct).length, 0);

// Pure: score a set of recorded answers. `answers` is { qid: [optionId, ...] }.
// Returns { perQuestion:{qid:{gained,possible}}, score, max, passed }.
export function scoreInduction(answers = {}) {
  const perQuestion = {};
  let score = 0;
  for (const q of INDUCTION_QUESTIONS) {
    const correct = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
    const chosen = Array.isArray(answers[q.id]) ? answers[q.id] : (answers[q.id] ? [answers[q.id]] : []);
    let gained = 0;
    for (const id of chosen) gained += correct.has(id) ? 1 : -1;
    gained = Math.max(0, gained);
    perQuestion[q.id] = { gained, possible: correct.size };
    score += gained;
  }
  return { perQuestion, score, max: INDUCTION_MAX, passed: score >= INDUCTION_PASS_MARK };
}
