/**
 * PRODUCTION TEST: Full Export with Revenue Estimation & Tier Assignment
 * Tests the complete pipeline: scraping → enrichment → revenue estimation → tier assignment → Lemlist export
 *
 * This is what actually runs in production!
 */

const { scrapeGoogleMapsOutscraper } = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { extractEmailsFromWebsite } = require('./shared/outreach-core/email-discovery/website-email-extractor');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { scrapeWebsite, parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const { estimateRevenue } = require('./ksd/local-outreach/orchestrator/modules/revenue-estimator');
const { assignTier } = require('./ksd/local-outreach/orchestrator/modules/tier-assigner');
const logger = require('./shared/outreach-core/logger');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const BUSINESSES_PER_CATEGORY = 5;
const CATEGORIES = ['salons', 'dentists', 'cafes'];

async function exportToLemlist() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║    FULL PRODUCTION EXPORT: Revenue Estimation + Tier Assignment   ║');
  console.log('║                   15 Businesses (3 Categories × 5)                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`📤 Campaign ID: ${CAMPAIGN_ID}`);
  console.log(`📊 Categories: ${CATEGORIES.join(', ')}`);
  console.log(`📈 Target: ${BUSINESSES_PER_CATEGORY} businesses per category`);
  console.log(`💰 Full Pipeline: Revenue Estimation → Tier Assignment → Dynamic Pricing\n`);

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: SCRAPE BUSINESSES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: ENRICHMENT (Names + Emails)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

      enrichedBusinesses.push({
        ...business,
        email: email
      });
    }

    console.log(`\n✅ Enrichment complete:`);
    console.log(`   Names found: ${namesFound}`);
    console.log(`   Names rejected: ${namesRejected}`);
    console.log(`   Emails found: ${emailsFound}`);
    console.log(`   Total enriched: ${enrichedBusinesses.length}\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3: REVENUE ESTIMATION & TIER ASSIGNMENT (NEW!)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3: REVENUE ESTIMATION & TIER ASSIGNMENT 🚀');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    for (let i = 0; i < enrichedBusinesses.length; i++) {
      const business = enrichedBusinesses[i];
      console.log(`[${i + 1}/${enrichedBusinesses.length}] ${business.name}`);

      try {
        // Estimate revenue using Claude API
        console.log(`   🤖 Estimating revenue with Claude...`);
        const revenueEstimate = await estimateRevenue(business);

        business.estimatedRevenue = revenueEstimate.estimatedRevenue;
        business.revenueBand = revenueEstimate.revenueBand;
        business.revenueConfidence = revenueEstimate.confidence;

        console.log(`   💰 Estimated Revenue: ${business.estimatedRevenue.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
        console.log(`   📊 Revenue Band: ${business.revenueBand}`);
        console.log(`   🎯 Confidence: ${business.revenueConfidence}`);

        // Assign tier based on revenue
        const tier = assignTier(business.estimatedRevenue);
        business.assignedOfferTier = tier.tierId;
        business.setupFee = tier.setupFee;
        business.monthlyPrice = tier.monthlyPrice;

        console.log(`   🎟️  Assigned Tier: ${tier.tierId}`);
        console.log(`   💵 Setup Fee: ${tier.setupFee}`);
        console.log(`   💳 Monthly Price: ${tier.monthlyPrice}`);

      } catch (error) {
        console.log(`   ⚠️  Revenue estimation failed: ${error.message}`);
        console.log(`   ℹ️  Defaulting to tier5 (£97)`);

        // Default to tier5 if estimation fails
        business.assignedOfferTier = 'tier5';
        business.estimatedRevenue = 50000; // Default low estimate
        business.revenueBand = 'under-100k';
        business.revenueConfidence = 'low';
      }

      // Generate merge variables (NOW includes dynamic pricing!)
      const mergeVariables = getAllMergeVariables(business);
      business.mergeVariables = mergeVariables;

      console.log(`   🏷️  Dynamic Price: ${mergeVariables.microOfferPrice}`);
      console.log(`   📧 Email greeting: "Hi ${mergeVariables.firstName},"`);
      if (mergeVariables.noNameNote) {
        console.log(`   💬 Disclaimer: "${mergeVariables.noNameNote}"`);
      }
      if (mergeVariables.multiOwnerNote) {
        console.log(`   👥 Multi-owner: "${mergeVariables.multiOwnerNote.substring(0, 60)}..."`);
      }
      console.log();
    }

    console.log(`✅ Revenue estimation & tier assignment complete!\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 4: EXPORT TO LEMLIST
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 4: EXPORTING TO LEMLIST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const existingEmails = new Set();
    let exported = 0;
    let skipped = 0;
    let errors = 0;

    for (const business of enrichedBusinesses) {
      if (!business.email) {
        console.log(`⏭️  Skipping ${business.name} (no email)`);
        skipped++;
        continue;
      }

      if (existingEmails.has(business.email)) {
        console.log(`⏭️  Skipping ${business.name} (duplicate email)`);
        skipped++;
        continue;
      }

      try {
        // ✅ FIX: Pass complete leadData object, not just email string
        const leadData = {
          email: business.email,
          firstName: business.mergeVariables.firstName,
          lastName: business.mergeVariables.lastName,
          companyName: business.mergeVariables.companyName,
          businessType: business.mergeVariables.businessType,
          location: business.mergeVariables.location,
          // Custom merge variables
          localIntro: business.mergeVariables.localIntro,
          observationSignal: business.mergeVariables.observationSignal,
          meetingOption: business.mergeVariables.meetingOption,
          microOfferPrice: business.mergeVariables.microOfferPrice,
          multiOwnerNote: business.mergeVariables.multiOwnerNote,
          noNameNote: business.mergeVariables.noNameNote
        };

        await addLeadToCampaign(CAMPAIGN_ID, leadData);

        console.log(`✅ Exported: ${business.name} (${business.assignedOfferTier} - ${business.mergeVariables.microOfferPrice})`);
        existingEmails.add(business.email);
        exported++;
      } catch (error) {
        console.log(`❌ Error exporting ${business.name}: ${error.message}`);
        errors++;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SUMMARY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('EXPORT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Successfully exported: ${exported}`);
    console.log(`⏭️  Skipped (no email/duplicate): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total processed: ${enrichedBusinesses.length}\n`);

    // Tier distribution
    const tierCounts = {};
    const pricingExamples = [];

    enrichedBusinesses.forEach(b => {
      const tier = b.assignedOfferTier || 'tier5';
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      if (b.mergeVariables && pricingExamples.length < 5) {
        pricingExamples.push({
          name: b.name,
          category: b.category,
          tier: tier,
          price: b.mergeVariables.microOfferPrice,
          revenue: b.estimatedRevenue
        });
      }
    });

    console.log('📈 TIER DISTRIBUTION:');
    Object.keys(tierCounts).sort().forEach(tier => {
      console.log(`   ${tier}: ${tierCounts[tier]} businesses`);
    });
    console.log();

    console.log('💰 PRICING EXAMPLES:');
    pricingExamples.forEach(ex => {
      const revenue = ex.revenue ? ex.revenue.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'unknown';
      console.log(`   ${ex.name} (${ex.category})`);
      console.log(`      Revenue: ${revenue} → ${ex.tier} → ${ex.price}`);
    });
    console.log();

    if (exported > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║              ✅ FULL PRODUCTION PIPELINE COMPLETE! ✅              ║');
      console.log('║                                                                    ║');
      console.log('║  • Revenue estimation via Claude API ✓                            ║');
      console.log('║  • Dynamic tier assignment (tier1-tier5) ✓                        ║');
      console.log('║  • Variable pricing (£97-£485) ✓                                  ║');
      console.log('║  • Merge variables (noNameNote, multiOwnerNote) ✓                 ║');
      console.log('║  • Exported to Lemlist ✓                                          ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝\n');
    } else {
      console.log('⚠️  No businesses were exported. Check errors above.\n');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the export
exportToLemlist()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });
