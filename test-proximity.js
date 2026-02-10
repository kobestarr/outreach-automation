/**
 * Test Proximity Detection with New Postcodes
 * Tests SK10 (Macclesfield), SK17 (Buxton), SK22 (New Mills), SK23 (Whaley Bridge)
 */

const { getAllMergeVariables, isNearby } = require('./shared/outreach-core/content-generation/email-merge-variables');

console.log('\n=== PROXIMITY DETECTION TEST ===\n');

// Test businesses with new postcodes
const testBusinesses = [
  {
    name: 'Macclesfield Dental Practice',
    businessName: 'Macclesfield Dental',
    postcode: 'SK10 1AA',
    location: 'Macclesfield',
    category: 'dentist',
    assignedOfferTier: 'tier2',
    rating: 4.5,
    reviewCount: 35,
    website: 'https://macclesfielddental.co.uk'
  },
  {
    name: 'Buxton Fitness Studio',
    businessName: 'Buxton Fitness',
    postcode: 'SK17 6DH',
    location: 'Buxton',
    category: 'gym',
    assignedOfferTier: 'tier3',
    rating: 4.2,
    reviewCount: 18,
    website: 'https://buxtonfitness.com'
  },
  {
    name: 'New Mills Coffee Shop',
    businessName: 'New Mills Coffee',
    postcode: 'SK22 4AA',
    location: 'New Mills',
    category: 'cafe',
    assignedOfferTier: 'tier4',
    rating: 4.7,
    reviewCount: 62,
    website: 'https://newmillscoffee.co.uk'
  },
  {
    name: 'Whaley Bridge Pharmacy',
    businessName: 'Whaley Bridge Pharmacy',
    postcode: 'SK23 7AA',
    location: 'Whaley Bridge',
    category: 'pharmacy',
    assignedOfferTier: 'tier5',
    rating: 4.3,
    reviewCount: 8
  },
  {
    name: 'London Restaurant',
    businessName: 'London Restaurant',
    postcode: 'SW1A 1AA',
    location: 'London',
    category: 'restaurant',
    assignedOfferTier: 'tier1',
    rating: 4.8,
    reviewCount: 120,
    website: 'https://londonrestaurant.com'
  }
];

testBusinesses.forEach((business, index) => {
  console.log(`\n--- Test ${index + 1}: ${business.name} (${business.postcode}) ---`);

  // Test proximity detection
  const nearby = isNearby(business.postcode);
  console.log(`Proximity: ${nearby ? '✅ NEARBY' : '❌ FAR AWAY'}`);

  // Generate merge variables
  const mergeVars = getAllMergeVariables(business);

  console.log('\nMerge Variables:');
  console.log(`  localIntro: "${mergeVars.localIntro}"`);
  console.log(`  observationSignal: "${mergeVars.observationSignal}"`);
  console.log(`  meetingOption: "${mergeVars.meetingOption}"`);
  console.log(`  microOfferPrice: "${mergeVars.microOfferPrice}"`);

  console.log('\nEmail Preview:');
  console.log(`  Hi ${mergeVars.firstName},`);
  console.log(`  `);
  console.log(`  ${mergeVars.localIntro} I noticed ${mergeVars.companyName} and ${mergeVars.observationSignal}.`);
  console.log(`  `);
  console.log(`  ...`);
  console.log(`  `);
  console.log(`  From just ${mergeVars.microOfferPrice} to get started – happy to ${mergeVars.meetingOption}...`);

  // Validation
  const expectedNearby = ['SK10', 'SK17', 'SK22', 'SK23'].some(pc => business.postcode.startsWith(pc));
  const actualNearby = nearby;

  if (expectedNearby === actualNearby) {
    console.log('\n✅ PASS - Proximity detection correct');
  } else {
    console.log('\n❌ FAIL - Proximity detection incorrect');
    console.log(`  Expected: ${expectedNearby ? 'nearby' : 'far'}`);
    console.log(`  Actual: ${actualNearby ? 'nearby' : 'far'}`);
  }

  // Check intro text matches proximity
  const hasLocalIntro = mergeVars.localIntro.includes('based in Poynton');
  const hasUKIntro = mergeVars.localIntro.includes('across the UK');

  if (nearby && hasLocalIntro) {
    console.log('✅ PASS - Local intro correct');
  } else if (!nearby && hasUKIntro) {
    console.log('✅ PASS - UK-wide intro correct');
  } else {
    console.log('❌ FAIL - Intro text incorrect');
  }

  // Check meeting option matches proximity
  const hasInPerson = mergeVars.meetingOption.includes('meet in person');
  const hasChat = mergeVars.meetingOption.includes('have a chat') && !hasInPerson;

  if (nearby && hasInPerson) {
    console.log('✅ PASS - Meeting option correct (in-person)');
  } else if (!nearby && hasChat) {
    console.log('✅ PASS - Meeting option correct (phone chat)');
  } else {
    console.log('❌ FAIL - Meeting option incorrect');
  }

  console.log('\n' + '─'.repeat(70));
});

console.log('\n\n=== TEST SUMMARY ===\n');
console.log('New Postcodes Coverage:');
console.log('  ✅ SK10 (Macclesfield) - Tested');
console.log('  ✅ SK17 (Buxton) - Tested');
console.log('  ✅ SK22 (New Mills) - Tested');
console.log('  ✅ SK23 (Whaley Bridge) - Tested');
console.log('  ✅ SW1A (London) - Tested as control (far away)');
console.log('\nAll new postcodes should show:');
console.log('  - "based in Poynton, so pretty close to you!"');
console.log('  - "meet in person if that\'s easier"');
console.log('\nLondon (SW1A) should show:');
console.log('  - "working with local businesses across the UK"');
console.log('  - "have a chat"');
console.log('\n');
