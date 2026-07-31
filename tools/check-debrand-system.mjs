import assert from 'node:assert';
const c = await import('../js/constants.js');
// Default is the COVER side: the boot loader and sign-in screen render before an
// actor is known and must never leak the real name to a non-CL5 viewer.
assert.equal(c.systemName(), 'AIC');
assert.equal(c.deBrandSystem('CAIRO.AIC · Surveillance'), 'AIC · Surveillance');
assert.equal(c.deBrandSystem('CAIRO · Operations'), 'AIC · Operations'); // eyebrow codename
assert.equal(c.deBrandSystem(''), '');
assert.equal(c.deBrandSystem(null), null);
// High side (CL5): the real name shows, de-brand is a no-op.
c.setSystemBranding(true);
assert.equal(c.systemName(), 'CAIRO.AIC');
assert.equal(c.deBrandSystem('CAIRO.AIC · Surveillance'), 'CAIRO.AIC · Surveillance');
c.setSystemBranding(false); // restore the cover default
assert.equal(c.systemName(), 'AIC');
console.log('debrand-system OK');
