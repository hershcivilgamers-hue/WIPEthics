import assert from 'node:assert';
const c = await import('../js/constants.js');
// High side (default): identity passes through untouched.
assert.equal(c.deBrandOmega('Opened O1-118 under Omega-1'), 'Opened O1-118 under Omega-1');
// Cover side: full unit name rewritten, O1- prefix and refs preserved.
c.setOmegaBranding(false);
assert.equal(c.deBrandOmega('Opened O1-118 under Omega-1'), 'Opened O1-118 under IE');
assert.equal(c.deBrandOmega('O1-SO-001 issued for Omega-1'), 'O1-SO-001 issued for IE'); // ref prefix intact
assert.equal(c.deBrandOmega('Generated MTF Omega-1 summary'), 'Generated Internal Enforcement summary');
assert.equal(c.deBrandOmega('Mobile Task Force Omega-1 stood up'), 'Internal Enforcement stood up');
assert.equal(c.deBrandOmega(''), '');
assert.equal(c.deBrandOmega(null), null);
c.setOmegaBranding(true); // restore
assert.equal(c.deBrandOmega('under Omega-1'), 'under Omega-1');
console.log('debrand OK');
