/**
 * Test Edge Cases for Website Scraper
 * Investigate why certain websites aren't being scraped correctly
 */

const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

const testCases = [
  { name: 'Godfrey Holland', url: 'https://www.godfreyholland.co.uk/about-us/', expected: 'Should find names' },
  { name: 'IN Accountancy', url: 'https://www.in-accountancy.co.uk/resources/news/in-team/', expected: 'Should find team names' },
  { name: 'Sapphire', url: 'https://wearesapphire.co.uk/team/', expected: 'Should find team names' },
  { name: 'Bevan', url: 'https://www.bevan.co.uk/about', expected: 'Should find names' },
  { name: 'Kloud Tax', url: 'https://www.kloudtaxaccountants.co.uk/', expected: 'Should find enquiries@kloudtaxaccountants.co.uk' },
  { name: 'PFP Limited', url: 'https://www.pfp-limited.co.uk/about', expected: 'Should find names' },
  { name: 'The Accountancy People', url: 'https://theaccountancypeople.co.uk/#ourteam', expected: 'LOTS of people' },
  { name: 'MJB Accounting', url: 'https://www.mjbaccountingsolutions.co.uk/about', expected: 'Owner name' },
  { name: 'Arundel Dental', url: 'https://www.arundeldentalpractice.co.uk/', expected: 'Check duplicate email issue' }
];

async function testEdgeCases() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              EDGE CASE INVESTIGATION                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  for (const testCase of testCases) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Testing: ${testCase.name}`);
    console.log(`URL: ${testCase.url}`);
    console.log(`Expected: ${testCase.expected}\n`);

    try {
      const result = await scrapeWebsite(testCase.url);

      console.log(`Emails found: ${result.emails.length}`);
      if (result.emails.length > 0) {
        result.emails.forEach((email, i) => {
          console.log(`  ${i + 1}. ${email}`);
        });
      } else {
        console.log(`  ❌ NO EMAILS FOUND`);
      }

      console.log(`\nNames found: ${result.ownerNames.length}`);
      if (result.ownerNames.length > 0) {
        result.ownerNames.forEach((owner, i) => {
          console.log(`  ${i + 1}. ${owner.name} ${owner.title ? `(${owner.title})` : ''} ${owner.hasEmailMatch ? '✓ email match' : ''}`);
          if (owner.matchedEmail) {
            console.log(`     → ${owner.matchedEmail}`);
          }
        });
      } else {
        console.log(`  ❌ NO NAMES FOUND`);
      }

      console.log();
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
  }
}

testEdgeCases().catch(console.error);
