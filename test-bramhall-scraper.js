/**
 * Test Website Scraper on Bramhall Smile Clinic
 * Investigate why email and names weren't extracted
 */

const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║       BRAMHALL SMILE CLINIC - WEBSITE SCRAPER TEST                ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

const url = 'https://bramhallsmileclinic.co.uk';

console.log(`Testing website: ${url}\n`);
console.log('Expected to find:');
console.log('  ✓ Email: bramhallsmiles@gmail.com');
console.log('  ✓ Team member names from /our-team/ page\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

(async () => {
  try {
    const result = await scrapeWebsite(url);

    console.log('SCRAPING RESULTS:\n');
    console.log(`Emails found: ${result.emails.length}`);
    if (result.emails.length > 0) {
      console.log('  Emails:', result.emails);
    } else {
      console.log('  ❌ NO EMAILS FOUND');
    }

    console.log(`\nOwner names found: ${result.ownerNames.length}`);
    if (result.ownerNames.length > 0) {
      result.ownerNames.forEach((owner, i) => {
        console.log(`  ${i + 1}. ${owner.name} ${owner.title ? `(${owner.title})` : ''} ${owner.hasEmailMatch ? '✓ email match' : ''}`);
        if (owner.matchedEmail) {
          console.log(`     → ${owner.matchedEmail}`);
        }
      });
    } else {
      console.log('  ❌ NO NAMES FOUND');
    }

    if (result.error) {
      console.log(`\n⚠️  Error occurred: ${result.error}`);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ANALYSIS:\n');

    const foundExpectedEmail = result.emails.includes('bramhallsmiles@gmail.com');
    if (foundExpectedEmail) {
      console.log('✅ Found expected email: bramhallsmiles@gmail.com');
    } else {
      console.log('❌ MISSING expected email: bramhallsmiles@gmail.com');
      console.log('   This email should be visible on the contact page and home page');
    }

    if (result.ownerNames.length > 0) {
      console.log(`✅ Found ${result.ownerNames.length} team member name(s)`);
    } else {
      console.log('❌ NO team member names found');
      console.log('   The /our-team/ page should have multiple names');
    }

    console.log('\n');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error.stack);
  }
})();
