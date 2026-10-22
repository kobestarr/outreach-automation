/**
 * PRODUCTION EXPORT: Professional Services (~50-60 businesses)
 * Full pipeline test: Revenue estimation + Tier assignment + Lemlist export
 * Targeting professional services with high generic email rates
 */

const { scrapeGoogleMapsOutscraper } = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { extractEmailsFromWebsite } = require('./shared/outreach-core/email-discovery/website-email-extractor');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { scrapeWebsite, parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const { estimateRevenue } = require('./ksd/local-outreach/orchestrator/modules/revenue-estimator');
const { priceLeads } = require('./shared/outreach-core/enrichment/price-leads');
const { assignTier } = require('./ksd/local-outreach/orchestrator/modules/tier-assigner');
const { saveBusiness } = require('./ksd/local-outreach/orchestrator/modules/database');
const { verifyEmail } = require('./shared/outreach-core/email-verification/reoon-verifier');
const logger = require('./shared/outreach-core/logger');

const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';
const BUSINESSES_PER_CATEGORY = 5; // ~50-60 total across 10-12 categories
const CATEGORIES = [
  'accountants',
  'solicitors',
  'estate agents',
  'financial advisors',
  'insurance brokers',
  'mortgage brokers',
  'business consultants',
  'IT support',
  'recruitment agencies',
  'architects',
  'surveyors',
  'engineers'
];

async function exportToLemlist() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║   PROFESSIONAL SERVICES EXPORT: ~50-60 High-Value Businesses      ║');
  console.log('║          Revenue Estimation + Dynamic Pricing + Lemlist           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`📤 Campaign ID: ${CAMPAIGN_ID}`);
  console.log(`📊 Categories: ${CATEGORIES.length} professional service categories`);
  console.log(`📈 Target: ${BUSINESSES_PER_CATEGORY} businesses per category (~${BUSINESSES_PER_CATEGORY * CATEGORIES.length} total)`);
  console.log(`💰 Full Pipeline: Revenue Estimation → Tier Assignment → Dynamic Pricing\n`);

  const startTime = Date.now();

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: SCRAPE BUSINESSES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 1: SCRAPING BUSINESSES FROM GOOGLE MAPS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let allBusinesses = [];

    for (const category of CATEGORIES) {
      console.log(`🗺️  Scraping ${category} in Bramhall SK7...`);

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

      // Scrape website for owner names AND emails
      let email = null;
      let businessEntries = []; // Will hold one or more entries for this business

      if (business.website) {
        try {
          const websiteData = await scrapeWebsite(business.website);

          // Check if there are people with email matches
          const peopleWithEmails = websiteData.ownerNames?.filter(owner =>
            owner.matchedEmail && owner.hasEmailMatch
          ) || [];

          if (peopleWithEmails.length > 0) {
            // MULTI-CONTACT: Create separate entry for each person with an email match
            console.log(`   ✉️  Found ${peopleWithEmails.length} people with email matches:`);

            for (const owner of peopleWithEmails) {
              const { firstName, lastName } = parseName(owner.name);

              if (firstName) {
                console.log(`   ✅ ${owner.name} → ${logger.sanitizeData(owner.matchedEmail)}`);

                // Create a separate business entry for this person
                businessEntries.push({
                  ...business,
                  ownerFirstName: firstName,
                  ownerLastName: lastName,
                  email: owner.matchedEmail,
                  usedFallbackName: false
                });

                namesFound++;
                emailsFound++;
              }
            }

            // Populate owners array for multi-owner note (all people, not just those with emails)
            if (websiteData.ownerNames.length > 1) {
              const allOwners = websiteData.ownerNames.map(o => {
                const parsed = parseName(o.name);
                return {
                  firstName: parsed.firstName,
                  lastName: parsed.lastName,
                  fullName: o.name,
                  title: o.title
                };
              }).filter(o => o.firstName);

              // Add owners to each entry
              businessEntries.forEach(entry => {
                entry.owners = allOwners;
              });

              console.log(`   👥 Found ${allOwners.length} validated people total`);
            }
          } else {
            // SINGLE-CONTACT: Fall back to original logic (first owner + first email)
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

              // Populate owners array for multi-owner note
              if (websiteData.ownerNames.length > 1) {
                business.owners = websiteData.ownerNames.map(o => {
                  const parsed = parseName(o.name);
                  return {
                    firstName: parsed.firstName,
                    lastName: parsed.lastName,
                    fullName: o.name,
                    title: o.title
                  };
                }).filter(o => o.firstName);

                console.log(`   👥 Found ${business.owners.length} validated people total`);
              }
            } else {
              console.log(`   ℹ️  No owner names found on website`);
            }

            // Extract email from scrapeWebsite results (includes Gmail addresses)
            if (websiteData.emails && websiteData.emails.length > 0) {
              email = websiteData.emails[0];
              console.log(`   ✅ Email: ${logger.sanitizeData(email)}`);
              emailsFound++;
            } else {
              console.log(`   ℹ️  No email found on website`);
            }

            // Set fallback flag if no valid owner name was found
            if (!business.ownerFirstName) {
              business.usedFallbackName = true;
            }

            businessEntries.push({
              ...business,
              email: email
            });
          }
        } catch (error) {
          console.log(`   ⚠️  Website scraping failed: ${error.message}`);

          // Set fallback flag
          business.usedFallbackName = true;

          businessEntries.push({
            ...business,
            email: null
          });
        }
      } else {
        console.log(`   ℹ️  No website available`);

        // Set fallback flag
        business.usedFallbackName = true;

        businessEntries.push({
          ...business,
          email: null
        });
      }

      // Add all entries for this business (could be multiple people)
      enrichedBusinesses.push(...businessEntries);
    }

    console.log(`\n✅ Enrichment complete:`);
    console.log(`   Names found: ${namesFound}`);
    console.log(`   Names rejected: ${namesRejected}`);
    console.log(`   Emails found: ${emailsFound}`);
    console.log(`   Total enriched: ${enrichedBusinesses.length}\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3: REVENUE ESTIMATION & TIER ASSIGNMENT
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3: REVENUE ESTIMATION & TIER ASSIGNMENT 🤖');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const pricing = await priceLeads(enrichedBusinesses, { estimateRevenue, assignTier });
    if (pricing.held.length) console.error(`${pricing.held.length} leads held back (not priced, not saved, not exported): ${pricing.held.map(b => b.name).join(', ')}`);

    for (let i = 0; i < enrichedBusinesses.length; i++) {
      const business = enrichedBusinesses[i];
      console.log(`[${i + 1}/${enrichedBusinesses.length}] ${business.name}`);

      // Generate merge variables
      const mergeVariables = getAllMergeVariables(business);
      business.mergeVariables = mergeVariables;

      console.log(`   🏷️  Price: ${mergeVariables.microOfferPrice}`);
      console.log(`   📧 Greeting: "Hi ${mergeVariables.firstName},"`);

      // Save to database
      saveBusiness({
        name: business.name || business.businessName,
        businessName: business.name || business.businessName,
        location: 'Bramhall',
        postcode: business.postcode || 'SK7',
        address: business.address,
        website: business.website,
        phone: business.phone,
        category: business.category,
        rating: business.rating,
        reviewCount: business.reviewCount,
        ownerFirstName: business.ownerFirstName,
        ownerLastName: business.ownerLastName,
        ownerEmail: business.email,
        emailSource: 'website-scraper',
        estimatedRevenue: business.estimatedRevenue,
        revenueBand: business.revenueBand,
        revenueConfidence: business.revenueConfidence,
        assignedOfferTier: business.assignedOfferTier,
        setupFee: business.setupFee,
        monthlyPrice: business.monthlyPrice
      }, {
        status: 'enriched',
        scrapedAt: new Date().toISOString(),
        enrichedAt: new Date().toISOString()
      });
      console.log(`   💾 Saved to database`);
      console.log();
    }

    console.log(`✅ Revenue estimation & tier assignment complete!\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3.5: EMAIL VERIFICATION (Reoon API)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3.5: VERIFYING EMAILS WITH REOON API 🔍');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    let verified = 0;
    let invalid = 0;
    let risky = 0;
    let verificationErrors = 0;

    for (let i = 0; i < enrichedBusinesses.length; i++) {
      const business = enrichedBusinesses[i];

      if (!business.email) {
        console.log(`[${i + 1}/${enrichedBusinesses.length}] ${business.name} - No email to verify`);
        continue;
      }

      console.log(`[${i + 1}/${enrichedBusinesses.length}] ${business.name}`);
      console.log(`   Email: ${logger.sanitizeData(business.email)}`);

      try {
        const verification = await verifyEmail(business.email, 'quick'); // Use quick mode to save credits

        business.emailVerified = verification.isValid;
        business.emailStatus = verification.status;
        business.emailScore = verification.score;

        if (verification.isValid) {
          console.log(`   ✅ VALID (${verification.status}, score: ${verification.score})`);
          verified++;
        } else if (verification.status === 'risky' || verification.status === 'unknown') {
          console.log(`   ⚠️  RISKY (${verification.status}, score: ${verification.score})`);
          risky++;
          business.emailVerified = false; // Mark as unverified for safety
          business.email = null; // Don't export risky emails
        } else {
          console.log(`   ❌ INVALID (${verification.status})`);
          invalid++;
          business.emailVerified = false;
          business.email = null; // Don't export invalid emails
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.log(`   ⚠️  Verification error: ${error.message}`);
        verificationErrors++;
        business.emailVerified = false;
        business.email = null; // Don't export unverified emails on error
      }

      console.log();
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('VERIFICATION SUMMARY:');
    console.log(`✅ Valid: ${verified} (${Math.round(verified/enrichedBusinesses.length*100)}%)`);
    console.log(`⚠️  Risky: ${risky} (${Math.round(risky/enrichedBusinesses.length*100)}%) - EXCLUDED`);
    console.log(`❌ Invalid: ${invalid} (${Math.round(invalid/enrichedBusinesses.length*100)}%) - EXCLUDED`);
    console.log(`⚠️  Errors: ${verificationErrors}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`📤 Ready to export ${verified} verified leads to Lemlist\n`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 4: EXPORT TO LEMLIST (Only Verified Emails)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 4: EXPORTING VERIFIED LEADS TO LEMLIST');
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
        const leadData = {
          email: business.email,
          firstName: business.mergeVariables.firstName,
          lastName: business.mergeVariables.lastName,
          companyName: business.mergeVariables.companyName,
          businessType: business.mergeVariables.businessType,
          location: business.mergeVariables.location,
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

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log(`❌ Error exporting ${business.name}: ${error.message}`);
        errors++;
      }
    }

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SUMMARY
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('EXPORT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Successfully exported: ${exported}`);
    console.log(`⏭️  Skipped (no email/duplicate): ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total processed: ${enrichedBusinesses.length}`);
    console.log(`⏱️  Duration: ${duration} seconds\n`);

    // Tier distribution
    const tierCounts = {};
    const pricingExamples = [];

    enrichedBusinesses.forEach(b => {
      const tier = b.assignedOfferTier || 'tier1';
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;

      if (b.mergeVariables && b.email) {
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

    console.log('💰 PRICING SAMPLE (First 10 exported):');
    pricingExamples.slice(0, 10).forEach(ex => {
      const revenue = ex.revenue ? ex.revenue.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'unknown';
      console.log(`   ${ex.name} (${ex.category})`);
      console.log(`      Revenue: ${revenue} → ${ex.tier} → ${ex.price}`);
    });
    console.log();

    // Data quality stats
    console.log('📊 DATA QUALITY:');
    console.log(`   Names found: ${namesFound}/${enrichedBusinesses.length} (${Math.round(namesFound/enrichedBusinesses.length*100)}%)`);
    console.log(`   Names rejected: ${namesRejected}/${enrichedBusinesses.length} (${Math.round(namesRejected/enrichedBusinesses.length*100)}%)`);
    console.log(`   Emails found: ${emailsFound}/${enrichedBusinesses.length} (${Math.round(emailsFound/enrichedBusinesses.length*100)}%)`);
    console.log(`   Export success rate: ${exported}/${emailsFound} (${Math.round(exported/emailsFound*100)}%)\n`);

    if (exported > 0) {
      console.log('╔════════════════════════════════════════════════════════════════════╗');
      console.log('║            ✅ FULL PRODUCTION PIPELINE COMPLETE! ✅                ║');
      console.log('║                                                                    ║');
      console.log(`║  ${exported} businesses exported to Lemlist with:                        ║`);
      console.log('║  • Revenue estimation via Claude API ✓                            ║');
      console.log('║  • Dynamic tier assignment (tier1-tier5) ✓                        ║');
      console.log('║  • Variable pricing (£97-£485) ✓                                  ║');
      console.log('║  • Merge variables (noNameNote, multiOwnerNote) ✓                 ║');
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
