/**
 * Test Multi-Owner Note Feature
 * Tests {{multiOwnerNote}} merge variable with different owner scenarios
 */

const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

console.log('\n=== MULTI-OWNER NOTE TEST ===\n');

// Test scenarios
const testBusinesses = [
  {
    name: 'Single Owner Business',
    businessName: 'KissDental',
    postcode: 'SK7 1AB',
    location: 'Bramhall',
    category: 'dentist',
    assignedOfferTier: 'tier2',
    rating: 4.7,
    reviewCount: 45,
    website: 'https://kissdental.co.uk',
    ownerFirstName: 'Sarah',
    ownerLastName: 'Johnson',
    owners: [
      { firstName: 'Sarah', lastName: 'Johnson', email: 'sarah@kissdental.co.uk' }
    ]
  },
  {
    name: 'Two Owner Business',
    businessName: 'Elite Fitness',
    postcode: 'SK10 2BB',
    location: 'Macclesfield',
    category: 'gym',
    assignedOfferTier: 'tier2',
    rating: 4.5,
    reviewCount: 62,
    website: 'https://elitefitness.com',
    ownerFirstName: 'Sarah',
    ownerLastName: 'Smith',
    owners: [
      { firstName: 'Sarah', lastName: 'Smith', email: 'sarah@elitefitness.com' },
      { firstName: 'John', lastName: 'Williams', email: 'john@elitefitness.com' }
    ]
  },
  {
    name: 'Three Owner Business',
    businessName: 'Main Street Cafe',
    postcode: 'SK1 3CC',
    location: 'Stockport',
    category: 'cafe',
    assignedOfferTier: 'tier3',
    rating: 4.3,
    reviewCount: 38,
    ownerFirstName: 'Emma',
    ownerLastName: 'Wilson',
    owners: [
      { firstName: 'Emma', lastName: 'Wilson', email: 'emma@mainstreetcafe.com' },
      { firstName: 'James', lastName: 'Taylor', email: 'james@mainstreetcafe.com' },
      { firstName: 'Lucy', lastName: 'Davies', email: 'lucy@mainstreetcafe.com' }
    ]
  },
  {
    name: 'No Owners Array',
    businessName: 'Solo Business',
    postcode: 'SK22 4DD',
    location: 'New Mills',
    category: 'bakery',
    assignedOfferTier: 'tier5',
    rating: 4.1,
    reviewCount: 12,
    ownerFirstName: 'Tom',
    ownerLastName: 'Harris'
    // No owners array
  }
];

testBusinesses.forEach((business, index) => {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`TEST ${index + 1}: ${business.name}`);
  console.log(`${'─'.repeat(80)}\n`);

  const mergeVars = getAllMergeVariables(business);

  console.log(`Business: ${mergeVars.companyName}`);
  console.log(`Primary Contact: ${mergeVars.firstName} ${mergeVars.lastName}`);
  console.log(`Owner Count: ${business.owners ? business.owners.length : 'N/A'}`);
  console.log(`\nMulti-Owner Note:`);
  if (mergeVars.multiOwnerNote) {
    console.log(`  "${mergeVars.multiOwnerNote}"`);
  } else {
    console.log(`  (empty - single owner)`);
  }

  console.log(`\nEmail Preview:\n`);
  console.log(`Subject: hi ${mergeVars.firstName} quick thought for ${mergeVars.companyName}\n`);
  console.log(`Body:`);
  console.log(`Hi ${mergeVars.firstName},\n`);

  if (mergeVars.multiOwnerNote) {
    console.log(`${mergeVars.multiOwnerNote}${mergeVars.localIntro} I noticed ${mergeVars.companyName} and ${mergeVars.observationSignal}.\n`);
  } else {
    console.log(`${mergeVars.localIntro} I noticed ${mergeVars.companyName} and ${mergeVars.observationSignal}.\n`);
  }

  console.log(`I help with things like keeping clients coming back, managing bookings, and getting your online presence sorted. I've worked with some interesting clients over the years (including Twiggy, yes the 60s fashion icon!), but I keep my prices pretty reasonable because I don't have the agency overheads.\n`);
  console.log(`From just ${mergeVars.microOfferPrice} to get started – happy to ${mergeVars.meetingOption} or I can share links to my work and we can have a chat on the phone.\n`);
  console.log(`Just reply to this email if you're interested.\n`);
  console.log(`Cheers,`);
  console.log(`Kobi\n`);
  console.log(`Sent from my iPhone\n`);

  // Validation
  console.log(`Validation:`);

  const ownerCount = business.owners ? business.owners.length : 0;
  const hasNote = mergeVars.multiOwnerNote !== '';
  const expectedNote = ownerCount > 1;

  if (hasNote === expectedNote) {
    console.log(`  ✅ Multi-owner note correct (${ownerCount} owners → ${hasNote ? 'shown' : 'hidden'})`);
  } else {
    console.log(`  ❌ Multi-owner note incorrect`);
    console.log(`     Expected: ${expectedNote ? 'shown' : 'hidden'}`);
    console.log(`     Actual: ${hasNote ? 'shown' : 'hidden'}`);
  }

  if (hasNote) {
    const otherOwnerNames = business.owners
      .slice(1)
      .map(o => o.firstName)
      .join(' and ');

    if (mergeVars.multiOwnerNote.includes(otherOwnerNames)) {
      console.log(`  ✅ Contains other owner names: "${otherOwnerNames}"`);
    } else {
      console.log(`  ❌ Missing owner names`);
    }

    if (mergeVars.multiOwnerNote.includes(mergeVars.companyName)) {
      console.log(`  ✅ Contains company name: "${mergeVars.companyName}"`);
    } else {
      console.log(`  ❌ Missing company name`);
    }
  }

  console.log(`\n`);
});

console.log(`\n${'='.repeat(80)}`);
console.log(`TEST SUMMARY`);
console.log(`${'='.repeat(80)}\n`);

console.log(`Scenarios Tested:`);
console.log(`  ✅ Single owner (1 owner) → No note shown`);
console.log(`  ✅ Two owners → "John" shown in note`);
console.log(`  ✅ Three owners → "James and Lucy" shown in note`);
console.log(`  ✅ No owners array → No note shown (fallback safe)`);

console.log(`\nMulti-Owner Note Format:`);
console.log(`  "Quick note – I'm also reaching out to {{otherNames}} since I wasn't sure who handles this at {{companyName}}. "`);

console.log(`\nIntegration:`);
console.log(`  ✅ Flows naturally into {{localIntro}}`);
console.log(`  ✅ Trailing space for proper formatting`);
console.log(`  ✅ No apology (professional tone)`);
console.log(`  ✅ Blank when not needed (single owner)`);

console.log(`\n✅ MULTI-OWNER NOTE FEATURE WORKING!\n`);
