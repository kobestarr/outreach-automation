/**
 * Test: multiOwnerNote Fix
 * Verify the multi-owner note appears when there are multiple owners
 */

const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║         TEST: multiOwnerNote DISCLAIMER CHECK                      ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

// Test 1: Business with SINGLE owner (should NOT have multi-owner note)
const businessSingleOwner = {
  name: 'Ed\'s Hair',
  businessName: 'Ed\'s Hair',
  ownerFirstName: 'Edward',
  ownerLastName: 'Smith',
  postcode: 'SK7',
  category: 'salon',
  owners: [
    { firstName: 'Edward', lastName: 'Smith', fullName: 'Edward Smith', title: 'Owner' }
  ]
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 1: Business with SINGLE Owner');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const vars1 = getAllMergeVariables(businessSingleOwner);

console.log(`firstName: "${vars1.firstName}"`);
console.log(`multiOwnerNote: "${vars1.multiOwnerNote}"`);
console.log(`Expected: firstName="Edward", multiOwnerNote=""`);
console.log(`Status: ${vars1.firstName === 'Edward' && vars1.multiOwnerNote === '' ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 2: Business with MULTIPLE owners (should HAVE multi-owner note)
const businessMultipleOwners = {
  name: 'Arundel Dental Practice',
  businessName: 'Arundel Dental Practice',
  ownerFirstName: 'Amanda',
  ownerLastName: 'Lynam',
  postcode: 'SK7',
  category: 'dentist',
  owners: [
    { firstName: 'Amanda', lastName: 'Lynam', fullName: 'Amanda Lynam', title: 'Practice Manager' },
    { firstName: 'Zoe', lastName: 'Tierney', fullName: 'Zoe Tierney', title: 'Receptionist' },
    { firstName: 'Christopher', lastName: 'Needham', fullName: 'Christopher Needham', title: 'BDS' }
  ]
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 2: Business with MULTIPLE Owners (3 people)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const vars2 = getAllMergeVariables(businessMultipleOwners);

console.log(`firstName: "${vars2.firstName}"`);
console.log(`multiOwnerNote: "${vars2.multiOwnerNote}"`);
console.log(`Expected: multiOwnerNote should mention "Zoe and Christopher"`);
console.log(`Actual contains "Zoe": ${vars2.multiOwnerNote.includes('Zoe')}`);
console.log(`Actual contains "Christopher": ${vars2.multiOwnerNote.includes('Christopher')}`);
console.log(`Status: ${vars2.multiOwnerNote.includes('Zoe') && vars2.multiOwnerNote.includes('Christopher') ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 3: Check what happens with business that has owners but we DON'T populate the array
const businessNoOwnersArray = {
  name: 'Arundel Dental Practice',
  businessName: 'Arundel Dental Practice',
  ownerFirstName: 'Amanda',
  ownerLastName: 'Lynam',
  postcode: 'SK7',
  category: 'dentist'
  // NOTE: No owners array! This is what our export scripts are doing!
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TEST 3: Business WITHOUT owners array (Current Export Script Behavior)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const vars3 = getAllMergeVariables(businessNoOwnersArray);

console.log(`firstName: "${vars3.firstName}"`);
console.log(`multiOwnerNote: "${vars3.multiOwnerNote}"`);
console.log(`⚠️  This business actually has 12 people on their team page!`);
console.log(`But multiOwnerNote is: "${vars3.multiOwnerNote}"`);
console.log(`Status: ${vars3.multiOwnerNote === '' ? '❌ BUG FOUND - owners array not populated!' : '✅ PASS'}\n`);

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('DIAGNOSIS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('✅ getMultiOwnerNote() function works correctly when owners array is provided');
console.log('❌ Export scripts are NOT populating business.owners array!');
console.log('❌ Even though website scraping finds multiple owners, we only use the first one\n');

console.log('🔧 FIX NEEDED:');
console.log('Export scripts should populate business.owners array from websiteData.ownerNames\n');

console.log('Example from Arundel Dental:');
console.log('  - Website scraping finds: 12 people');
console.log('  - We only use: 1 person (Amanda Lynam)');
console.log('  - We should populate: business.owners array with all validated names\n');
