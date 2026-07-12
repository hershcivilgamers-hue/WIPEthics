globalThis.document = { createElement: () => ({ style:{}, appendChild(){}, click(){}, remove(){} }), body:{ appendChild(){} } };
globalThis.window = {};
const E = await import('./js/export.js');
const { interviewSetFor } = await import('./js/interview-bank.js');
const recruit = { id:'rec1', ref:'APP-EC-011', name:'Aldous, R.', customQuestions: [], interviewResponses: {},
  interviewAssessment: { recommendation:'reservations', summary:'secret channel',
    strengths:'You engage honestly with competing duties.', improvements:'Work on weighing magnitudes.',
    perQuestion: {}, model:'m', at:'t', by:'EC-3' } };
const q = interviewSetFor(recruit)[0];
recruit.interviewResponses[q.id] = { text:'I would escalate via the Committee.', by:'EC-3', at:'t' };
recruit.interviewAssessment.perQuestion[q.id] = { grade:'weak', rationale:'interviewer-only text', feedback:'Consider the townspeople as well.' };
const fb = E.buildFeedbackSheetHTML(recruit, { designation:'EC-3' });
for (const re of [/Dear Aldous, R\.,/, /By direction of the Ethics Committee,/, /Consider the townspeople/, /fb-answer/]) if (!re.test(fb)) throw new Error('feedback missing '+re);
for (const re of [/interviewer-only text/, /A valid response/i, /Recommend with reservations/, /INTERVIEWER.S COPY/, /#7a1010.*fb-/s]) if (re.test(fb)) throw new Error('feedback LEAK '+re);
if (/iv-q\b/.test(fb)) throw new Error('feedback still uses interviewer iv-q boxes');
const inv = E.buildInterviewInviteHTML(recruit, { designation:'EC-3' }, false);
for (const re of [/letter-date/, /Dear Aldous, R\.,/, /By direction of the Ethics Committee,/, /FOUNDATION GENERAL · FOR THE NAMED CANDIDATE/]) if (!re.test(inv)) throw new Error('invite missing '+re);
if (/<table class="ctrl">/.test(inv)) throw new Error('control table still at head');
if (!/foot--meta/.test(inv)) throw new Error('meta footer missing');
const c = { ref:'EC-CASE-26-014', title:'Containment Attrition Review — Sector 12', kind:'review', clearance:'CL4-J', summons:[], entries:[], linkedSubjectIds:[], panelIds:[], votes:{}, ruling:null };
const sm = E.buildSummonsHTML(c, { id:'s', ts:'2026-07-12T00:00:00Z', by:'EC-1', targetName:'Cdr. Vanguard', targetDept:'MTF Omega-1', reason:'Provide account.' }, { designation:'EC-1' });
if (!/Given under the seal of the Ethics Committee at SITE-CMD/.test(sm)) throw new Error('summons seal line missing');
const script = E.buildInterviewScriptHTML(recruit, { designation:'EC-3' });
if (!/INTERVIEWER.S COPY — DO NOT DISCLOSE/.test(script)) throw new Error('script warning lost');
console.log('POST-REDESIGN CHECKS OK — letters letter-shaped, feedback de-redded + leak-free, ctrl relocated, summons sealed, script warning intact');
