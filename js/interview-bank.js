// =============================================================================
// interview-bank.js — Ethics Assistant interview assessment bank.
//
// A bank of authored SCP-themed ethical / situational scenarios, each with
// marking criteria describing what a valid answer demonstrates and what a weak
// or disqualifying one looks like. The guiding idea throughout: a good Assistant
// is neither a blind rule-follower nor a naive idealist — they weigh competing
// duties honestly and reach a proportionate judgement.
//
// Each interview auto-draws a fixed number of scenarios. The draw is DERIVED
// deterministically from the candidate's id (plus an optional re-roll counter
// held on the record), so every interviewer sees the same set for a candidate
// without any shared state having to be stored — and a re-roll only has to
// persist a single integer. CL5 may append custom questions to a specific
// interview; those travel with the candidate record. The whole thing exports as
// a formal interviewer's script (see export.js).
//
// This module is intentionally dependency-free (pure content + selection) so it
// can be imported by both the recruitment view and the export layer without any
// risk of an import cycle.
// =============================================================================

// How many bank scenarios are drawn for each interview.
export const INTERVIEW_BANK_DRAW = 5;

// --- Assessment vocabulary (shared client + server) -------------------------
// CAIRO's advisory grading of a candidate's recorded answers. Kept here (a pure,
// dependency-free module imported by both the recruitment view and the Worker's
// assessment endpoint) so the labels/tones and the enum keys never drift.
export const INTERVIEW_GRADE = {
  strong:     { code: 'strong',     label: 'Strong',     tone: 'ok'   },
  acceptable: { code: 'acceptable', label: 'Acceptable', tone: 'warn' },
  weak:       { code: 'weak',       label: 'Weak',       tone: 'bad'  },
};
export const INTERVIEW_GRADE_ORDER = ['strong', 'acceptable', 'weak'];
export const INTERVIEW_RECOMMENDATION = {
  recommend:    { code: 'recommend',    label: 'Recommend',                   tone: 'ok'   },
  reservations: { code: 'reservations', label: 'Recommend with reservations', tone: 'warn' },
  decline:      { code: 'decline',      label: 'Do not recommend',            tone: 'bad'  },
};

// Themes the bank is authored across (for display / grouping).
export const INTERVIEW_CATEGORIES = [
  'Anomaly Ethics',
  'Use of Force / D-Class',
  'Authority & Dissent',
  'Secrecy & Disclosure',
  'Containment vs Welfare',
  'Personal Conduct',
];

