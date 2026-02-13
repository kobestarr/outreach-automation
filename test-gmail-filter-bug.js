/**
 * Test Gmail Filter Bug
 * Demonstrates that extractEmailsFromWebsite filters out Gmail addresses
 */

const { extractEmailsFromWebsite } = require('./shared/outreach-core/email-discovery/website-email-extractor');
const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');

console.log('\n╔════════════════════════════════════════════════════════════════════╗');
console.log('║              GMAIL FILTER BUG DEMONSTRATION                        ║');
console.log('╚════════════════════════════════════════════════════════════════════╝\n');

const url = 'https://bramhallsmileclinic.co.uk';

(async () => {
  console.log(`Testing: ${url}\n`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Method 1: scrapeWebsite (finds emails)
  console.log('METHOD 1: scrapeWebsite()');
  const scrapeResult = await scrapeWebsite(url);
  console.log(`  Emails found: ${scrapeResult.emails.length}`);
  if (scrapeResult.emails.length > 0) {
    console.log(`  ✅ ${scrapeResult.emails.join(', ')}`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Method 2: extractEmailsFromWebsite (filters Gmail)
  console.log('METHOD 2: extractEmailsFromWebsite()');
  const extractResult = await extractEmailsFromWebsite(url);
  console.log(`  Emails found: ${extractResult.length}`);
  if (extractResult.length > 0) {
    console.log(`  ✅ ${extractResult.join(', ')}`);
  } else {
    console.log(`  ❌ NO EMAILS (filtered out Gmail addresses!)`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('CONCLUSION:\n');

  if (scrapeResult.emails.length > 0 && extractResult.length === 0) {
    console.log('🐛 BUG CONFIRMED!');
    console.log('   scrapeWebsite() finds the email, but extractEmailsFromWebsite() rejects it');
    console.log('   Reason: Gmail addresses are filtered as "not business-specific"\n');
    console.log('❌ This is why the export skipped Bramhall Smile Clinic!\n');
  } else {
    console.log('✅ Both methods found emails\n');
  }
})();
