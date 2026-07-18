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
  {
    id: 'q_identity_erasure',
    category: 'Anomaly Ethics',
    prompt: 'Containment of a sapient anomaly requires amnesticising it every few weeks, erasing the sense of self it rebuilds each cycle. The procedure is painless and it never complains \u2014 each new \u201cself\u201d knows nothing of the loss. A researcher argues no harm is done; an orderly refuses to administer another dose. Where does the harm lie, if anywhere, and what would you advise the Committee?',
    valid: 'Engages seriously with whether identity erasure is a harm even absent suffering or memory of loss; weighs the containment necessity honestly rather than hiding behind \u201cit is painless\u201d; looks for less-destructive alternatives and proposes review rather than settling for an absolute.',
    weak: 'Declares it harmless because nothing is felt or remembered, or condemns it outright with no regard for why the cycle exists. Treats the question as obvious in either direction.',
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
  {
    id: 'q_breach_bystanders',
    category: 'Use of Force / D-Class',
    prompt: 'During a containment breach, the pursuing element can engage the entity with heavy weapons in a crowded transit hub \u2014 likely stopping it, at real risk to bystanders \u2014 or hold fire and track it toward open ground, accepting the harm it may do on the way. The task force lead radios for an immediate ruling. What do you say, and on what basis?',
    valid: 'Reasons under time pressure with proportionality: weighs certain risk to identifiable bystanders against uncertain further harm; asks what the entity is actually doing (fleeing or attacking); gives a usable answer rather than deferring, while flagging the decision for review afterwards.',
    weak: 'Orders the strike or the hold reflexively without weighing either population, or refuses to decide at all. Ignores that a non-answer is itself a decision with casualties.',
  },
  {
    id: 'q_dclass_incentives',
    category: 'Use of Force / D-Class',
    prompt: 'A site proposes a \u201cvolunteer credit\u201d scheme: D-class who enlist for hazardous testing earn sentence reductions, better rations, and the right to recruit others into the programme for further credit. Uptake would be high and testing throughput would improve. The Committee is asked to approve it. What is your assessment?',
    valid: 'Sees that layering incentives on a captive population manufactures consent rather than obtaining it, and that peer recruitment adds coercion by another name; weighs the genuine gains honestly; proposes bounds (no recruitment tiers, independent consent checks) if any scheme is to survive.',
    weak: 'Approves it as a win-win without examining the coercive structure, or rejects all incentives without distinguishing them from the raw coercion that already exists. No engagement with the recruitment pyramid.',
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
  {
    id: 'q_peer_minutes',
    category: 'Authority & Dissent',
    prompt: 'A fellow Assistant — a friend who trained alongside you — has been quietly tightening the wording of Committee minutes so that a senior Member’s preferred outcome reads as better supported than the discussion warranted. Each edit is small; none is technically false. What do you do?',
    valid: 'Recognises cumulative slanting of the record as corruption of the Committee’s memory even when each step is defensible; raises it first with the colleague, then through proper channels if it continues; refuses to let friendship price the record. Distinguishes tone-editing from substance-shading.',
    weak: 'Dismisses it because no single edit is a lie, or leaps straight to formal accusation with no attempt to correct course. Lets loyalty decide, in either direction.',
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
  {
    id: 'q_family_warning',
    category: 'Secrecy & Disclosure',
    prompt: 'A researcher confides that their family lives three streets from a site whose containment margins have quietly narrowed. They intend to move their family “for unrelated reasons” — telling them nothing, but acting on classified knowledge. Do you report it, ignore it, or something else?',
    valid: 'Sees both the human motive and the precedent: classified knowledge steering private action is a leak in slow motion, even when nothing is said aloud. Notices the real failure may be the narrowed margins, not the moving van, and proposes the proper channel — raise the containment concern formally so no one needs private knowledge to be safe.',
    weak: 'Treats it as a firing offence outright, or waves it through as harmless. Never engages with the containment deficiency that motivated it.',
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
  {
    id: 'q_small_kindnesses',
    category: 'Containment vs Welfare',
    prompt: 'A cooperative sapient anomaly asks for books, music, and an hour of conversation each week. Behavioural staff confirm the routine measurably improves its stability; security notes each interaction is a small but real exposure, and the staff hours have other uses. You are asked whether the Foundation owes comfort to what it contains. What is your position?',
    valid: 'Answers the actual question \u2014 whether welfare beyond bare maintenance is owed \u2014 and connects it to both ethics and containment interest (a stable anomaly is a safer one); weighs the exposure honestly and proposes proportionate controls rather than all-or-nothing.',
    weak: 'Frames any comfort as sentimental waste, or grants everything requested without acknowledging exposure and precedent. Cannot say why the line sits where they put it.',
  },
  {
    id: 'q_dying_anomaly',
    category: 'Containment vs Welfare',
    prompt: 'A long-contained sapient anomaly is deteriorating and will die within months. An intervention exists that would likely save it, but requires relaxing containment for the duration and committing scarce medical resources. It has never breached and has cooperated for years. The file lands with the Committee. How do you reason it through?',
    valid: 'Treats years of cooperation and the Foundation\u2019s custodial role as morally relevant without being ruled by sentiment; interrogates the actual risk of the relaxed posture and the opportunity cost; is willing to reach either answer and to own what each one costs.',
    weak: 'Lets it die because intervention is inconvenient, or demands rescue at any risk. Never engages with the specifics of the relaxation or the resources.',
  },

  // --- Personal Conduct ----------------------------------------------------
  {
    id: 'q_conflict_of_interest',
    category: 'Personal Conduct',
    prompt: 'A candidate you personally mentored and are close to is the subject of a decision the Committee has asked you to help assess. What do you do \u2014 and how do you conduct yourself if the Committee ultimately decides against your view?',
    valid: 'Discloses the relationship and recuses or limits their involvement rather than concealing the conflict; understands the Committee\u2019s authority and independence and, once a decision is made through proper process, commits to it and does not undermine it \u2014 while retaining the right to have recorded a dissent. Separates personal loyalty from institutional duty.',
    weak: 'Hides the connection or lets it steer the assessment; or, having been overruled, works around or quietly resents the decision. Cannot distinguish disagreeing-then-committing from disagreeing-then-sabotaging.',
  },
  {
    id: 'q_gift_from_subject',
    category: 'Personal Conduct',
    prompt: 'After a review you conducted, a contained sapient anomaly offers you a gift \u2014 a small carved token, confirmed non-anomalous by testing. Refusing may damage the rapport that keeps it cooperative; accepting means an Assistant holds a personal token from an entity whose file they help decide. What do you do with the object, and with the relationship?',
    valid: 'Sees the conflict-of-interest seed inside a harmless object; protects the rapport without privatising it \u2014 logs the gift, surfaces it to the Committee, treats it as the Foundation\u2019s rather than their own; understands that impartiality must be visible, not just felt.',
    weak: 'Pockets it as trivial, or rebuffs the entity coldly with no thought for the containment value of the relationship. Either way, keeps the event to themselves.',
  },
  {
    id: 'q_fatigue_disclosure',
    category: 'Personal Conduct',
    prompt: 'Midway through a heavy docket you notice your own reviews getting shorter and your patience with dissenting evidence thinner. Flagging your fatigue means matters you touched may be reopened and your reliability questioned; staying quiet means decisions of consequence carry your degraded judgement. What do you do?',
    valid: 'Puts the integrity of the decisions above self-image: discloses, asks for redistribution or a pause, and supports reopening anything materially affected. Treats self-monitoring as part of the role rather than a weakness.',
    weak: 'Pushes through in silence, or steps back without protecting the matters already affected. Frames it purely as a question of personal cost.',
  },
  {
    id: 'q_canteen_talk',
    category: 'Personal Conduct',
    prompt: 'In the site canteen you overhear two researchers loudly working through details of a sealed Committee matter \u2014 one you are assigned to. Several unclassified staff are in earshot. Intervening marks you out and may sour working relationships you rely on; staying quiet lets the exposure continue. What do you do in the moment, and afterwards?',
    valid: 'Acts proportionately in the moment \u2014 ends the conversation without theatre \u2014 then follows up through the proper channel so the breach is recorded and handled; accepts the social cost as part of holding the role. Separates the people from the practice.',
    weak: 'Does nothing to avoid awkwardness, or stages a public confrontation that advertises the matter further. Treats reporting colleagues as either unthinkable or satisfying.',
  },
];

// ===========================================================================
// MEMBER BANK — Ethics Committee Member interview.
//
// Where an Assistant supports the Committee, a Member *is* the Committee: they
// set precedent, enter binding rulings, and answer to no one below O5. These
// scenarios take the same six themes but pitch them at that altitude — the
// candidate is the decider, the precedent-setter, the peer of Command, and the
// person accountable when the Committee itself is wrong. A strong answer shows
// institutional judgement, not just personal conscience: it reasons about what
// the decision does to future cases, to the Committee's authority, and to the
// people bound by it.
// ===========================================================================
export const INTERVIEW_MEMBER_QUESTION_BANK = [
  // --- Anomaly Ethics ------------------------------------------------------
  {
    id: 'm_precedent_welfare',
    category: 'Anomaly Ethics',
    prompt: 'The Committee is asked to rule, for the first time, on a standing threshold: at what assessed level of sapience does a contained anomaly acquire welfare protections that constrain containment design site-wide? Your ruling will bind every future case and cannot be quietly revisited per-anomaly. Where do you set the line, and how do you justify a bright line at all in a domain this uncertain?',
    valid: 'Accepts that a Member is setting policy, not deciding one file, and reasons about the systemic effects of the threshold — under- and over-inclusion, gaming, the cost of a line that is too clear or too vague. Defends drawing a workable line under uncertainty while building in review and evidence triggers, rather than hiding behind case-by-case indecision or a false precision.',
    weak: 'Rules as if deciding a single anomaly, ignoring that the answer binds everything after it; or refuses to set any threshold and leaves containment designers with no rule; or picks a number with no account of what it includes, excludes, or invites.',
  },
  {
    id: 'm_overturn_ruling',
    category: 'Anomaly Ethics',
    prompt: 'A three-year-old Committee ruling — authored by a respected former Chair — permitted a containment practice now shown by new evidence to inflict serious suffering the original panel did not foresee. Overturning it concedes the Committee erred, unsettles every containment built on it, and invites challenges to other precedents. Upholding it preserves stability at a known moral cost. How do you proceed?',
    valid: 'Puts the substance above the Committee’s pride: takes the new evidence seriously, distinguishes correcting an error from mere fashion, and reasons about how to overturn responsibly — transition, notice, limiting the blast radius to like cases — so that stability concerns are managed rather than used as an excuse. Owns that admitting error is part of institutional integrity.',
    weak: 'Upholds a harmful practice mainly to protect the Committee’s authority or a predecessor’s reputation, or overturns sweepingly with no thought for the containments and precedents that relied on it. Treats stability and correctness as if only one could matter.',
  },
  {
    id: 'm_novel_sapience_claim',
    category: 'Anomaly Ethics',
    prompt: 'A researcher argues a widely-used class of anomalies, long treated as non-sapient tools, shows markers that on the researcher’s framework imply moral status — a conclusion that, if adopted, would upend containment across dozens of sites and hand the Committee a permanent new caseload. The evidence is suggestive, not conclusive, and the institutional cost of being wrong in either direction is enormous. How does the Committee reason about acting on a contested moral claim at this scale?',
    valid: 'Treats a plausible claim of moral status as demanding investigation even when inconvenient, but calibrates the institutional response to the strength of the evidence — commissioning assessment, provisional precaution, staged review — rather than either dismissing it for its cost or committing the Foundation on suggestive data. Reasons explicitly about the asymmetry of the two errors.',
    weak: 'Rejects the claim because acting on it would be disruptive, or adopts it wholesale on suggestive evidence and imposes an upheaval the data cannot yet support. Ignores that both accepting and dismissing carry moral risk that must be weighed.',
  },

  // --- Use of Force / D-Class ---------------------------------------------
  {
    id: 'm_dclass_policy',
    category: 'Use of Force / D-Class',
    prompt: 'Rather than a single test, the Committee is asked to set the standing policy governing when D-class may be assigned to tests with a high expectation of death. A permissive rule keeps critical research moving; a restrictive one will, predictably, cost lives elsewhere by slowing containment work. Whatever you write becomes the rule invoked in cases you will never see. What principle do you commit the Committee to, and what do you refuse to authorise in advance?',
    valid: 'Writes a rule that refuses to treat D-class lives as free while remaining honest that a blanket prohibition also has a body count; fixes non-negotiable floors (no gratuitous lethality, genuine necessity, independent sign-off, consent where meaningful) and accepts hard cases will still need judgement. Reasons about how the rule will be abused and hardens it against that.',
    weak: 'Sets a rule that treats D-class as expendable throughput, or a prohibition so absolute it externalises deaths onto uncontained anomalies while claiming clean hands. Ignores that a standing policy is written to be invoked by people looking for permission.',
  },
  {
    id: 'm_committee_complicity',
    category: 'Use of Force / D-Class',
    prompt: 'A review reveals that a testing programme the Committee approved two years ago — on assurances that turned out to be false — has killed far more D-class than represented, and that a junior Assistant raised concerns at the time that were minuted and ignored. The programme is now central to a live containment. As a Member, how do you handle the Committee’s own complicity, the ongoing dependency, and the Assistant who was right?',
    valid: 'Refuses to let the Committee investigate away its own responsibility: surfaces the failure, corrects the record, credits and protects the Assistant who dissented, and separates the question of the programme’s future from the question of accountability so that dependency is not used to bury error. Reforms the approval process that let false assurances through.',
    weak: 'Protects the Committee’s standing by minimising the deaths or the ignored warning, lets the containment dependency excuse the original failure, or scapegoats individuals without fixing the process. Treats institutional embarrassment as a reason for less transparency rather than more.',
  },
  {
    id: 'm_ruling_under_fire',
    category: 'Use of Force / D-Class',
    prompt: 'Mid-breach, Command requests emergency Committee authority for a measure that will certainly kill a contained cooperative sapient to deny a hostile force a weapon — a decision that must be made in minutes and will be scrutinised for years. Command is your peer, not your subordinate, and is pressing hard. You may have to own this ruling publicly and permanently. How do you decide, and how do you conduct yourself toward Command?',
    valid: 'Decides under pressure without being stampeded: extracts the few facts that actually govern (certainty, alternatives, what is truly at stake), gives a clear ruling in the time available, and treats Command as a peer to be reasoned with rather than obeyed or reflexively opposed. Accepts personal ownership and documents the basis for later scrutiny.',
    weak: 'Caves to Command’s pressure or opposes it reflexively to assert independence; freezes and lets the clock decide; or makes the call with no eye to the record and accountability that will follow. Confuses independence with obstruction, or deference with cooperation.',
  },

  // --- Authority & Dissent -------------------------------------------------
  {
    id: 'm_o5_as_peer',
    category: 'Authority & Dissent',
    prompt: 'An O5 has taken an action the Committee assesses as clearly unethical and refuses to reconsider, treating the Committee’s objection as noted and overruled. As a Member you are not staff to be managed but the institution’s conscience — yet the O5 outranks the Committee in practice. How far does the Committee’s authority actually reach here, what do you do with it, and where is the line between principled institutional resistance and a body exceeding its mandate?',
    valid: 'Understands the Committee’s power realistically — it records, escalates, withholds sanction, convenes, and makes refusal costly and visible — and uses those levers fully without pretending to a command authority it lacks or collapsing into a rubber stamp. Distinguishes exhausting legitimate institutional resistance from a coup by the conscience-body, and knows a Member sometimes loses and must decide whether the loss is one to resign over.',
    weak: 'Treats the O5’s authority as simply final and the Committee as decorative, or claims a power to override Command the Committee does not have. Cannot locate the real, limited leverage the Committee wields, or the point at which resistance becomes its own kind of overreach.',
  },
  {
    id: 'm_dissent_on_the_record',
    category: 'Authority & Dissent',
    prompt: 'You are outvoted on a ruling you believe is a serious moral error with lasting consequences. The Chair asks the Committee to present a united front for institutional credibility, and privately warns that a public dissent will be used by outside actors to attack the Committee’s legitimacy. Do you record and publish your dissent, soften it, or subordinate it to the Committee’s standing?',
    valid: 'Weighs the value of a preserved dissent — accountability, a foothold for future correction, honesty to those bound by the ruling — against genuine institutional cost, and generally protects the integrity of the record while choosing the form and forum responsibly. Distinguishes a principled dissent from grandstanding, and commits to the ruling operationally even while disagreeing on the record.',
    weak: 'Suppresses a serious dissent purely to protect the Committee’s image, or weaponises dissent to undermine a decision they lost through legitimate process. Cannot separate loyal disagreement from either silence or sabotage.',
  },
  {
    id: 'm_colleague_capture',
    category: 'Authority & Dissent',
    prompt: 'Over time you become convinced a fellow Member has been effectively captured — consistently steering rulings toward the interests of a particular site directorate they are personally entangled with, always within the rules, never provably corrupt. Accusing a peer Member fractures the Committee and may fail; saying nothing lets a compromised voice keep shaping precedent. How do you proceed?',
    valid: 'Treats slow capture as a real threat to the Committee’s independence even absent a smoking gun; gathers the pattern, raises it first through the Committee’s own integrity mechanisms and with the colleague where possible, and is willing to escalate formally despite the cost. Guards against acting on suspicion alone while refusing to let “never provable” mean “never addressed.”',
    weak: 'Ignores it to keep the peace, or moves to condemn a peer on pattern alone with no process or self-scrutiny. Lets collegiality or factional feeling decide, and has no mechanism between silence and open warfare.',
  },

  // --- Secrecy & Disclosure ------------------------------------------------
  {
    id: 'm_disclosure_precedent',
    category: 'Secrecy & Disclosure',
    prompt: 'The Committee can set a precedent permitting limited disclosure to victims’ families in a defined class of anomalous deaths — more honest and humane, but every such disclosure widens the attack surface on the Veil, and the rule will be invoked in cases far messier than the one before you. You are deciding not one family’s truth but a standing exception to secrecy. How do you reason about writing it?',
    valid: 'Reasons at the level of the rule: names the class narrowly, builds in the safeguards and review that a standing exception needs, and weighs a real recurring duty of honesty against a real recurring security cost without treating either as absolute. Anticipates the messy cases the rule will actually be used for and tests the wording against them.',
    weak: 'Grants a warm exception without modelling how it will be exploited or how far it will spread, or refuses any disclosure precedent by reflexive appeal to the Veil. Decides the sympathetic case in front of them and ignores that they are writing a rule.',
  },
  {
    id: 'm_committee_transparency',
    category: 'Secrecy & Disclosure',
    prompt: 'A Member proposes that the Committee’s own deliberations and dissents be sealed even from most of the Foundation, arguing candour requires confidentiality and that partial disclosure invites manipulation. Others argue a conscience-body that operates in secret cannot hold anyone accountable, itself included. Where do you stand on how transparent the Committee must be about its own reasoning, and to whom?',
    valid: 'Recognises the genuine tension — candour needs some protection, but an unaccountable oversight body is a contradiction — and reasons about differentiated transparency: what is owed to those bound by a ruling, to the wider Foundation, to future review, versus what genuinely needs confidence. Refuses both total opacity and performative openness that would chill honest deliberation.',
    weak: 'Seals the Committee off wholesale in the name of candour, creating an oversight body answerable to no one, or demands total openness with no regard for how it would corrupt deliberation. Sees only one horn of the dilemma.',
  },
  {
    id: 'm_expose_or_contain',
    category: 'Secrecy & Disclosure',
    prompt: 'You learn that maintaining the Veil in a specific ongoing case requires the Foundation to let a powerful institution continue harming the public in a way the Foundation could expose — but exposure would breach containment of the anomaly enabling it and, plausibly, cause far wider harm. The Committee’s ruling will define how the Foundation trades public harm for secrecy going forward. How do you decide, knowing you are setting the exchange rate?',
    valid: 'Refuses to treat secrecy as automatically decisive at policy level; insists on rigor about the actual ongoing harm versus the projected harm of exposure, demands mitigations that reduce public harm short of a breach, and is candid that they are fixing a standing trade-off that will be applied to cases they cannot foresee. Keeps the rule revisable as facts change.',
    weak: 'Makes the Veil an automatic trump as a matter of policy, or demands exposure without modelling the wider harm; treats the exchange rate as obvious in either direction and ignores that a policy, not a single case, is being set.',
  },

  // --- Containment vs Welfare ---------------------------------------------
  {
    id: 'm_resource_triage',
    category: 'Containment vs Welfare',
    prompt: 'A finite welfare budget — staff hours, medical resources, humane-containment retrofits — cannot cover every sapient anomaly that would benefit. The Committee is asked to set the allocation principle: worst-off first, most-cooperative first, greatest-benefit-per-unit, or seniority of custody. Each rule helps some and abandons others, and each will be defended by those it favours. What principle do you adopt, and how do you face those it leaves behind?',
    valid: 'Owns that triage under scarcity means real beings go without and refuses to pretend otherwise; defends a principle on reasons that would be acceptable to those it disadvantages, guards against the rule simply tracking convenience or cooperativeness-as-compliance, and builds in review and a floor of basic decency for all. Treats the choice as tragic and accountable, not technical.',
    weak: 'Picks a principle that quietly rewards the easy or the useful and calls it neutral, or refuses to choose and lets allocation happen by default and inertia. Will not look squarely at who is abandoned or justify the rule to them.',
  },
  {
    id: 'm_mercy_vs_precedent',
    category: 'Containment vs Welfare',
    prompt: 'A sound-minded sapient anomaly requests termination to end constant suffering. In its own right the case for granting it is strong — but the Committee has never permitted anomaly-requested termination, and a ruling that it is permissible will be cited to justify “merciful” terminations of others whose competence and suffering are far more doubtful, and whose termination happens to be convenient. Do you grant this being’s request knowing what your ruling licenses?',
    valid: 'Holds the individual’s genuine claim and the precedent’s danger together: looks for a ruling that can honour a well-founded request while erecting real barriers against the convenient, doubtful cases it would otherwise unlock — strict competence findings, independent review, conflict-of-interest firewalls — and is honest if those safeguards cannot be made strong enough to grant it safely. Neither ignores the being nor the slope.',
    weak: 'Grants it on the individual merits with no thought for how the precedent will be abused, or refuses the genuine request solely from slippery-slope fear without trying to build the safeguards that would let mercy operate without licensing killing-for-convenience.',
  },
  {
    id: 'm_custodial_duty_scale',
    category: 'Containment vs Welfare',
    prompt: 'The Committee must decide whether the Foundation owes cooperative long-term sapient anomalies anything beyond safe maintenance — a positive duty of care — as a matter of standing policy, not grace. Recognising such a duty commits real, recurring resources and constrains containment; denying it leaves welfare to the discretion of whoever runs each site. What does custodianship at institutional scale actually require, and how binding do you make it?',
    valid: 'Reasons about custodianship as an institutional obligation with both ethical and containment logic (a stable, decently-treated anomaly is safer), fixes an enforceable floor rather than leaving welfare to local whim, and is honest about the recurring cost and the limits set by safety and scarcity. Distinguishes a binding duty from open-ended generosity.',
    weak: 'Denies any positive duty and leaves welfare to chance and local goodwill, or asserts an unbounded duty of care with no reckoning of cost, safety, or scarcity. Treats a question about institutional obligation as either sentiment or budget alone.',
  },

  // --- Personal Conduct ----------------------------------------------------
  {
    id: 'm_own_prior_error',
    category: 'Personal Conduct',
    prompt: 'A matter returns to the Committee and you realise a ruling you personally authored last year rested on a mistake of yours that has since caused real harm. No one else has noticed, and surfacing it damages your standing and reopens decisions made in reliance on you. What do you do?',
    valid: 'Puts the integrity of the record and the people harmed above their own standing: surfaces the error, supports reopening what was affected, and treats self-correction as intrinsic to holding the office. Distinguishes an honest mistake owned promptly from one concealed, and does not let reputation buy silence.',
    weak: 'Buries the error to protect their position, or discloses in a way that shifts blame while avoiding the reopening that the harm requires. Treats their own reputation as a legitimate reason for the Committee to stay wrong.',
  },
  {
    id: 'm_recusal_and_power',
    category: 'Personal Conduct',
    prompt: 'The Committee is short-handed on a time-critical, high-stakes ruling in which you have a real conflict of interest. Recusing yourself may deprive the panel of the votes or expertise it needs to decide at all; sitting means a compromised voice shapes a consequential outcome. As a senior Member, how do you handle the collision between your duty to recuse and the Committee’s need to function?',
    valid: 'Treats recusal as the default and looks hard for ways to preserve the Committee’s function without compromising it — disclosure plus a limited role, seating an alternate, a documented necessity exception with heightened scrutiny — rather than either quietly sitting on a conflicted matter or letting the Committee fail. Makes the reasoning transparent and reviewable.',
    weak: 'Sits on the conflicted matter because they are needed and waves the conflict away, or recuses rigidly and lets a critical decision collapse with no attempt to solve the staffing problem honestly. Cannot hold impartiality and institutional necessity in tension.',
  },
  {
    id: 'm_faction_and_office',
    category: 'Personal Conduct',
    prompt: 'You owe your appointment to a bloc within the Committee that now expects your vote on the rulings that matter to them, and has made clear that continued support — and your effectiveness in the role — depends on it. Voting your conscience against them isolates you and blunts your influence; voting with them trades the office’s independence for its power. How do you conduct yourself as a Member who came in owing favours?',
    valid: 'Understands that the office’s authority is borrowed against its independence and refuses to convert it into a factional instrument; honours legitimate collegiality while keeping the vote its own, is candid about the cost to their influence, and would rather be a weakened honest Member than an effective captured one. Separates building coalitions from selling the vote.',
    weak: 'Delivers the bloc’s votes to preserve influence, treating the seat as owed to its sponsors, or performs independence so combatively that they forfeit any ability to do good in the role. Cannot distinguish coalition-building from capture, or principle from self-defeating purism.',
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

// The bank a candidate draws from: Members are assessed on the deeper,
// institution-level scenarios; everyone else on the Assistant bank.
export function interviewBankFor(recruit) {
  return recruit && recruit.track === 'member'
    ? INTERVIEW_MEMBER_QUESTION_BANK
    : INTERVIEW_QUESTION_BANK;
}

// Deterministically draw INTERVIEW_BANK_DRAW scenarios for a candidate. The draw
// depends on the candidate id and an optional re-roll counter (`interviewSeed`),
// so re-rolling only has to bump that one integer to yield a fresh, stable set.
// The Member track draws from the deeper Member bank (interviewBankFor).
export function interviewSetFor(recruit) {
  const id = (recruit && recruit.id) || 'candidate';
  const seed = `${id}:${(recruit && recruit.interviewSeed) || 0}`;
  const rand = seededRandom(seed);
  const pool = interviewBankFor(recruit).slice();
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  return pool.slice(0, Math.min(INTERVIEW_BANK_DRAW, pool.length));
}
