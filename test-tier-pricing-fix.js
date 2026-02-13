/**
 * Verify Tier Pricing Fix
 * Tests that higher revenue = higher pricing
 */

const { assignTier } = require('./ksd/local-outreach/orchestrator/modules/tier-assigner');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║              TIER PRICING VERIFICATION TEST                        ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

const testBusinesses = [
  { name: 'Small Cafe', revenue: 80000, category: 'cafe', postcode: 'SK7' },
  { name: 'Medium Cafe', revenue: 180000, category: 'cafe', postcode: 'SK7' },
  { name: 'Large Salon', revenue: 280000, category: 'salon', postcode: 'SK7' },
  { name: 'Dental Practice', revenue: 450000, category: 'dentist', postcode: 'SK7' },
  { name: 'Large Dental Group', revenue: 850000, category: 'dentist', postcode: 'SK7' },
  { name: 'Corporate Chain', revenue: 2500000, category: 'dental', postcode: 'SK7' }
];

console.log('Testing pricing across revenue tiers:\n');
console.log('Revenue      | Tier   | Price  | Expectation');
console.log('─────────────┼────────┼────────┼─────────────────────────────');

const results = [];

for (const business of testBusinesses) {
  const tier = assignTier(business.revenue);
  business.assignedOfferTier = tier.tierId;
  business.businessName = business.name;

  const mergeVars = getAllMergeVariables(business);
  const price = mergeVars.microOfferPrice;

  results.push({
    name: business.name,
    revenue: business.revenue,
    tier: tier.tierId,
    price: price
  });

  console.log(`${business.revenue.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 }).padEnd(12)} | ${tier.tierId.padEnd(6)} | ${price.padEnd(6)} | ${business.name}`);
}

console.log('─────────────┴────────┴────────┴─────────────────────────────\n');

// Verify pricing increases with revenue
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('VERIFICATION RESULTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let allCorrect = true;

// Extract numeric price from string (e.g., "£291" -> 291)
const parsePrice = (priceStr) => parseInt(priceStr.replace(/[£$,]/g, ''));

for (let i = 1; i < results.length; i++) {
  const prev = results[i - 1];
  const curr = results[i];

  const prevPrice = parsePrice(prev.price);
  const currPrice = parsePrice(curr.price);

  const isCorrect = currPrice >= prevPrice;
  const status = isCorrect ? '✅' : '❌';

  console.log(`${status} ${prev.name} (${prev.price}) ${isCorrect ? '≤' : '>'} ${curr.name} (${curr.price})`);

  if (!isCorrect) {
    allCorrect = false;
    console.log(`   ⚠️  ERROR: Higher revenue should have higher or equal price!`);
  }
}

console.log();

if (allCorrect) {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              ✅ ALL PRICING CHECKS PASSED! ✅                      ║');
  console.log('║                                                                    ║');
  console.log('║  Pricing now correctly scales with revenue                        ║');
  console.log('║  Higher revenue businesses = Higher prices                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
} else {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              ❌ PRICING ERRORS DETECTED ❌                         ║');
  console.log('║                                                                    ║');
  console.log('║  Some businesses have inverted pricing!                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  process.exit(1);
}

// Specific test cases from user's question
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('USER QUESTION: Dentist vs Cafe Pricing');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const cafe180k = results.find(r => r.revenue === 180000);
const dentist450k = results.find(r => r.revenue === 450000);

console.log(`Cafe (£180K revenue):     ${cafe180k.tier} → ${cafe180k.price}`);
console.log(`Dentist (£450K revenue):  ${dentist450k.tier} → ${dentist450k.price}\n`);

const cafePrice = parsePrice(cafe180k.price);
const dentistPrice = parsePrice(dentist450k.price);

if (dentistPrice > cafePrice) {
  console.log(`✅ CORRECT: Dentist (${dentist450k.price}) > Cafe (${cafe180k.price})`);
  console.log(`   Higher revenue business is charged more!\n`);
} else {
  console.log(`❌ ERROR: Dentist (${dentist450k.price}) should be > Cafe (${cafe180k.price})`);
  console.log(`   This violates the pricing logic!\n`);
  process.exit(1);
}
