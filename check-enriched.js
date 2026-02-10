const { loadBusinesses } = require('./ksd/local-outreach/orchestrator/modules/database');

console.log('\n=== ENRICHED BUSINESS ANALYSIS ===\n');

const enriched = loadBusinesses({ status: 'enriched', location: 'Bramhall' });

console.log('Total enriched:', enriched.length);

// Check how many have owner names vs fallback names
const withOwnerEmail = enriched.filter(r => r.business.ownerEmail);
const withFallbackName = enriched.filter(r => r.business.usedFallbackName === true);
const withRealOwner = enriched.filter(r => r.business.ownerFirstName && !r.business.usedFallbackName);

console.log('\nBreakdown:');
console.log('  - With owner email:', withOwnerEmail.length);
console.log('  - With fallback name:', withFallbackName.length);
console.log('  - With real owner name:', withRealOwner.length);

console.log('\n--- First 5 Enriched Businesses ---');
enriched.slice(0, 5).forEach((r, i) => {
  const b = r.business;
  console.log(`  ${i+1}. ${b.name}`);
  console.log(`     Owner: ${b.ownerFirstName || 'NONE'} ${b.ownerLastName || ''}`);
  console.log(`     Owner Email: ${b.ownerEmail || 'NONE'}`);
  console.log(`     Business Email: ${b.email || 'NONE'}`);
  console.log(`     Email Source: ${b.emailSource || 'UNKNOWN'}`);
  console.log(`     Used Fallback: ${b.usedFallbackName ? 'YES' : 'NO'}`);
  console.log('');
});

console.log('\n--- Businesses WITHOUT Owner Email (should use business email) ---');
const withoutOwnerEmail = enriched.filter(r => !r.business.ownerEmail && r.business.email);
console.log('Count:', withoutOwnerEmail.length);
withoutOwnerEmail.slice(0, 5).forEach((r, i) => {
  const b = r.business;
  console.log(`  ${i+1}. ${b.name}`);
  console.log(`     Owner: ${b.ownerFirstName || 'NONE'}`);
  console.log(`     Business Email: ${b.email} (should be used!)`);
  console.log(`     Used Fallback: ${b.usedFallbackName ? 'YES' : 'NO'}`);
  console.log('');
});

console.log('\n');
