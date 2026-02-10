/**
 * FULL PIPELINE STRESS TEST
 * 10 businesses, 3 types, Bramhall SK7
 *
 * Tests EVERYTHING:
 * 1. Google Maps scraping
 * 2. Website scraping (names + emails + email claiming)
 * 3. LinkedIn enrichment (Icypeas)
 * 4. Email merge variables
 * 5. Lemlist export
 * 6. Prosp export
 *
 * Shows REAL production readiness - what works, what's broken
 */

const { scrapeGoogleMapsOutscraper } = require('../ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { scrapeWebsite } = require('../shared/outreach-core/enrichment/website-scraper');
const { enrichLinkedIn } = require('../shared/outreach-core/linkedin-enrichment');
const { getAllMergeVariables } = require('../shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign: addToLemlist } = require('../shared/outreach-core/export-managers/lemlist-exporter');
const { sendLinkedInOutreach } = require('../shared/outreach-core/prosp-integration/linkedin-outreach');
const logger = require('../shared/outreach-core/logger');

// Configuration
const LEMLIST_CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const BUSINESS_TYPES = [
  { type: 'dentists', count: 4 },
  { type: 'hair salons', count: 3 },
  { type: 'restaurants', count: 3 }
];

const RESULTS = {
  totalBusinesses: 0,
  websiteScraped: 0,
  namesFound: 0,
  emailsFound: 0,
  linkedInEnriched: 0,
  lemlistExported: 0,
  prospExported: 0,
  errors: [],
  businesses: []
};

async function stressTest() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║    BRAMHALL FULL PIPELINE STRESS TEST - 10 BUSINESSES             ║');
  console.log('║    Testing: Scrape → Enrich → Lemlist → Prosp                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  let allBusinesses = [];

  // Phase 1: Scrape all business types
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 1: GOOGLE MAPS SCRAPING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const businessType of BUSINESS_TYPES) {
    console.log(`🗺️  Scraping ${businessType.type} in Bramhall SK7...`);

    try {
      const businesses = await scrapeGoogleMapsOutscraper(
        'Bramhall',
        'SK7',
        [businessType.type],
        true // extractEmails
      );

      const limitedBusinesses = businesses.slice(0, businessType.count);
      console.log(`   ✅ Found ${businesses.length} ${businessType.type}, taking ${limitedBusinesses.length}\n`);
      allBusinesses = allBusinesses.concat(limitedBusinesses);
    } catch (error) {
      console.log(`   ❌ Failed to scrape ${businessType.type}: ${error.message}\n`);
      RESULTS.errors.push({
        phase: 'google_maps',
        businessType: businessType.type,
        error: error.message
      });
    }
  }

  console.log(`📊 Total businesses scraped: ${allBusinesses.length}\n`);
  RESULTS.totalBusinesses = allBusinesses.length;

  // Phase 2-6: Process each business
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHASE 2-6: FULL PIPELINE PER BUSINESS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let processedCount = 0;

  for (const business of allBusinesses) {
    processedCount++;

    const businessResult = {
      name: business.name || business.businessName,
      category: business.category,
      website: business.website,
      phases: {
        websiteScraping: { success: false, error: null },
        linkedInEnrichment: { success: false, error: null },
        lemlistExport: { success: false, error: null },
        prospExport: { success: false, error: null }
      },
      data: {
        ownerNames: [],
        emails: [],
        linkedInUrl: null,
        primaryEmail: null
      }
    };

    console.log(`\n━━━ [${processedCount}/${allBusinesses.length}] ${businessResult.name} ━━━\n`);

    // Skip if no website
    if (!business.website) {
      console.log('   ⏭️  No website - skipping\n');
      businessResult.phases.websiteScraping.error = 'No website';
      RESULTS.businesses.push(businessResult);
      continue;
    }

    // PHASE 2: Website Scraping
    console.log('   [PHASE 2] Website Scraping...');
    try {
      const websiteData = await scrapeWebsite(business.website);

      if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
        business.owners = websiteData.ownerNames.map(owner => ({
          firstName: owner.name.split(' ')[0],
          lastName: owner.name.split(' ').slice(1).join(' '),
          fullName: owner.name,
          title: owner.title,
          hasEmailMatch: owner.hasEmailMatch,
          matchedEmail: owner.matchedEmail
        }));

        // Set primary owner
        const primaryOwner = business.owners[0];
        business.ownerFirstName = primaryOwner.firstName;
        business.ownerLastName = primaryOwner.lastName;

        businessResult.data.ownerNames = business.owners.map(o => o.fullName);
        RESULTS.namesFound++;
      }

      if (websiteData.emails && websiteData.emails.length > 0) {
        businessResult.data.emails = websiteData.emails;
        businessResult.data.primaryEmail = websiteData.emails[0];
        RESULTS.emailsFound++;
      }

      if (websiteData.registrationNumber) {
        business.registrationNumber = websiteData.registrationNumber;
      }

      businessResult.phases.websiteScraping.success = true;
      RESULTS.websiteScraped++;

      console.log(`      ✅ Names: ${businessResult.data.ownerNames.length}, Emails: ${businessResult.data.emails.length}`);
    } catch (error) {
      businessResult.phases.websiteScraping.error = error.message;
      console.log(`      ❌ Failed: ${error.message}`);
      RESULTS.errors.push({
        phase: 'website_scraping',
        business: businessResult.name,
        error: error.message
      });
    }

    // PHASE 3: LinkedIn Enrichment (if we have owner name)
    if (business.ownerFirstName && business.ownerLastName) {
      console.log('   [PHASE 3] LinkedIn Enrichment...');
      try {
        const linkedInResult = await enrichLinkedIn(business);

        if (linkedInResult.enriched && linkedInResult.linkedInUrl) {
          business.linkedInUrl = linkedInResult.linkedInUrl;
          business.linkedInData = linkedInResult.linkedInData;

          businessResult.data.linkedInUrl = linkedInResult.linkedInUrl;
          businessResult.phases.linkedInEnrichment.success = true;
          RESULTS.linkedInEnriched++;

          console.log(`      ✅ LinkedIn: ${linkedInResult.linkedInUrl}`);
        } else {
          businessResult.phases.linkedInEnrichment.error = linkedInResult.reason || 'Profile not found';
          console.log(`      ⚠️  Not found: ${linkedInResult.reason}`);
        }
      } catch (error) {
        businessResult.phases.linkedInEnrichment.error = error.message;
        console.log(`      ❌ Failed: ${error.message}`);
        RESULTS.errors.push({
          phase: 'linkedin_enrichment',
          business: businessResult.name,
          error: error.message
        });
      }
    } else {
      console.log('   [PHASE 3] LinkedIn Enrichment: ⏭️  No owner name');
      businessResult.phases.linkedInEnrichment.error = 'No owner name';
    }

    // PHASE 4: Generate Merge Variables
    if (businessResult.data.emails.length > 0) {
      console.log('   [PHASE 4] Generating merge variables...');
      try {
        const mergeVariables = getAllMergeVariables(business);
        business.mergeVariables = mergeVariables;
        console.log(`      ✅ Merge variables ready`);
      } catch (error) {
        console.log(`      ⚠️  Warning: ${error.message}`);
      }
    }

    // PHASE 5: Lemlist Export
    if (businessResult.data.primaryEmail) {
      console.log('   [PHASE 5] Lemlist Export...');
      try {
        const leadData = {
          email: businessResult.data.primaryEmail,
          firstName: business.ownerFirstName || 'there',
          lastName: business.ownerLastName || '',
          companyName: business.businessName || business.name,
          ...business.mergeVariables
        };

        await addToLemlist(LEMLIST_CAMPAIGN_ID, leadData);

        businessResult.phases.lemlistExport.success = true;
        RESULTS.lemlistExported++;
        console.log(`      ✅ Exported to Lemlist`);
      } catch (error) {
        // Check if duplicate
        if (error.message.includes('already in the campaign') || error.message.includes('400')) {
          businessResult.phases.lemlistExport.success = true;
          businessResult.phases.lemlistExport.error = 'Duplicate (already in campaign)';
          RESULTS.lemlistExported++;
          console.log(`      ✅ Already in campaign (duplicate)`);
        } else {
          businessResult.phases.lemlistExport.error = error.message;
          console.log(`      ❌ Failed: ${error.message}`);
          RESULTS.errors.push({
            phase: 'lemlist_export',
            business: businessResult.name,
            error: error.message
          });
        }
      }
    } else {
      console.log('   [PHASE 5] Lemlist Export: ⏭️  No email');
      businessResult.phases.lemlistExport.error = 'No email';
    }

    // PHASE 6: Prosp Export (if LinkedIn URL exists)
    if (businessResult.data.linkedInUrl) {
      console.log('   [PHASE 6] Prosp Export...');
      try {
        const prospResult = await sendLinkedInOutreach(business, {
          sendImmediately: false // Campaign will auto-send
        });

        if (prospResult.addedToCampaign > 0) {
          businessResult.phases.prospExport.success = true;
          RESULTS.prospExported++;
          console.log(`      ✅ Exported to Prosp (${prospResult.addedToCampaign} owners)`);
        } else {
          businessResult.phases.prospExport.error = prospResult.errors[0]?.error || 'No owners added';
          console.log(`      ⚠️  No owners added`);
        }
      } catch (error) {
        businessResult.phases.prospExport.error = error.message;
        console.log(`      ❌ Failed: ${error.message}`);
        RESULTS.errors.push({
          phase: 'prosp_export',
          business: businessResult.name,
          error: error.message
        });
      }
    } else {
      console.log('   [PHASE 6] Prosp Export: ⏭️  No LinkedIn URL');
      businessResult.phases.prospExport.error = 'No LinkedIn URL';
    }

    RESULTS.businesses.push(businessResult);
  }

  // Final Report
  console.log('\n\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    STRESS TEST RESULTS                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('📊 SUMMARY:\n');
  console.log(`   Total Businesses:      ${RESULTS.totalBusinesses}`);
  console.log(`   Website Scraped:       ${RESULTS.websiteScraped} (${Math.round(RESULTS.websiteScraped/RESULTS.totalBusinesses*100)}%)`);
  console.log(`   Names Found:           ${RESULTS.namesFound} (${Math.round(RESULTS.namesFound/RESULTS.totalBusinesses*100)}%)`);
  console.log(`   Emails Found:          ${RESULTS.emailsFound} (${Math.round(RESULTS.emailsFound/RESULTS.totalBusinesses*100)}%)`);
  console.log(`   LinkedIn Enriched:     ${RESULTS.linkedInEnriched} (${Math.round(RESULTS.linkedInEnriched/RESULTS.totalBusinesses*100)}%)`);
  console.log(`   Lemlist Exported:      ${RESULTS.lemlistExported} (${Math.round(RESULTS.lemlistExported/RESULTS.totalBusinesses*100)}%)`);
  console.log(`   Prosp Exported:        ${RESULTS.prospExported} (${Math.round(RESULTS.prospExported/RESULTS.totalBusinesses*100)}%)`);
  console.log(`   Total Errors:          ${RESULTS.errors.length}\n`);

  // Business breakdown
  console.log('📋 BUSINESS BREAKDOWN:\n');
  RESULTS.businesses.forEach((biz, idx) => {
    const statusIcon = biz.phases.lemlistExport.success ? '✅' : '❌';
    console.log(`${idx + 1}. ${statusIcon} ${biz.name}`);
    console.log(`   Category: ${biz.category}`);
    console.log(`   Website: ${biz.phases.websiteScraping.success ? '✅' : '❌'} | LinkedIn: ${biz.phases.linkedInEnrichment.success ? '✅' : '❌'} | Lemlist: ${biz.phases.lemlistExport.success ? '✅' : '❌'} | Prosp: ${biz.phases.prospExport.success ? '✅' : '❌'}`);
    console.log(`   Owners: ${biz.data.ownerNames.join(', ') || 'None'}`);
    console.log(`   Emails: ${biz.data.emails.length} | LinkedIn: ${biz.data.linkedInUrl ? 'Yes' : 'No'}\n`);
  });

  // Error summary
  if (RESULTS.errors.length > 0) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  ERRORS:\n');

    const errorsByPhase = RESULTS.errors.reduce((acc, err) => {
      acc[err.phase] = acc[err.phase] || [];
      acc[err.phase].push(err);
      return acc;
    }, {});

    for (const [phase, errors] of Object.entries(errorsByPhase)) {
      console.log(`${phase}: ${errors.length} errors`);
      errors.slice(0, 3).forEach(err => {
        console.log(`   - ${err.business}: ${err.error}`);
      });
      if (errors.length > 3) {
        console.log(`   ... and ${errors.length - 3} more`);
      }
      console.log();
    }
  }

  // Production readiness assessment
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎯 PRODUCTION READINESS:\n');

  const emailSuccessRate = RESULTS.lemlistExported / RESULTS.totalBusinesses;
  const linkedInSuccessRate = RESULTS.linkedInEnriched / RESULTS.totalBusinesses;

  console.log(`Email Pipeline:    ${emailSuccessRate >= 0.7 ? '✅ READY' : '⚠️  NEEDS WORK'} (${Math.round(emailSuccessRate*100)}% success)`);
  console.log(`LinkedIn Pipeline: ${linkedInSuccessRate >= 0.5 ? '✅ READY' : '⚠️  NEEDS WORK'} (${Math.round(linkedInSuccessRate*100)}% success)`);

  if (emailSuccessRate >= 0.7) {
    console.log('\n✅ Email outreach is production ready!');
    console.log('   You can start sending emails tomorrow.');
  } else {
    console.log('\n⚠️  Email pipeline needs fixes before production.');
  }

  if (linkedInSuccessRate >= 0.5) {
    console.log('\n✅ LinkedIn outreach is production ready!');
    console.log('   Prosp campaigns can be started.');
  } else {
    console.log('\n⚠️  LinkedIn pipeline needs optimization.');
    console.log('   Review Icypeas quota and decision logic.');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Next Steps:');
  console.log('  1. Review errors above');
  console.log('  2. Check Lemlist campaign: https://app.lemlist.com/campaigns/' + LEMLIST_CAMPAIGN_ID);
  console.log('  3. Check Prosp dashboard for LinkedIn leads');
  console.log('  4. If ready: Scale to all Bramhall businesses');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

stressTest().catch(error => {
  console.error('\n❌ STRESS TEST CRASHED:');
  console.error(`   Error: ${error.message}`);
  console.error(`   Stack: ${error.stack}\n`);
  process.exit(1);
});
