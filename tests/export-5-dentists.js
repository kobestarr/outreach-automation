/**
 * Export 5 Dentists to Lemlist
 * Test export with FIXED merge variables
 */

const { scrapeGoogleMapsOutscraper } = require('../ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { extractEmailsFromWebsite } = require('../shared/outreach-core/email-discovery/website-email-extractor');
const { scrapeWebsite, parseName } = require('../shared/outreach-core/enrichment/website-scraper');
const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('../shared/outreach-core/export-managers/lemlist-exporter');
const logger = require('../shared/outreach-core/logger');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

async function exportDentists() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         EXPORT 5 DENTISTS TO LEMLIST (Testing Fix)                ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  try {
    // Scrape dentists
    console.log('🗺️  Scraping Bramhall SK7 dentists...\n');

    const businesses = await scrapeGoogleMapsOutscraper('Bramhall', 'SK7', ['dentists'], true);

    console.log(`\n✅ Found ${businesses.length} dentists\n`);

    let exportedCount = 0;

    for (const business of businesses.slice(0, 10)) {
      if (exportedCount >= 5) break;

      if (!business.website) {
        console.log(`⏭️  ${business.name}: No website`);
        continue;
      }

      console.log(`\n📋 Processing: ${business.name}`);

      // Scrape website for owner names FIRST
      try {
        const websiteData = await scrapeWebsite(business.website);
        if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
          const owner = websiteData.ownerNames[0];
          const { firstName, lastName } = parseName(owner.name);

          // Only use name if validation passed
          if (firstName) {
            business.ownerFirstName = firstName;
            business.ownerLastName = lastName;
            console.log(`   ✅ Owner found: ${owner.name}${owner.title ? ` (${owner.title})` : ''}`);
          } else {
            console.log(`   ⚠️  Name validation failed: "${owner.name}" (likely job title, not a person)`);
          }
        } else {
          console.log(`   ⚠️  No owner names found on website`);
        }
      } catch (error) {
        console.log(`   ⚠️  Website scraping failed: ${error.message}`);
      }

      // Extract email
      let email = null;
      try {
        const emails = await extractEmailsFromWebsite(business.website);
        if (emails.length > 0) {
          email = emails[0];
          console.log(`   ✅ Email found: ${logger.sanitizeData(email)}`);
        }
      } catch (error) {
        console.log(`   ⏭️  Email extraction failed: ${error.message}`);
        continue;
      }

      if (!email) {
        console.log(`   ⏭️  No email found`);
        continue;
      }

      // Generate merge variables
      const mergeVariables = getAllMergeVariables(business);

      const leadData = {
        email: email,
        firstName: mergeVariables.firstName,
        lastName: mergeVariables.lastName,
        companyName: mergeVariables.companyName,
        location: mergeVariables.location,
        businessType: mergeVariables.businessType,
        localIntro: mergeVariables.localIntro,
        observationSignal: mergeVariables.observationSignal,
        meetingOption: mergeVariables.meetingOption,
        microOfferPrice: mergeVariables.microOfferPrice,
        multiOwnerNote: mergeVariables.multiOwnerNote,
        noNameNote: mergeVariables.noNameNote,
        companyDomain: business.website,
        phone: business.phone
      };

      try {
        await addLeadToCampaign(CAMPAIGN_ID, leadData);
        console.log(`\n✅ EXPORTED: ${business.name}`);
        console.log(`   Email: ${logger.sanitizeData(email)}`);
        console.log(`   firstName: ${leadData.firstName}`);
        console.log(`   companyName: ${leadData.companyName}`);
        console.log(`   localIntro: ${leadData.localIntro.substring(0, 50)}...`);
        console.log(`   observationSignal: ${leadData.observationSignal}`);
        console.log(`   microOfferPrice: ${leadData.microOfferPrice}`);
        console.log(`   meetingOption: ${leadData.meetingOption}`);
        exportedCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        if (error.message.includes('DUPLICATE')) {
          console.log(`⏭️  ${business.name}: Already in campaign`);
        } else {
          console.log(`❌ ${business.name}: ${error.message}`);
        }
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ Successfully exported ${exportedCount} dentists with FIXED merge variables!`);
    console.log(`\nCheck Lemlist campaign to verify merge variables are populated:\n`);
    console.log(`https://app.lemlist.com/campaigns/cam_bJYSQ4pqMzasQWsRb\n`);

  } catch (error) {
    console.error('\n❌ Export failed:', error.message);
    process.exit(1);
  }
}

exportDentists();
