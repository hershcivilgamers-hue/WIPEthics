// =============================================================================
// check-insignia.mjs — self-check for rank insignia (SVG devices + image hook).
// No framework: run with `node`, it throws on the first failed assertion.
//
//   node tools/check-insignia.mjs
// =============================================================================

import assert from 'node:assert';
import { rankInsignia, hasInsignia, IMG } from '../js/insignia.js';

// Every officer/NCO rank draws an SVG device.
for (const r of ['Commander', 'Major', 'Captain', 'Lieutenant', 'Sergeant', 'Corporal', 'Lance Corporal']) {
  const html = rankInsignia('omega-1', r);
  assert.ok(html.includes('<svg') && /<(polygon|path|rect)/.test(html), `${r} draws an SVG device`);
  assert.ok(hasInsignia('omega-1', r), `${r} reports hasInsignia`);
}

// Private carries no device; unknown ranks/orgs are silent (never throw).
assert.equal(rankInsignia('omega-1', 'Private'), '', 'Private has no device');
assert.equal(hasInsignia('omega-1', 'Private'), false, 'Private reports no insignia');
assert.equal(rankInsignia('omega-1', 'Nonexistent'), '', 'unknown rank -> empty');
assert.equal(rankInsignia('no-such-org', 'Anything'), '', 'unknown org -> empty');

// The Committee and Command get their own devices.
assert.ok(rankInsignia('ethics-committee', 'Chairman').includes('<svg'), 'Chairman device');
assert.ok(rankInsignia('command', 'Director').includes('<svg'), 'Director device');

// Image backup: registering a real-insignia src makes rankInsignia prefer it.
IMG['omega-1'].Sergeant = 'data:image/png;base64,AAAA';
const img = rankInsignia('omega-1', 'Sergeant');
assert.ok(img.startsWith('<img') && img.includes('data:image/png;base64,AAAA'), 'IMG backup overrides the SVG');
delete IMG['omega-1'].Sergeant;
assert.ok(rankInsignia('omega-1', 'Sergeant').includes('<svg'), 'falls back to SVG once the image is cleared');

console.log('OK — insignia devices, empty-cases and image-backup override hold.');
