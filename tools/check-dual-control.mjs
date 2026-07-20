// =============================================================================
// check-dual-control.mjs — self-check for the two-signature discharge gate
// (REC-10). This is the SERVER authority: it proves the rule holds even when a
// crafted write bypasses the client. Run with `node`; throws on first failure.
//
//   node tools/check-dual-control.mjs
// =============================================================================

import assert from 'node:assert';
import { authorizeWrite } from '../worker/src/gate.js';

// Two distinct discharging authorities (CL5 can discharge anyone), one operator.
const A = { id: 'a', clearance: 'CL5', org: 'command', designation: 'CMD-A' };
const B = { id: 'b', clearance: 'CL5', org: 'command', designation: 'CMD-B' };
const C = { id: 'c', clearance: 'CL3', org: 'omega-1', designation: 'O1-7' }; // not an authority
const X = () => ({ id: 'x', designation: 'O1-9', codename: 'Probate', org: 'omega-1',
  clearance: 'CL3', rank: 'Private', status: 'active', version: 1, events: [],
  pendingDischarge: null, discharge: null });

const gate = (actor, cur, next) => authorizeWrite('users', actor, cur, next);
const clone = (o) => JSON.parse(JSON.stringify(o));
const pd = (by, label) => ({ type: 'honourable', reason: 'End of tour.', requestedBy: by, requestedByLabel: label, requestedAt: 't', status: 'pending' });

// A record with a discharge already filed by A, awaiting co-signature.
const filed = () => { const r = X(); r.pendingDischarge = pd('a', 'CMD-A'); return r; };
const enact = (from) => { const n = clone(from); n.status = 'discharged';
  n.discharge = { type: 'honourable', by: 'CMD-A', cosignedBy: 'CMD-?', at: 't2', reason: 'End of tour.' };
  n.pendingDischarge = null; return n; };

// 1) File — A files a discharge on X.
{
  const cur = X(); const next = clone(cur); next.pendingDischarge = pd('a', 'CMD-A');
  const r = gate(A, cur, next);
  assert.ok(r.ok && r.action === 'REQUEST_DISCHARGE', '1 file: ' + JSON.stringify(r));
}
// 2) Self co-sign is REFUSED — A filed, A tries to enact.
{
  const r = gate(A, filed(), enact(filed()));
  assert.ok(!r.ok, '2 self-cosign must be denied: ' + JSON.stringify(r));
}
// 3) A DIFFERENT authority co-signs — A filed, B enacts.
{
  const r = gate(B, filed(), enact(filed()));
  assert.ok(r.ok && r.action === 'DISCHARGE', '3 different co-sign: ' + JSON.stringify(r));
}
// 4) Lone enactment with NO pending request is REFUSED (the bypass path).
{
  const cur = X(); const next = clone(cur); next.status = 'discharged';
  next.discharge = { type: 'honourable', by: 'CMD-B', at: 't', reason: 'x' };
  const r = gate(B, cur, next);
  assert.ok(!r.ok, '4 lone discharge without a filed request must be denied: ' + JSON.stringify(r));
}
// 5) Enacted substance must MATCH what was filed.
{
  const next = enact(filed());
  next.discharge.type = 'dishonourable'; next.discharge.reason = 'Tampered.';
  const r = gate(B, filed(), next);
  assert.ok(!r.ok, '5 mismatched enactment must be denied: ' + JSON.stringify(r));
}
// 6) Cannot file under someone else's authority.
{
  const cur = X(); const next = clone(cur); next.pendingDischarge = pd('b', 'CMD-B'); // A claims B filed
  const r = gate(A, cur, next);
  assert.ok(!r.ok, '6 filing under another authority must be denied: ' + JSON.stringify(r));
}
// 7) A different authority may REJECT a pending discharge.
{
  const next = clone(filed()); next.pendingDischarge = null;
  const r = gate(B, filed(), next);
  assert.ok(r.ok && r.action === 'REJECT_DISCHARGE', '7 reject by other authority: ' + JSON.stringify(r));
}
// 8) The filer may WITHDRAW their own pending discharge.
{
  const next = clone(filed()); next.pendingDischarge = null;
  const r = gate(A, filed(), next);
  assert.ok(r.ok && r.action === 'REJECT_DISCHARGE', '8 filer withdraws: ' + JSON.stringify(r));
}
// 9) A non-authority cannot file at all.
{
  const cur = X(); const next = clone(cur); next.pendingDischarge = pd('c', 'O1-7');
  const r = gate(C, cur, next);
  assert.ok(!r.ok, '9 non-authority cannot file: ' + JSON.stringify(r));
}

console.log('OK — dual-control: file, co-sign by a different authority, self-cosign blocked, lone-enact blocked, substance-match, reject & withdraw, non-authority blocked.');
