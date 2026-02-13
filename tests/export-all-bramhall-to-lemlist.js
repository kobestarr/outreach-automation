/**
 * PRODUCTION EXPORT - All Bramhall Businesses to Lemlist
 * Ready for tomorrow's email campaign
 *
 * Expected: ~60% success rate (based on stress test)
 * Est. results: 40-60 businesses exported from ~100 scraped
 */

const { scrapeGoogleMapsOutscraper } = require('../ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { scrapeWebsite, parseName } = require('../shared/outreach-core/enrichment/website-scraper');
const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('../shared/outreach-core/export-managers/lemlist-exporter');
const logger = require('../shared/outreach-core/logger');

// Configuration
const LEMLIST_CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const LOCATION = 'Bramhall';
const POSTCODE = 'SK7';

// Business types to scrape
const BUSINESS_TYPES = [
  'dentists',
  'hair salons',
  'beauty salons',
  'restaurants',
  'cafes',
  'gyms',
  'yoga studios'
];

const STATS = {
  scraped: 0,
  withWebsite: 0,
  namesFound: 0,
  emailsFound: 0,
  exported: 0,
  duplicates: 0,
  errors: 0
};

async function exportAllBramhall() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║   PRODUCTION EXPORT - ALL BRAMHALL BUSINESSES TO LEMLIST           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  // Phase 1: Scrape all business types
  console.log('🗺️  Phase 1: Google Maps Scraping\n');

  let allBusinesses = [];

  for (const businessType of BUSINESS_TYPES) {
    console.log(`   Scraping ${businessType}...`);
    try {
      const businesses = await scrapeGoogleMapsOutscraper(LOCATION, POSTCODE, [businessType], true);
      console.log(`   ✅ Found ${businesses.length} ${businessType}`);
      allBusinesses = allBusinesses.concat(businesses);
      STATS.scraped += businesses.length;
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
      STATS.errors++;
    }
  }

  console.log(`\n📊 Total businesses scraped: ${STATS.scraped}\n`);

  // Phase 2: Process each business
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📧 Phase 2: Enrichment & Export to Lemlist\n');

  for (let i = 0; i < allBusinesses.length; i++) {
    const business = allBusinesses[i];

    if ((i + 1) % 10 === 0) {
      console.log(`\n   Progress: ${i + 1}/${allBusinesses.length} businesses processed\n`);
    }

    // Skip if no website
    if (!business.website) {
      continue;
    }

    STATS.withWebsite++;

    try {
      // Scrape website
      const websiteData = await scrapeWebsite(business.website);

      // Set owner data
      if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
        business.owners = websiteData.ownerNames.map(owner => {
          const { firstName, lastName } = parseName(owner.name);
          return {
            firstName: firstName,
            lastName: lastName,
            fullName: owner.name,
            title: owner.title,
            hasEmailMatch: owner.hasEmailMatch,
            matchedEmail: owner.matchedEmail
          };
        }).filter(owner => owner.firstName); // Remove invalid names that failed validation

        if (business.owners.length > 0) {
          const primaryOwner = business.owners[0];
          business.ownerFirstName = primaryOwner.firstName;
          business.ownerLastName = primaryOwner.lastName;
          STATS.namesFound++;
        }
      }

      // Check for emails
      if (!websiteData.emails || websiteData.emails.length === 0) {
        continue;
      }

      STATS.emailsFound++;

      // Generate merge variables
      const mergeVariables = getAllMergeVariables(business);

      // Export to Lemlist
      const leadData = {
        email: websiteData.emails[0],
        firstName: business.ownerFirstName || 'there',
        lastName: business.ownerLastName || '',
        companyName: business.businessName || business.name,
        ...mergeVariables
      };

      await addLeadToCampaign(LEMLIST_CAMPAIGN_ID, leadData);

      console.log(`   ✅ ${business.name || business.businessName}`);
      STATS.exported++;

    } catch (error) {
      if (error.message.includes('already in the campaign') || error.message.includes('400')) {
        STATS.duplicates++;
      } else {
        console.log(`   ⚠️  ${business.name}: ${error.message}`);
        STATS.errors++;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Final Report
  console.log('\n\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    EXPORT COMPLETE                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('📊 FINAL STATS:\n');
  console.log(`   Total Businesses Scraped:  ${STATS.scraped}`);
  console.log(`   With Website:              ${STATS.withWebsite} (${Math.round(STATS.withWebsite/STATS.scraped*100)}%)`);
  console.log(`   Names Found:               ${STATS.namesFound} (${Math.round(STATS.namesFound/STATS.withWebsite*100)}%)`);
  console.log(`   Emails Found:              ${STATS.emailsFound} (${Math.round(STATS.emailsFound/STATS.withWebsite*100)}%)`);
  console.log(`   Exported to Lemlist:       ${STATS.exported} ✅`);
  console.log(`   Duplicates (already in):   ${STATS.duplicates}`);
  console.log(`   Errors:                    ${STATS.errors}`);
  console.log(`   Time Taken:                ${elapsed} minutes\n`);

  const successRate = Math.round(STATS.exported / STATS.withWebsite * 100);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ SUCCESS RATE: ${successRate}%\n`);

  if (STATS.exported > 0) {
    console.log('✅ READY TO SEND EMAILS!');
    console.log(`   ${STATS.exported} new leads added to Lemlist campaign`);
    console.log(`   Campaign: https://app.lemlist.com/campaigns/${LEMLIST_CAMPAIGN_ID}`);
    console.log('\n   Next Steps:');
    console.log('   1. Review leads in Lemlist dashboard');
    console.log('   2. Check merge variables are populated correctly');
    console.log('   3. Start campaign when ready!');
  } else {
    console.log('⚠️  No new leads exported (all may be duplicates)');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

exportAllBramhall().catch(error => {
  console.error('\n❌ EXPORT FAILED:');
  console.error(`   Error: ${error.message}`);
  console.error(`   Stack: ${error.stack}\n`);
  process.exit(1);
});
