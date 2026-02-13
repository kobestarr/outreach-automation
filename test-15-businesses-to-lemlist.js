/**
 * Test: Export 15 Businesses to Lemlist
 * Tests 3 different categories (5 businesses each) in Bramhall SK7
 * Shows name validation, email extraction, and fallback system in action
 */

const { scrapeGoogleMapsOutscraper } = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { extractEmailsFromWebsite } = require('./shared/outreach-core/email-discovery/website-email-extractor');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { scrapeWebsite, parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const logger = require('./shared/outreach-core/logger');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const BUSINESSES_PER_CATEGORY = 5;
const CATEGORIES = ['salons', 'dentists', 'cafes'];

async function exportToLemlist() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║        EXPORT 15 BUSINESSES TO LEMLIST (3 Categories × 5)         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`📤 Campaign ID: ${CAMPAIGN_ID}`);
  console.log(`📊 Categories: ${CATEGORIES.join(', ')}`);
  console.log(`📈 Target: ${BUSINESSES_PER_CATEGORY} businesses per category\n`);

  try {
    // Step 1: Scrape businesses from all categories
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 1: SCRAPING BUSINESSES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let allBusinesses = [];

    for (const category of CATEGORIES) {
      console.log(`🗺️  Scraping ${category} in Bramhall SK7...\n`);

      const businesses = await scrapeGoogleMapsOutscraper(
        'Bramhall',
        'SK7',
        [category],
        true
      );

      const selected = businesses.slice(0, BUSINESSES_PER_CATEGORY);
      allBusinesses = allBusinesses.concat(selected);

      console.log(`✅ Found ${businesses.length} ${category}, selected ${selected.length}\n`);
    }

    console.log(`📋 Total businesses to process: ${allBusinesses.length}\n`);

    // Step 2: Enrich with names and emails
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 2: ENRICHING BUSINESSES (Names + Emails)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const enrichedBusinesses = [];
    let namesFound = 0;
    let namesRejected = 0;
    let emailsFound = 0;

    for (let i = 0; i < allBusinesses.length; i++) {
      const business = allBusinesses[i];
      console.log(`[${i + 1}/${allBusinesses.length}] ${business.name}`);

      // Scrape website for owner names
      if (business.website) {
        try {
          const websiteData = await scrapeWebsite(business.website);

          if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
            const owner = websiteData.ownerNames[0];
            const { firstName, lastName } = parseName(owner.name);

            // Only use name if validation passed
            if (firstName) {
              business.ownerFirstName = firstName;
              business.ownerLastName = lastName;
              console.log(`   ✅ Owner: ${owner.name}${owner.title ? ` (${owner.title})` : ''}`);
              namesFound++;
            } else {
              console.log(`   ⚠️  Name rejected: "${owner.name}" (likely job title/business type)`);
              namesRejected++;
            }

            // Populate owners array for multi-owner note (if multiple people found)
            if (websiteData.ownerNames.length > 1) {
              business.owners = websiteData.ownerNames.map(o => {
                const parsed = parseName(o.name);
                return {
                  firstName: parsed.firstName,
                  lastName: parsed.lastName,
                  fullName: o.name,
                  title: o.title
                };
              }).filter(o => o.firstName); // Remove invalid names

              console.log(`   👥 Found ${business.owners.length} validated people total`);
            }
          } else {
            console.log(`   ℹ️  No owner names found on website`);
          }
        } catch (error) {
          console.log(`   ⚠️  Website scraping failed: ${error.message}`);
        }
      } else {
        console.log(`   ℹ️  No website available`);
      }

      // Extract email if website available
      let email = null;
      if (business.website) {
        try {
          const emails = await extractEmailsFromWebsite(business.website);
          if (emails.length > 0) {
            email = emails[0];
            console.log(`   ✅ Email: ${logger.sanitizeData(email)}`);
            emailsFound++;
          } else {
            console.log(`   ℹ️  No email found on website`);
          }
        } catch (error) {
          console.log(`   ⚠️  Email extraction failed: ${error.message}`);
        }
      }

      // Set fallback flag if no valid owner name was found
      if (!business.ownerFirstName) {
        business.usedFallbackName = true;
      }

      // Generate merge variables (this is where fallback kicks in!)
      const mergeVariables = getAllMergeVariables(business);

      enrichedBusinesses.push({
        ...business,
        email: email,
        mergeVariables: mergeVariables
      });

      console.log(`   📧 Email greeting: "Hi ${mergeVariables.firstName},"`);
      if (mergeVariables.noNameNote) {
        console.log(`   💬 Disclaimer: "${mergeVariables.noNameNote}"`);
      }
      console.log();
    }

    console.log(`✅ Enrichment complete:`);
    console.log(`   Names found: ${namesFound}`);
    console.log(`   Names rejected: ${namesRejected}`);
    console.log(`   Emails found: ${emailsFound}`);
    console.log(`   Total enriched: ${enrichedBusinesses.length}\n`);

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
        console.log(`   Greeting: "Hi ${leadData.firstName},"`);
        if (leadData.noNameNote) {
          console.log(`   Disclaimer: "${leadData.noNameNote}"`);
        }
        console.log();
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

    console.log('📈 DATA QUALITY STATS:');
    console.log(`   Valid names found: ${namesFound}/${allBusinesses.length} (${Math.round((namesFound/allBusinesses.length)*100)}%)`);
    console.log(`   Names rejected: ${namesRejected}/${allBusinesses.length} (${Math.round((namesRejected/allBusinesses.length)*100)}%)`);
    console.log(`   Emails found: ${emailsFound}/${allBusinesses.length} (${Math.round((emailsFound/allBusinesses.length)*100)}%)`);
    console.log(`   Export success rate: ${exportedCount}/${enrichedBusinesses.length} (${Math.round((exportedCount/enrichedBusinesses.length)*100)}%)\n`);

    if (exportedCount > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ EXPORT COMPLETE ✅                                 ║');
      console.log('║                                                                    ║');
      console.log('║  Check your Lemlist campaign to see the new leads!                ║');
      console.log('║  Campaign: https://app.lemlist.com/campaigns/cam_bJYSQ4pqMzasQWsRb║');
      console.log('║                                                                    ║');
      console.log('║  NOTE: Leads without names will have the "I couldn\'t find your    ║');
      console.log('║  names anywhere!" disclaimer for transparency.                    ║');
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
