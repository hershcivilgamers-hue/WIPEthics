// Operator messaging: the send/immutable/withdraw gate, and the participant-only
// redaction with Administrator (not CL5) read-through.
import assert from 'node:assert';
import { authorizeWrite } from '../worker/src/gate.js';
import { buildSnapshot } from '../worker/src/redact.js';

const w = (actor, cur, next) => authorizeWrite('messages', actor, cur, next, {});

const alice = { id: 'u_alice', designation: 'O1-1', org: 'omega-1', rank: 'Commander', clearance: 'CL4-S' };
const bob   = { id: 'u_bob', designation: 'O1-9', org: 'omega-1', rank: 'Private', clearance: 'CL3' };
const carol = { id: 'u_carol', designation: 'EC-5', org: 'ethics-committee', rank: 'Assistant', clearance: 'CL4-J' };
const cl5   = { id: 'u_cmd', designation: 'CMD-1', org: 'command', rank: 'Director', clearance: 'CL5' };
const staff = { id: 'u_staff', designation: 'O1-7', org: 'omega-1', rank: 'Sergeant', clearance: 'CL3', admin: { standing: 'active' } };

const t = '2026-07-26T00:00:00.000Z';
const msg = { id: 'msg_1', from: 'u_alice', participants: ['u_alice', 'u_bob'], body: 'hello', at: t, deleted: false, version: 1 };

// --- Send: only as yourself, needs a recipient and a body ---
assert.equal(w(alice, null, msg).action, 'SEND_MESSAGE', 'a participant sends as themselves');
assert.equal(w(bob, null, msg).ok, false, 'cannot forge another sender');
assert.equal(w(alice, null, { ...msg, participants: ['u_alice'] }).ok, false, 'needs a recipient');
assert.equal(w(alice, null, { ...msg, participants: ['u_bob', 'u_carol'] }).ok, false, 'sender must be a participant');
assert.equal(w(alice, null, { ...msg, body: '   ' }).ok, false, 'empty message refused');
assert.ok(!/hello/.test(w(alice, null, msg).detail || ''), 'the audit detail never carries the body');

// --- A sent message is immutable (body + participants) ---
assert.equal(w(alice, msg, { ...msg, body: 'edited', version: 2 }).ok, false, 'body is immutable');
assert.equal(w(alice, msg, { ...msg, participants: ['u_alice', 'u_bob', 'u_carol'], version: 2 }).ok, false, 'participants immutable');

// --- Withdraw: sender or Administrator, never a recipient or bare CL5 ---
const gone = { ...msg, deleted: true, deletedAt: t, version: 2 };
assert.equal(w(alice, msg, gone).action, 'REMOVE_MESSAGE', 'sender withdraws their own');
assert.equal(w(bob, msg, gone).ok, false, 'a recipient cannot withdraw it');
assert.equal(w(staff, msg, gone).action, 'REMOVE_MESSAGE', 'an Administrator may moderate');
assert.equal(w(cl5, msg, gone).ok, false, 'CL5 (not staff) cannot remove a private message');

// --- Redaction: only participants + Administrators receive a message ---
const db = { messages: [msg], compartments: [], users: [], audit: [] };
const seenBy = (actor) => buildSnapshot(actor, db).messages.map((m) => m.id);
assert.deepEqual(seenBy(alice), ['msg_1'], 'a participant receives it');
assert.deepEqual(seenBy(bob), ['msg_1'], 'the other participant receives it');
assert.deepEqual(seenBy(carol), [], 'a non-participant never receives it');
assert.deepEqual(seenBy(cl5), [], 'CL5 gets no read-through of private messages');
assert.deepEqual(seenBy(staff), ['msg_1'], 'an Administrator gets read-through for moderation');

console.log('messages OK — gate (send/immutable/withdraw) + participant-only redaction with Admin read-through.');
