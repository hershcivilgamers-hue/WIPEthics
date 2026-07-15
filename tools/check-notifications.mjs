// =============================================================================
// check-notifications.mjs — self-check for the pure helpers behind the two new
// "For Your Attention" branches: @mention detection and promotion eligibility.
//   node tools/check-notifications.mjs
// =============================================================================

import assert from 'node:assert';
import { mentionsActor } from '../js/views/notifications.js';
import { promoChecklistComplete } from '../js/constants.js';

// --- @mention boundary rule -------------------------------------------------
const h = ['ec-1', 'arbiter']; // lower-cased designation + codename

assert.equal(mentionsActor('please review this @EC-1', h), true, 'plain designation mention');
assert.equal(mentionsActor('@Arbiter what do you think?', h), true, 'codename mention');
assert.equal(mentionsActor('cc @ec-1, thanks', h), true, 'trailing punctuation is a boundary');
assert.equal(mentionsActor('nothing to see here', h), false, 'no mention');
assert.equal(mentionsActor('ping @EC-10 not you', h), false, 'EC-1 must NOT fire on EC-10');
assert.equal(mentionsActor('email arbiter@site.test', h), false, 'no leading @ before the handle');
assert.equal(mentionsActor('', h), false, 'empty text');
assert.equal(mentionsActor('hi @EC-1 and @EC-10', h), true, 'a real mention alongside a near-miss still fires');

// --- promotion checklist completeness ---------------------------------------
const reqSet = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
assert.equal(promoChecklistComplete({ promoChecks: ['a', 'b', 'c'] }, reqSet), true, 'all items ticked');
assert.equal(promoChecklistComplete({ promoChecks: ['a', 'b'] }, reqSet), false, 'one item short');
assert.equal(promoChecklistComplete({ promoChecks: ['a', 'b', 'c', 'x'] }, reqSet), true, 'extra ticks are harmless');
assert.equal(promoChecklistComplete({ promoChecks: [] }, { items: [] }), false, 'no items defined = not complete');
assert.equal(promoChecklistComplete({}, reqSet), false, 'no promoChecks at all');
assert.equal(promoChecklistComplete({ promoChecks: ['a'] }, null), false, 'no requirement set');

console.log('OK — notification mention + promotion-eligibility helpers hold.');
