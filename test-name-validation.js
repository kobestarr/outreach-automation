/**
 * Test Name Validation Fix
 * Verifies that bad names from the screenshot are now rejected
 */

const { parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const { isValidPersonName } = require('./shared/outreach-core/validation/data-quality');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║              NAME VALIDATION FIX TEST                              ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

// These are the BAD names from the screenshot that should be REJECTED
const badNamesFromScreenshot = [
  'Allen Case',
  'Begum Client',
  'Chartered Certified',
  'Chartered Management',
  'Coombs Cosmetic',
  'Employment Law',
  'Haque Cosmetic',
  'Hotchkiss Management',
  'Independent Bank'
];

// These are GOOD names that should be ACCEPTED
const goodNames = [
  'Anna Wickham',
  'Callum Coombs',
  'James Sheard',
  'Kailesh Solanki',
  'Sarah Johnson',
  'Michael Clark',
  'Christopher Needham'
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TESTING BAD NAMES (Should be REJECTED)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let badPassedCount = 0;
let badRejectedCount = 0;

badNamesFromScreenshot.forEach(name => {
  const { firstName, lastName } = parseName(name);
  const isValid = isValidPersonName(name);

  if (firstName && firstName.length > 0) {
    console.log(`❌ FAIL: "${name}" → firstName="${firstName}", lastName="${lastName}"`);
    console.log(`   This should have been REJECTED!\n`);
    badPassedCount++;
  } else {
    console.log(`✅ PASS: "${name}" → REJECTED (firstName="")`);
    console.log(`   Reason: ${!isValid ? 'Failed validation' : 'Unknown'}\n`);
    badRejectedCount++;
  }
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TESTING GOOD NAMES (Should be ACCEPTED)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

let goodPassedCount = 0;
let goodRejectedCount = 0;

goodNames.forEach(name => {
  const { firstName, lastName } = parseName(name);
  const isValid = isValidPersonName(name);

  if (firstName && firstName.length > 0) {
    console.log(`✅ PASS: "${name}" → firstName="${firstName}", lastName="${lastName}"`);
    console.log(`   Valid: ${isValid}\n`);
    goodPassedCount++;
  } else {
    console.log(`❌ FAIL: "${name}" → REJECTED (firstName="")`);
    console.log(`   This should have been ACCEPTED!\n`);
    goodRejectedCount++;
  }
});

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST RESULTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`Bad Names (should reject):`);
console.log(`  ✅ Correctly rejected: ${badRejectedCount}/${badNamesFromScreenshot.length}`);
console.log(`  ❌ Incorrectly accepted: ${badPassedCount}/${badNamesFromScreenshot.length}\n`);

console.log(`Good Names (should accept):`);
console.log(`  ✅ Correctly accepted: ${goodPassedCount}/${goodNames.length}`);
console.log(`  ❌ Incorrectly rejected: ${goodRejectedCount}/${goodNames.length}\n`);

const allTestsPassed = badRejectedCount === badNamesFromScreenshot.length &&
                       goodPassedCount === goodNames.length;

if (allTestsPassed) {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                   ✅ ALL TESTS PASSED! ✅                          ║');
  console.log('║                                                                    ║');
  console.log('║  Name validation is working correctly!                            ║');
  console.log('║  Bad names will now be rejected before export to Lemlist.         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  process.exit(0);
} else {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                   ❌ SOME TESTS FAILED ❌                          ║');
  console.log('║                                                                    ║');
  console.log('║  Check the output above to see which names failed.                ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  process.exit(1);
}
