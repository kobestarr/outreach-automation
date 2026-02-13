/**
 * Verify Gmail Filter Bug Fix
 * Tests that Bramhall Smile Clinic email is now extracted correctly
 */

const { scrapeWebsite, parseName } = require('./shared/outreach-core/enrichment/website-scraper');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║            GMAIL FILTER BUG FIX VERIFICATION                       ║');
console.log('║              Testing: Bramhall Smile Clinic                        ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

const testBusiness = {
  name: 'Bramhall Smile Clinic',
  website: 'https://bramhallsmileclinic.co.uk'
};

(async () => {
  try {
    console.log(`Business: ${testBusiness.name}`);
    console.log(`Website:  ${testBusiness.website}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // SIMULATING THE FIXED EXPORT SCRIPT LOGIC
    console.log('STEP 1: Scraping website for names AND emails...\n');

    const websiteData = await scrapeWebsite(testBusiness.website);

    // Extract owner names
    let ownerFound = false;
    if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
      const owner = websiteData.ownerNames[0];
      const { firstName, lastName } = parseName(owner.name);

      if (firstName) {
        testBusiness.ownerFirstName = firstName;
        testBusiness.ownerLastName = lastName;
        console.log(`✅ Owner: ${owner.name} (${owner.title || 'N/A'})`);
        console.log(`   → First Name: ${firstName}`);
        console.log(`   → Last Name:  ${lastName}`);
        ownerFound = true;
      } else {
        console.log(`⚠️  Name rejected: "${owner.name}"`);
      }

      if (websiteData.ownerNames.length > 1) {
        console.log(`👥 Found ${websiteData.ownerNames.length} total people on website`);
      }
    } else {
      console.log('❌ No owner names found');
    }

    console.log();

    // Extract email from scrapeWebsite results (THE FIX!)
    let email = null;
    if (websiteData.emails && websiteData.emails.length > 0) {
      email = websiteData.emails[0];
      console.log(`✅ Email: ${email}`);
    } else {
      console.log('❌ No email found');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('VERIFICATION RESULTS:\n');

    let allPassed = true;

    // Verify email was found
    if (email === 'bramhallsmiles@gmail.com') {
      console.log('✅ PASS: Email extracted correctly (bramhallsmiles@gmail.com)');
    } else {
      console.log(`❌ FAIL: Expected bramhallsmiles@gmail.com, got ${email || 'null'}`);
      allPassed = false;
    }

    // Verify at least one name was found
    if (ownerFound) {
      console.log(`✅ PASS: Owner name extracted (${testBusiness.ownerFirstName} ${testBusiness.ownerLastName})`);
    } else {
      console.log('❌ FAIL: No valid owner name extracted');
      allPassed = false;
    }

    // Verify multiple names were found
    if (websiteData.ownerNames && websiteData.ownerNames.length > 1) {
      console.log(`✅ PASS: Multiple team members found (${websiteData.ownerNames.length} people)`);
    } else {
      console.log('⚠️  WARNING: Only 1 or 0 team members found (expected multiple from /our-team page)');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (allPassed) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║                    ✅ ALL TESTS PASSED! ✅                         ║');
      console.log('║                                                                    ║');
      console.log('║  The Gmail filter bug is now FIXED!                               ║');
      console.log('║  Bramhall Smile Clinic would now be exported to Lemlist           ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║                    ❌ TESTS FAILED ❌                              ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
