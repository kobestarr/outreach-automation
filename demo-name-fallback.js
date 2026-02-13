/**
 * Demo: Name Fallback System
 * Shows what happens when a business has an invalid name (job title instead of person)
 */

const { parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║              NAME FALLBACK SYSTEM DEMO                             ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

// Simulate a business with INVALID owner name (from the screenshot)
const testBusinessWithBadName = {
  name: 'SK7 Cosmetic Surgery',
  shortName: 'SK7 Cosmetic',
  businessType: 'cosmetic surgery clinic',
  town: 'Bramhall',
  postcode: 'SK7',
  website: 'https://sk7cosmetic.co.uk',
  ownerEmail: 'info@sk7cosmetic.co.uk',

  // This is the BAD NAME from Companies House API (job title, not a person)
  rawOwnerName: 'Chartered Management'
};

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SCENARIO: Business with Invalid Owner Name');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`Business: ${testBusinessWithBadName.name}`);
console.log(`Raw Owner Name from API: "${testBusinessWithBadName.rawOwnerName}"`);
console.log('\n');

// STEP 1: Try to parse the name
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STEP 1: Name Validation');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const { firstName, lastName } = parseName(testBusinessWithBadName.rawOwnerName);

if (firstName) {
  console.log(`✅ Name ACCEPTED: firstName="${firstName}", lastName="${lastName}"`);
  testBusinessWithBadName.ownerFirstName = firstName;
  testBusinessWithBadName.ownerLastName = lastName;
} else {
  console.log(`❌ Name REJECTED: "${testBusinessWithBadName.rawOwnerName}"`);
  console.log(`   Reason: Contains blacklisted words (likely job title or business type)`);
  console.log(`   firstName = "" (empty string)`);
  console.log(`   lastName = "" (empty string)`);
  console.log('\n   ⚠️  NO NAME ASSIGNED TO BUSINESS OBJECT\n');

  // Don't assign the invalid name
  testBusinessWithBadName.ownerFirstName = undefined;
  testBusinessWithBadName.ownerLastName = undefined;
}

// STEP 2: Generate merge variables (this is where fallback kicks in)
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STEP 2: Generate Email Merge Variables (Fallback Activates)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const mergeVariables = getAllMergeVariables(testBusinessWithBadName);

console.log('Merge Variables Generated:\n');
console.log(`  firstName: "${mergeVariables.firstName}"`);
console.log(`  lastName: "${mergeVariables.lastName}"`);
console.log(`  companyName: "${mergeVariables.companyName}"`);
console.log(`  noNameNote: "${mergeVariables.noNameNote}"\n`);

// STEP 3: Show the actual email output
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STEP 3: Email Output (What Gets Sent to Lemlist)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const emailGreeting = `Hi ${mergeVariables.firstName},`;
const emailBody = `
${mergeVariables.localIntro}

${mergeVariables.noNameNote}

${mergeVariables.observationSignal}

I specialise in helping ${testBusinessWithBadName.businessType}s in ${testBusinessWithBadName.town} get more local customers through better online visibility.

${mergeVariables.meetingOption}

Best regards,
Kobe Starr
`;

console.log('┌────────────────────────────────────────────────────────────────────┐');
console.log('│                        EMAIL PREVIEW                               │');
console.log('└────────────────────────────────────────────────────────────────────┘\n');
console.log(`To: ${testBusinessWithBadName.ownerEmail}`);
console.log(`Subject: Quick question about ${mergeVariables.companyName}\n`);
console.log(emailGreeting);
console.log(emailBody);

// STEP 4: Summary
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY: How Fallback System Works');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('✅ Invalid name detected and REJECTED by validation');
console.log('✅ Fallback system activated automatically');
console.log(`✅ firstName fallback: "${mergeVariables.firstName}" (using company name)`);
console.log(`✅ Honest disclaimer added: "${mergeVariables.noNameNote}"`);
console.log('✅ Email still sends (lead not skipped)');
console.log('✅ Transparent and honest approach\n');

console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║                   ✅ DEMO COMPLETE ✅                              ║');
console.log('║                                                                    ║');
console.log('║  The fallback system ensures professional, honest emails even     ║');
console.log('║  when owner names are not available or invalid.                   ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');
