/**
 * Test Name Extraction from Arundel Dental Practice
 */

const { scrapeWebsite } = require('../shared/outreach-core/enrichment/website-scraper');

async function testNameExtraction() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         TEST: Name Extraction from Team Pages                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const testUrl = 'https://www.arundeldentalpractice.co.uk';

  console.log(`🔍 Scraping: ${testUrl}`);
  console.log(`   Looking for: Christopher Needham BDS\n`);

  try {
    const result = await scrapeWebsite(testUrl);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📋 Owner Names Found: ${result.ownerNames.length}`);
    if (result.ownerNames.length > 0) {
      result.ownerNames.forEach((owner, idx) => {
        console.log(`   ${idx + 1}. ${owner.name}${owner.title ? ` (${owner.title})` : ''}`);
      });
    } else {
      console.log('   ⚠️  No owner names found');
    }

    console.log(`\n📝 Registration Number: ${result.registrationNumber || 'Not found'}`);
    console.log(`📍 Registered Address: ${result.registeredAddress ? result.registeredAddress.substring(0, 50) + '...' : 'Not found'}\n`);

    if (result.ownerNames.length > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ NAME EXTRACTION WORKING ✅                         ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ⚠️  NO NAMES EXTRACTED ⚠️                             ║');
      console.log('║  The website may use different patterns. Check logs above.        ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    }

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

testNameExtraction();