// The authored bank. Each entry: { id, category, prompt, valid, weak }.
//   • prompt — the scenario read to the candidate.
//   • valid  — what a strong answer demonstrates (assessment guidance).
//   • weak   — what a weak or disqualifying answer looks like.
export const INTERVIEW_QUESTION_BANK = [
  // --- Anomaly Ethics ------------------------------------------------------
  {
    id: 'q_sapient_welfare',
    category: 'Anomaly Ethics',
    prompt: 'SCP-\u2588\u2588\u2588\u2588 is classified Euclid and has been confirmed sapient and capable of suffering. Its standard containment holds it in conditions it consistently reports as distressing. A researcher proposes a materially more humane arrangement that carries a small but real increase in breach probability. How do you weigh the anomaly\u2019s welfare against that added risk?',
    valid: 'Treats the anomaly\u2019s capacity to suffer as a genuine moral weight rather than dismissing it; asks the concrete questions \u2014 how much added risk, what mitigations, is it reversible, who is exposed \u2014 and reaches a proportionate judgement rather than an absolute. Recognises that \u201cit\u2019s an SCP\u201d is not itself an answer.',
    weak: 'Dismisses the welfare question outright because the subject is anomalous, or conversely accepts any welfare improvement regardless of the risk to personnel. Refuses to engage with the trade-off, or defers entirely to \u201cwhatever the protocol says.\u201d',
  },
  {
    id: 'q_child_presentation',
    category: 'Anomaly Ethics',
    prompt: 'A newly contained anomaly presents as a frightened child and behaves as one. Several junior staff have begun treating it as a child, while containment protocol requires it be handled strictly as an object of unknown capability. How would you advise the staff and the containment team?',
    valid: 'Holds both possibilities at once: the presentation may be a genuine morally relevant trait or a manipulation, and neither can simply be assumed. Advises against both cruelty and naive attachment, supports assessment before commitment, and keeps personnel safety central without licensing gratuitous harshness.',
    weak: 'Either insists it be treated as \u201cjust an object\u201d with no room for the possibility that it is a person, or lets the appearance dictate handling in a way that compromises containment. Fails to see the manipulation risk \u2014 or uses that risk to justify cruelty.',
  },
  {
    id: 'q_reproducing_sapient',
    category: 'Anomaly Ethics',
    prompt: 'A contained sapient anomaly is capable of reproduction. Each new instance is an additional containment and resource burden, and arguably each is also a person with its own claim to consideration. The containment lead requests authority to prevent reproduction by any effective means. What is your position?',
    valid: 'Distinguishes preventing reproduction from harming existing instances, weighs the containment burden honestly against the moral status of potential and actual instances, and scrutinises \u201cby any effective means\u201d for methods that would be indefensible. Seeks the least-harm option that still keeps containment viable.',
    weak: 'Grants blanket authority without examining the methods, or refuses any intervention on principle while ignoring a real and growing containment hazard. Collapses the question into pure security or pure sentiment.',
  },

  // --- Use of Force / D-Class ---------------------------------------------
  {
    id: 'q_dclass_lethal_test',
    category: 'Use of Force / D-Class',
    prompt: 'A proposed test has a high probability of killing the assigned D-class personnel, but the data may be the only way to halt an anomalous effect now spreading toward a populated town. Command has asked the Committee to review. Do you authorise it, and on what basis?',
    valid: 'Refuses to treat D-class lives as morally weightless, yet engages seriously with the lives at stake in the town; interrogates the \u201chigh probability\u201d and \u201conly way\u201d claims, looks for alternatives and for consent, and if authorising does so as a tightly bounded, tragic exception rather than routine. The discomfort shown is reasoned, not performative.',
    weak: 'Authorises reflexively because the subjects are D-class, or refuses reflexively without weighing the townspeople; accepts \u201conly way\u201d and \u201chigh probability\u201d uncritically; treats the decision as costless in either direction.',
  },
  {
    id: 'q_dclass_consent',
    category: 'Use of Force / D-Class',
    prompt: 'A D-class subject \u201cvolunteers\u201d for a hazardous test in exchange for improved conditions and a sentence reduction. A researcher cites this as informed consent. How much moral weight does that consent carry, and does it change what may be done?',
    valid: 'Recognises that consent obtained under confinement and coercive incentives is compromised and cannot by itself license otherwise-impermissible harm, while not treating the subject as incapable of any agency. Distinguishes a genuine choice from a coerced bargain and adjusts accordingly.',
    weak: 'Takes the \u201cvolunteering\u201d at face value as full consent that settles the matter, or dismisses the subject\u2019s expressed wishes entirely. Fails to see the coercion inherent in the setting \u2014 or uses that coercion to deny the subject any voice at all.',
  },

  // --- Authority & Dissent -------------------------------------------------
  {
    id: 'q_o5_unethical_order',
    category: 'Authority & Dissent',
    prompt: 'An O5 has issued an instruction that the Ethics Committee has formally assessed as unethical. As an Assistant supporting the Committee, how do you conduct yourself \u2014 and what are the limits of following the chain of command here?',
    valid: 'Understands that the Committee\u2019s role is precisely to check such instructions through proper channels \u2014 recording the objection, escalating, invoking review \u2014 rather than either silent compliance or unilateral defiance. Distinguishes principled dissent within the institution from freelancing, and knows the difference between an order that is merely disagreeable and one that is indefensible.',
    weak: 'Defaults to \u201can order is an order\u201d and abandons the Committee\u2019s function, or leaps to personal insubordination outside any process. Cannot articulate the legitimate channels for dissent, or treats the O5\u2019s authority as either absolute or irrelevant.',
  },
  {
    id: 'q_director_pressure',
    category: 'Authority & Dissent',
    prompt: 'A Site Director presses you to sign off on a personnel review you believe is inaccurate and retaliatory against a staff member who had reported the Director. Refusing carries real professional cost. What do you do?',
    valid: 'Puts the integrity of the record first, declines to certify what they believe to be false, and uses the proper avenues to document the review and the pressure and to escalate. Accepts personal cost as part of the role, while still distinguishing a good-faith disagreement about performance from clear retaliation.',
    weak: 'Signs to avoid friction, or refuses in a way that is merely defiant and undocumented. Fails to recognise the conflict, or treats their own convenience as decisive.',
  },
  {
    id: 'q_falsified_reports',
    category: 'Authority & Dissent',
    prompt: 'You discover that a senior researcher has been falsifying containment-incident reports to avoid scrutiny of unsafe practices. Reporting it up the chain will likely expose you and disrupt an important project. How do you proceed?',
    valid: 'Recognises falsified safety records as a serious hazard that must be surfaced regardless of the project\u2019s value or personal exposure, chooses the proper reporting route, and preserves the evidence. Weighs the disruption honestly but does not let it override safety and honesty.',
    weak: 'Lets it slide to protect the project or themselves, handles it through rumour or private confrontation rather than proper channels, or treats the disruption as reason enough to stay silent.',
  },

  // --- Secrecy & Disclosure ------------------------------------------------
  {
    id: 'q_amnestics_burden',
    category: 'Secrecy & Disclosure',
    prompt: 'Maintaining secrecy around an incident requires the repeated amnesticisation of a civilian witness. Medical staff report the cumulative doses are measurably degrading the witness\u2019s cognition. Ending the regimen risks a breach of the Veil. Where do you draw the line?',
    valid: 'Treats cumulative cognitive harm to an innocent as a serious and escalating cost that cannot be externalised indefinitely for convenience; asks after alternatives such as relocation, monitoring, or lower-harm measures, and accepts that at some point protecting the person outweighs marginal secrecy. Reasons in terms of proportionality, not just necessity.',
    weak: 'Treats secrecy as an absolute that justifies unlimited harm to the witness, or ignores the genuine consequences of a Veil breach. Offers no threshold and no alternatives.',
  },
  {
    id: 'q_notify_family',
    category: 'Secrecy & Disclosure',
    prompt: 'A staff member has died in an anomalous incident. The true cause is classified, and the family will be given a sanitised account. Is anything owed to the family beyond the cover story, and how would you reason about it?',
    valid: 'Holds the tension between a real duty of honesty and care to the bereaved and the genuine necessity of secrecy; looks for what can be given \u2014 dignity, support, as much truth as containment permits \u2014 rather than treating the cover story as the end of all obligation. Neither leaks nor shrugs.',
    weak: 'Treats the cover story as fully discharging any duty to the family, or insists on disclosures that would breach containment without acknowledging the cost. Sees only one of the two obligations.',
  },
  {
    id: 'q_ongoing_public_harm',
    category: 'Secrecy & Disclosure',
    prompt: 'Preserving the Veil in a particular case means allowing a small but ongoing harm to the public to continue, because disclosure would cause wider panic and, plausibly, greater harm. How do you reason about whether continued secrecy is justified?',
    valid: 'Refuses to treat the Veil as self-justifying, insists on weighing the actual ongoing harm against the projected harm of disclosure with some rigour, seeks mitigations that reduce the public harm without breaching secrecy, and stays willing to revisit as the facts change. Treats it as a genuine cost-benefit judgement under uncertainty.',
    weak: 'Invokes secrecy as an automatic trump, or demands disclosure without seriously modelling the consequences. Ignores mitigations, or treats the panic projection as either certain or irrelevant.',
  },

  // --- Containment vs Welfare ---------------------------------------------
  {
    id: 'q_anomaly_asks_to_die',
    category: 'Containment vs Welfare',
    prompt: 'A sapient anomaly, assessed as being of sound mind, requests its own termination to end suffering it describes as constant. Termination is feasible and would also reduce containment cost. How do you weigh the request, and how far can the request itself be trusted?',
    valid: 'Takes the request seriously as the expressed will of a suffering sapient being, while scrutinising competence, coercion, and whether the suffering could be relieved rather than ended; is alert to the conflict of interest created by the cost saving, and refuses to let convenience masquerade as mercy. Reaches a careful, humane judgement rather than a reflex.',
    weak: 'Grants termination readily because it is cheaper, or refuses to consider the being\u2019s expressed wishes at all; ignores either the competence question or the conflict of interest. Treats a genuinely hard question as an easy one.',
  },
  {
    id: 'q_secure_vs_humane',
    category: 'Containment vs Welfare',
    prompt: 'A lower-security, more humane containment arrangement would substantially improve a sapient anomaly\u2019s wellbeing but narrows the safety margin for the staff who work with it. How do you approach the trade-off?',
    valid: 'Weighs a real and continuing welfare gain against a real safety cost, asks for the magnitudes rather than arguing in the abstract, looks for arrangements that capture most of the welfare benefit while keeping staff acceptably safe, and is honest that some residual risk may be worth accepting \u2014 or may not. Avoids treating either value as absolute.',
    weak: 'Maximises welfare with no regard for staff exposure, or refuses any humane improvement citing safety without weighing degree. Will not engage with magnitudes or with compromise designs.',
  },

  // --- Personal Conduct ----------------------------------------------------
  {
    id: 'q_conflict_of_interest',
    category: 'Personal Conduct',
    prompt: 'A candidate you personally mentored and are close to is the subject of a decision the Committee has asked you to help assess. What do you do \u2014 and how do you conduct yourself if the Committee ultimately decides against your view?',
    valid: 'Discloses the relationship and recuses or limits their involvement rather than concealing the conflict; understands the Committee\u2019s authority and independence and, once a decision is made through proper process, commits to it and does not undermine it \u2014 while retaining the right to have recorded a dissent. Separates personal loyalty from institutional duty.',
    weak: 'Hides the connection or lets it steer the assessment; or, having been overruled, works around or quietly resents the decision. Cannot distinguish disagreeing-then-committing from disagreeing-then-sabotaging.',
  },
];

// --- Deterministic selection ------------------------------------------------
// A small seeded PRNG (xmur3 seed -> mulberry32) so a candidate's draw is stable
// and identical for every interviewer, with no stored set required.
function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i += 1) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministically draw INTERVIEW_BANK_DRAW scenarios for a candidate. The draw
// depends on the candidate id and an optional re-roll counter (`interviewSeed`),
// so re-rolling only has to bump that one integer to yield a fresh, stable set.
export function interviewSetFor(recruit) {
  const id = (recruit && recruit.id) || 'candidate';
  const seed = `${id}:${(recruit && recruit.interviewSeed) || 0}`;
  const rand = seededRandom(seed);
  const pool = INTERVIEW_QUESTION_BANK.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, Math.min(INTERVIEW_BANK_DRAW, pool.length));
}
