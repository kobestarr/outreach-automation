const { loadBusinesses } = require('./ksd/local-outreach/orchestrator/modules/database');

console.log('\n=== OUTSCRAPER DATA CHECK ===\n');

const discovered = loadBusinesses({ status: 'discovered', location: 'Bramhall' });

console.log('Discovered businesses:', discovered.length);

const withEmail = discovered.filter(r => r.business.email);
const withoutEmail = discovered.filter(r => !r.business.email);

console.log('With email:', withEmail.length);
console.log('Without email:', withoutEmail.length);

console.log('\n--- Businesses WITH emails from Outscraper ---');
withEmail.slice(0, 10).forEach((r, i) => {
  const b = r.business;
  console.log(`  ${i+1}. ${b.name}`);
  console.log(`     Email: ${b.email}`);
  console.log(`     Phone: ${b.phone || 'NONE'}`);
  console.log(`     Website: ${b.website || 'NONE'}`);
  console.log('');
});

if (withEmail.length === 0) {
  console.log('  (none found)');
}

console.log('\n--- Businesses WITHOUT emails from Outscraper (sample) ---');
withoutEmail.slice(0, 10).forEach((r, i) => {
  const b = r.business;
  console.log(`  ${i+1}. ${b.name}`);
  console.log(`     Email: ${b.email || 'NONE'}`);
  console.log(`     Phone: ${b.phone || 'NONE'}`);
  console.log(`     Website: ${b.website || 'NONE'}`);
  console.log('');
});

console.log('\n');
