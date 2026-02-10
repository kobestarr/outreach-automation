/**
 * Export 10 Businesses to Lemlist
 * Quick test export of 10 Bramhall SK7 businesses
 */

const { scrapeGoogleMapsOutscraper } = require('../ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { extractEmailsFromWebsite } = require('../shared/outreach-core/email-discovery/website-email-extractor');
const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('../shared/outreach-core/export-managers/lemlist-exporter');
const { scrapeWebsite } = require('../shared/outreach-core/enrichment/website-scraper');
const logger = require('../shared/outreach-core/logger');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const EXPORT_LIMIT = 10;

async function exportToLemlist() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║           EXPORT 10 BUSINESSES TO LEMLIST                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`📤 Campaign ID: ${CAMPAIGN_ID}`);
  console.log(`📊 Export Limit: ${EXPORT_LIMIT} businesses\n`);

  try {
    // Step 1: Scrape businesses
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 1: SCRAPING BUSINESSES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('🗺️  Scraping Bramhall SK7 salons...\n');

    const businesses = await scrapeGoogleMapsOutscraper(
      'Bramhall',
      'SK7',
      ['salons'], // Just salons for test
      true
    );

    console.log(`\n✅ Found ${businesses.length} salons`);
    console.log(`📋 Selecting first ${EXPORT_LIMIT} for export\n`);

    const businessesToExport = businesses.slice(0, EXPORT_LIMIT);

    // Step 2: Enrich with emails and merge variables
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 2: ENRICHING BUSINESSES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const enrichedBusinesses = [];

    for (let i = 0; i < businessesToExport.length; i++) {
      const business = businessesToExport[i];
      console.log(`[${i + 1}/${businessesToExport.length}] ${business.name}`);

      // Scrape website for owner names
      if (business.website) {
        try {
          const websiteData = await scrapeWebsite(business.website);
          if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
            const owner = websiteData.ownerNames[0];
            const nameParts = owner.name.split(' ');
            business.ownerFirstName = nameParts[0];
            business.ownerLastName = nameParts.slice(1).join(' ');
            console.log(`   ✅ Owner found: ${owner.name}${owner.title ? ` (${owner.title})` : ''}`);
          }
        } catch (error) {
          console.log(`   ⚠️  Website scraping failed: ${error.message}`);
        }
      }

      // Extract email if website available
      let email = null;
      if (business.website) {
        try {
          const emails = await extractEmailsFromWebsite(business.website);
          if (emails.length > 0) {
            email = emails[0];
            console.log(`   ✅ Email found: ${logger.sanitizeData(email)}`);
          } else {
            console.log(`   ⚠️  No email found on website`);
          }
        } catch (error) {
          console.log(`   ⚠️  Email extraction failed: ${error.message}`);
        }
      } else {
        console.log(`   ℹ️  No website available`);
      }

      // Generate merge variables
      const mergeVariables = getAllMergeVariables(business);

      enrichedBusinesses.push({
        ...business,
        email: email,
        mergeVariables: mergeVariables
      });
    }

    console.log(`\n✅ Enriched ${enrichedBusinesses.length} businesses\n`);

    // Step 3: Export to Lemlist
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3: EXPORTING TO LEMLIST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let exportedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const business of enrichedBusinesses) {
      // Skip if no email
      if (!business.email) {
        console.log(`⏭️  Skipping ${business.name} (no email)`);
        skippedCount++;
        continue;
      }

      const leadData = {
        email: business.email,
        firstName: business.mergeVariables.firstName,
        lastName: business.mergeVariables.lastName,
        companyName: business.mergeVariables.companyName,
        location: business.mergeVariables.location,
        businessType: business.mergeVariables.businessType,
        localIntro: business.mergeVariables.localIntro,
        observationSignal: business.mergeVariables.observationSignal,
        meetingOption: business.mergeVariables.meetingOption,
        microOfferPrice: business.mergeVariables.microOfferPrice,
        multiOwnerNote: business.mergeVariables.multiOwnerNote,
        noNameNote: business.mergeVariables.noNameNote,
        companyDomain: business.website,
        phone: business.phone
      };

      try {
        await addLeadToCampaign(CAMPAIGN_ID, leadData);
        console.log(`✅ Exported: ${business.name}`);
        console.log(`   Email: ${logger.sanitizeData(leadData.email)}`);
        console.log(`   Price: ${leadData.microOfferPrice}`);
        console.log(`   Name: ${leadData.firstName}\n`);
        exportedCount++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        if (error.message.includes('DUPLICATE_LEAD')) {
          console.log(`⏭️  Skipping ${business.name} (already in campaign)\n`);
          skippedCount++;
        } else {
          console.log(`❌ Failed to export ${business.name}: ${error.message}\n`);
          errorCount++;
        }
      }
    }

    // Final Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('EXPORT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Successfully exported: ${exportedCount}`);
    console.log(`⏭️  Skipped (no email/duplicate): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Total processed: ${enrichedBusinesses.length}\n`);

    if (exportedCount > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ EXPORT COMPLETE ✅                                 ║');
      console.log('║                                                                    ║');
      console.log('║  Check your Lemlist campaign to see the new leads!                ║');
      console.log('║  Campaign: https://app.lemlist.com/campaigns/cam_bJYSQ4pqMzasQWsRb║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('⚠️  No businesses were exported. Check errors above.\n');
    }

  } catch (error) {
    console.error('\n❌ Export failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}\n`);
    process.exit(1);
  }
}

// Run export
exportToLemlist().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
