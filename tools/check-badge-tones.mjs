// =============================================================================
// check-badge-tones.mjs — every tone maps to a real chip class.
//   node tools/check-badge-tones.mjs
//
// A badge/org-tag is coloured by a `tone` string from constants.js (badge--ok,
// org-tag--omega, …). If a tone has no matching CSS class the chip renders as an
// unstyled, borderless blob — the exact defect that shipped as `org-tag--isd`.
// This walks every `tone: '…'` in constants and asserts a class exists for it.
// =============================================================================

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const constants = readFileSync(join(root, 'js', 'constants.js'), 'utf8');

// Every distinct tone referenced in the domain constants.
const tones = new Set([...constants.matchAll(/tone:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
assert.ok(tones.size >= 8, `expected the usual tone palette, found ${tones.size}`);

// Every badge-- / org-tag-- class defined anywhere in the stylesheets.
const stylesDir = join(root, 'styles');
const css = readdirSync(stylesDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(stylesDir, f), 'utf8'))
  .join('\n');
const badgeClasses = new Set([...css.matchAll(/\.badge--([a-z0-9-]+)/g)].map((m) => m[1]));
const tagClasses = new Set([...css.matchAll(/\.org-tag--([a-z0-9-]+)/g)].map((m) => m[1]));

// A tone is satisfied if EITHER a badge or an org-tag class colours it — both
// renderers key off the same tone string.
const orphans = [...tones].filter((t) => !badgeClasses.has(t) && !tagClasses.has(t));
assert.deepEqual(orphans, [], `tones with no .badge--/.org-tag-- class (renders unstyled): ${orphans.join(', ')}`);

// And the reverse sanity: the org tones are coloured for BOTH renderers, since
// an org appears as a tag (orgTag) and, since 2026-07, potentially as a badge.
for (const org of ['omega', 'ethics', 'command', 'isd']) {
  if (tones.has(org)) {
    assert.ok(badgeClasses.has(org), `.badge--${org} missing (an org badge would be unstyled)`);
    assert.ok(tagClasses.has(org), `.org-tag--${org} missing (an org tag would be unstyled)`);
  }
}

console.log(`OK — all ${tones.size} constant tones have a chip class; org tones cover badge + tag.`);
