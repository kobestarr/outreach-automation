/**
 * Test: noNameNote Fix
 * Verify the disclaimer appears when there's no valid name
 */

const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║           TEST: noNameNote DISCLAIMER FIX                          ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

// Test 1: Business WITH a valid name (should NOT have disclaimer)
const businessWithName = {
  name: 'Arundel Dental',
  businessName: 'Arundel Dental Practice',
  ownerFirstName: 'Amanda',
  ownerLastName: 'Lynam',
  postcode: 'SK7',
  category: 'dentist',
  usedFallbackName: false  // Has real name
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 1: Business WITH Valid Name');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const vars1 = getAllMergeVariables(businessWithName);

console.log(`firstName: "${vars1.firstName}"`);
console.log(`noNameNote: "${vars1.noNameNote}"`);
console.log(`Expected: firstName="Amanda", noNameNote=""`);
console.log(`Status: ${vars1.firstName === 'Amanda' && vars1.noNameNote === '' ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 2: Business WITHOUT a valid name (should HAVE disclaimer)
const businessWithoutName = {
  name: 'The Beauty Sanctuary',
  businessName: 'The Beauty Sanctuary',
  ownerFirstName: undefined,  // No valid name
  ownerLastName: undefined,
  postcode: 'SK7',
  category: 'salon',
  usedFallbackName: true  // ✅ THIS IS THE FIX - setting this flag
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 2: Business WITHOUT Valid Name (Using Fallback)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const vars2 = getAllMergeVariables(businessWithoutName);

console.log(`firstName: "${vars2.firstName}"`);
console.log(`noNameNote: "${vars2.noNameNote}"`);
console.log(`Expected: firstName="there", noNameNote="I couldn't find your names anywhere! "`);
console.log(`Status: ${vars2.firstName === 'there' && vars2.noNameNote === "I couldn't find your names anywhere! " ? '✅ PASS' : '❌ FAIL'}\n`);

// Show email preview
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('EMAIL PREVIEW (Business WITHOUT Name)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`Hi ${vars2.firstName},\n`);
console.log(`${vars2.noNameNote}${vars2.localIntro}\n`);
console.log(`I ${vars2.observationSignal} at ${vars2.companyName} and thought I'd reach out.\n`);

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const allPassed =
  vars1.firstName === 'Amanda' &&
  vars1.noNameNote === '' &&
  vars2.firstName === 'there' &&
  vars2.noNameNote === "I couldn't find your names anywhere! ";

if (allPassed) {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              ✅ ALL TESTS PASSED! ✅                               ║');
  console.log('║                                                                    ║');
  console.log('║  The noNameNote disclaimer now appears correctly!                 ║');
  console.log('║  Lemlist will show the honest "I couldn\'t find your names" message║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
} else {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              ❌ SOME TESTS FAILED ❌                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
}
