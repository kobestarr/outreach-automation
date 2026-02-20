/**
 * Bramhall Deep Dive — All Business Categories
 *
 * Full pipeline: Google Maps scrape → Website enrichment → LLM owner extraction →
 * Revenue estimation → Tier assignment → Smart email verification → DB save → Lemlist export
 *
 * Owner extraction: regex first (free), then LLM (Haiku ~$0.001/biz) for any misses.
 * Smart email verification: website-scraped emails = auto-valid, others via Reoon.
 *
 * Usage:
 *   node batch-bramhall-all-categories.js --dry-run     # Show what would be searched (no API calls)
 *   node batch-bramhall-all-categories.js --scrape-only  # Scrape + enrich + save to DB, no Lemlist export
 *   node batch-bramhall-all-categories.js --wave3        # Only wave 3 categories (services + more trades)
 *   node batch-bramhall-all-categories.js                # Full pipeline including Lemlist export
 */

const { scrapeGoogleMapsOutscraper } = require('./ksd/local-outreach/orchestrator/modules/google-maps-scraper-outscraper');
const { filterChains } = require('./ksd/local-outreach/orchestrator/modules/chain-filter');
const { scrapeWebsite, parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const { estimateRevenue } = require('./ksd/local-outreach/orchestrator/modules/revenue-estimator');
const { assignTier } = require('./ksd/local-outreach/orchestrator/modules/tier-assigner');
const { getAllMergeVariables } = require('./shared/outreach-core/content-generation/email-merge-variables');
const { addLeadToCampaign } = require('./shared/outreach-core/export-managers/lemlist-exporter');
const { verifyEmail } = require('./shared/outreach-core/email-verification/reoon-verifier');
const { saveBusiness } = require('./ksd/local-outreach/orchestrator/modules/database');
const { isValidEmail } = require('./shared/outreach-core/validation/data-quality');
const { extractOwnersFromWebsite } = require('./shared/outreach-core/enrichment/llm-owner-extractor');
const { closeBrowser } = require('./shared/outreach-core/enrichment/browser-fetcher');
const logger = require('./shared/outreach-core/logger');

// ── Configuration ──────────────────────────────────────────────────────────
const LOCATION = 'Bramhall';
const POSTCODE = 'SK7';
const CAMPAIGN_ID = 'cam_bJYSQ4pqMzasQWsRb';

const DRY_RUN = process.argv.includes('--dry-run');
const SCRAPE_ONLY = process.argv.includes('--scrape-only');
const NEW_TRADES_ONLY = process.argv.includes('--new-trades');
const WAVE3_ONLY = process.argv.includes('--wave3');

// ── Wave 1: Core categories (35) ───────────────────────────────────────────
// Already scraped. Expand to wave 2/3 based on what comes back.

// Professional services (12)
const PROFESSIONAL_CATEGORIES = [
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

// Consumer categories (23)
const CONSUMER_CATEGORIES = [
  'dentists',
  'hair salons',
  'beauty salons',
  'restaurants',
  'cafes',
  'gyms',
  'yoga studios',
  'physiotherapists',
  'chiropractors',
  'opticians',
  'vets',
  'dog groomers',
  'florists',
  'car mechanics',
  'plumbers',
  'electricians',
  'builders',
  'cleaners',
  'gardeners',
  'tutors',
  'nurseries',
  'driving instructors',
  'personal trainers'
];

// ── New trades: Checkatrade/MyBuilder heavy categories ────────────────────
// Use --new-trades flag to scrape ONLY these (skips already-scraped categories)
const NEW_TRADE_CATEGORIES = [
  'roofers',
  'landscapers',
  'painters and decorators',
  'plasterers',
  'tilers',
  'fencing contractors',
  'heating engineers',
  'boiler installers',
  'handymen',
  'bathroom fitters',
  'kitchen fitters',
  'window cleaners',
  'driveway contractors',
  'tree surgeons',
  'locksmiths',
  'pest control',
  'carpet cleaners'
];

// ── Wave 3: Services + more trades ────────────────────────────────────────
// Use --wave3 flag to scrape ONLY these new categories
const WAVE3_SERVICES = [
  'photographers',
  'interior designers',
  'web designers',
  'counsellors',
  'osteopaths',
  'massage therapists',
  'caterers',
  'removal companies',
  'dry cleaners',
  'chiropodists',
  'dog walkers',
  'dance schools',
  'martial arts',
  'pilates studios',
  'music teachers'
];

const WAVE3_TRADES = [
  'scaffolders',
  'skip hire',
  'tyre fitters',
  'garage door installers',
  'aerial installers',
  'security systems installers'
];

const ALL_CATEGORIES = WAVE3_ONLY
  ? [...WAVE3_SERVICES, ...WAVE3_TRADES]
  : NEW_TRADES_ONLY
    ? NEW_TRADE_CATEGORIES
    : [...PROFESSIONAL_CATEGORIES, ...CONSUMER_CATEGORIES, ...NEW_TRADE_CATEGORIES, ...WAVE3_SERVICES, ...WAVE3_TRADES];

// ── Stats tracking ─────────────────────────────────────────────────────────
const STATS = {
  categoriesSearched: 0,
  totalScraped: 0,
  chainsFiltered: 0,
  duplicatesRemoved: 0,
  uniqueBusinesses: 0,
  withWebsite: 0,
  namesFound: 0,
  emailsFound: 0,
  emailsAutoValid: 0,
  emailsReoonValid: 0,
  emailsReoonInvalid: 0,
  emailsReoonRisky: 0,
  llmProcessed: 0,
  llmNamesFound: 0,
  llmInputTokens: 0,
  llmOutputTokens: 0,
  revenueEstimated: 0,
  savedToDb: 0,
  exported: 0,
  exportSkipped: 0,
  exportErrors: 0
};

async function run() {
  const startTime = Date.now();

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       BRAMHALL DEEP DIVE — ALL BUSINESS CATEGORIES              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Location:   ${LOCATION}, ${POSTCODE}`);
  if (NEW_TRADES_ONLY) {
    console.log(`Categories: ${ALL_CATEGORIES.length} (new trades only)`);
  } else {
    console.log(`Categories: ${ALL_CATEGORIES.length} (${PROFESSIONAL_CATEGORIES.length} professional + ${CONSUMER_CATEGORIES.length} consumer + ${NEW_TRADE_CATEGORIES.length} new trades)`);
  }
  console.log(`Mode:       ${DRY_RUN ? 'DRY RUN (no API calls)' : SCRAPE_ONLY ? 'SCRAPE ONLY (no Lemlist export)' : 'FULL PIPELINE'}\n`);

  if (DRY_RUN) {
    if (NEW_TRADES_ONLY) {
      console.log(`--- New Trade Categories (${NEW_TRADE_CATEGORIES.length}) ---\n`);
      NEW_TRADE_CATEGORIES.forEach(c => console.log(`  - ${c}`));
    } else {
      console.log(`Professional Services (${PROFESSIONAL_CATEGORIES.length}):`);
      PROFESSIONAL_CATEGORIES.forEach(c => console.log(`  - ${c}`));
      console.log(`\nConsumer (${CONSUMER_CATEGORIES.length}):`);
      CONSUMER_CATEGORIES.forEach(c => console.log(`  - ${c}`));
      console.log(`\nNew Trades (${NEW_TRADE_CATEGORIES.length}):`);
      NEW_TRADE_CATEGORIES.forEach(c => console.log(`  - ${c}`));
    }
    console.log(`\nTotal: ${ALL_CATEGORIES.length} categories`);
    console.log(`Estimated Outscraper queries: ~${ALL_CATEGORIES.length}`);
    console.log('Dedup: placeId-based — overlapping categories won\'t double-enrich\n');
    console.log('Run without --dry-run to execute.\n');
    return;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 1: SCRAPE ALL CATEGORIES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 1: SCRAPING GOOGLE MAPS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let allBusinesses = [];
  const seenPlaceIds = new Set();

  for (const category of ALL_CATEGORIES) {
    console.log(`  Scraping "${category}" in ${LOCATION} ${POSTCODE}...`);
    STATS.categoriesSearched++;

    try {
      const businesses = await scrapeGoogleMapsOutscraper(LOCATION, POSTCODE, [category], true);

      // Filter chains
      const filtered = filterChains(businesses);
      const chainsRemoved = businesses.length - filtered.length;
      STATS.chainsFiltered += chainsRemoved;

      // Deduplicate by placeId
      let added = 0;
      for (const biz of filtered) {
        const key = biz.placeId || `${biz.name}-${biz.address}`;
        if (!seenPlaceIds.has(key)) {
          seenPlaceIds.add(key);
          biz.category = category; // Tag with search category
          allBusinesses.push(biz);
          added++;
        } else {
          STATS.duplicatesRemoved++;
        }
      }

      STATS.totalScraped += businesses.length;
      console.log(`    Found ${businesses.length}, chains removed: ${chainsRemoved}, new unique: ${added}\n`);

      // Small delay between queries to be respectful
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.log(`    ERROR: ${err.message}\n`);
    }
  }

  STATS.uniqueBusinesses = allBusinesses.length;
  console.log(`\n  Total unique businesses: ${allBusinesses.length}\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2: WEBSITE ENRICHMENT (Names + Emails)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2: WEBSITE ENRICHMENT (Names + Emails)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const enrichedBusinesses = [];

  for (let i = 0; i < allBusinesses.length; i++) {
    const business = allBusinesses[i];
    const label = `[${i + 1}/${allBusinesses.length}] ${(business.name || '').substring(0, 40).padEnd(40)}`;

    if (!business.website) {
      console.log(`  SKIP  ${label} (no website)`);
      business.usedFallbackName = true;
      enrichedBusinesses.push({ ...business, email: null, emailSource: null });
      continue;
    }

    // Skip social media URLs
    if (business.website.includes('facebook.com') || business.website.includes('instagram.com')) {
      console.log(`  SKIP  ${label} (social media URL)`);
      business.usedFallbackName = true;
      enrichedBusinesses.push({ ...business, email: null, emailSource: null });
      continue;
    }

    STATS.withWebsite++;

    try {
      const websiteData = await scrapeWebsite(business.website);

      // Find people with email matches
      const peopleWithEmails = (websiteData.ownerNames || []).filter(o => o.matchedEmail && o.hasEmailMatch);

      if (peopleWithEmails.length > 0) {
        // Multi-contact: create entry for each person with email
        const allOwners = websiteData.ownerNames.map(o => {
          const parsed = parseName(o.name);
          return { firstName: parsed.firstName, lastName: parsed.lastName, fullName: o.name, title: o.title };
        }).filter(o => o.firstName);

        for (const owner of peopleWithEmails) {
          const { firstName, lastName } = parseName(owner.name);
          if (!firstName) continue;

          enrichedBusinesses.push({
            ...business,
            ownerFirstName: firstName,
            ownerLastName: lastName,
            email: owner.matchedEmail,
            emailSource: 'website-scraping',
            usedFallbackName: false,
            owners: allOwners.length > 1 ? allOwners : undefined
          });
          STATS.namesFound++;
          STATS.emailsFound++;
        }
        console.log(`  OK    ${label} ${peopleWithEmails.length} people w/ emails`);
      } else {
        // Single-contact: first owner + first email
        let ownerFirst = null, ownerLast = null;
        if (websiteData.ownerNames && websiteData.ownerNames.length > 0) {
          const parsed = parseName(websiteData.ownerNames[0].name);
          if (parsed.firstName) {
            ownerFirst = parsed.firstName;
            ownerLast = parsed.lastName;
            STATS.namesFound++;
          }
        }

        let email = null;
        let emailSource = null;
        if (websiteData.emails && websiteData.emails.length > 0) {
          email = websiteData.emails[0];
          emailSource = 'website-scraping';
          STATS.emailsFound++;
        }

        // Populate owners array for multi-owner note
        let owners;
        if (websiteData.ownerNames && websiteData.ownerNames.length > 1) {
          owners = websiteData.ownerNames.map(o => {
            const parsed = parseName(o.name);
            return { firstName: parsed.firstName, lastName: parsed.lastName, fullName: o.name, title: o.title };
          }).filter(o => o.firstName);
        }

        const tag = ownerFirst ? (email ? 'OK   ' : 'NAME ') : (email ? 'EMAIL' : '---  ');
        console.log(`  ${tag} ${label} ${ownerFirst || '(no name)'} ${email ? logger.sanitizeData(email) : '(no email)'}`);

        enrichedBusinesses.push({
          ...business,
          ownerFirstName: ownerFirst,
          ownerLastName: ownerLast,
          email,
          emailSource,
          usedFallbackName: !ownerFirst,
          owners
        });
      }

      // Rate limit between website scrapes
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(`  ERR   ${label} ${err.message.substring(0, 60)}`);
      enrichedBusinesses.push({
        ...business,
        email: null,
        emailSource: null,
        usedFallbackName: true
      });
    }
  }

  console.log(`\n  Enriched: ${enrichedBusinesses.length}, Names: ${STATS.namesFound}, Emails: ${STATS.emailsFound}\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 2b: LLM OWNER EXTRACTION (for businesses where regex missed)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 2b: LLM OWNER EXTRACTION (Haiku — filling regex gaps)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const needsLlm = enrichedBusinesses.filter(b =>
    b.website && !b.ownerFirstName && !b.website.includes('facebook.com') && !b.website.includes('instagram.com')
  );
  console.log(`  ${needsLlm.length} businesses need LLM extraction (regex found nothing)\n`);

  for (const business of needsLlm) {
    const label = `${(business.name || '').substring(0, 40).padEnd(40)}`;
    try {
      const result = await extractOwnersFromWebsite(business.name, business.website);
      if (!result) {
        console.log(`  NOFETCH  ${label}`);
        continue;
      }

      STATS.llmProcessed++;
      STATS.llmInputTokens += result.inputTokens;
      STATS.llmOutputTokens += result.outputTokens;

      if (result.owners.length > 0) {
        const best = result.owners[0];
        const parts = best.name.trim().split(/\s+/);
        business.ownerFirstName = parts[0];
        business.ownerLastName = parts.slice(1).join(' ');
        business.usedFallbackName = false;
        business.llmExtraction = result;
        STATS.llmNamesFound++;
        STATS.namesFound++;
        console.log(`  FOUND ${label} ${best.name} (${best.title})`);
      } else {
        console.log(`  ---   ${label} no names found`);
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ERR   ${label} ${err.message.substring(0, 60)}`);
    }
  }

  // Close browser if LLM extraction used it
  try { await closeBrowser(); } catch (e) {}

  const llmCost = ((STATS.llmInputTokens / 1_000_000) * 0.80 + (STATS.llmOutputTokens / 1_000_000) * 4.00);
  console.log(`\n  LLM processed: ${STATS.llmProcessed}, Names found: ${STATS.llmNamesFound}, Cost: $${llmCost.toFixed(3)}\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 3: SMART EMAIL VERIFICATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 3: SMART EMAIL VERIFICATION');
  console.log('  Website-scraped emails = auto-valid | Others = Reoon API');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const business of enrichedBusinesses) {
    if (!business.email) continue;
    if (!isValidEmail(business.email)) {
      business.email = null;
      business.emailVerified = false;
      continue;
    }

    // Website-scraped emails are auto-valid
    if (business.emailSource === 'website-scraping') {
      business.emailVerified = true;
      STATS.emailsAutoValid++;
      continue;
    }

    // Verify via Reoon for pattern/API emails
    try {
      const result = await verifyEmail(business.email, 'quick');
      if (result.isValid) {
        business.emailVerified = true;
        STATS.emailsReoonValid++;
      } else if (result.status === 'risky') {
        business.emailVerified = false;
        STATS.emailsReoonRisky++;
        // Keep the email but mark unverified — user can decide
      } else {
        business.emailVerified = false;
        business.email = null; // Drop invalid emails
        STATS.emailsReoonInvalid++;
      }
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      // On error, keep email but mark unverified
      business.emailVerified = false;
    }
  }

  const totalVerified = STATS.emailsAutoValid + STATS.emailsReoonValid;
  console.log(`  Auto-valid (website):  ${STATS.emailsAutoValid}`);
  console.log(`  Reoon valid:           ${STATS.emailsReoonValid}`);
  console.log(`  Reoon risky:           ${STATS.emailsReoonRisky}`);
  console.log(`  Reoon invalid:         ${STATS.emailsReoonInvalid}`);
  console.log(`  Total verified:        ${totalVerified}\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 4: REVENUE ESTIMATION & TIER ASSIGNMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 4: REVENUE ESTIMATION & TIER ASSIGNMENT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (let i = 0; i < enrichedBusinesses.length; i++) {
    const business = enrichedBusinesses[i];
    const label = `[${i + 1}/${enrichedBusinesses.length}] ${(business.name || '').substring(0, 40).padEnd(40)}`;

    try {
      const revenueEstimate = await estimateRevenue(business);
      business.estimatedRevenue = revenueEstimate.estimatedRevenue;
      business.revenueBand = revenueEstimate.revenueBand;
      business.revenueConfidence = revenueEstimate.confidence;

      const tier = assignTier(business.estimatedRevenue);
      business.assignedOfferTier = tier.tierId;
      business.setupFee = tier.setupFee;
      business.monthlyPrice = tier.monthlyPrice;

      STATS.revenueEstimated++;
      console.log(`  ${label} ${business.revenueBand} → ${tier.tierId}`);
    } catch (err) {
      business.assignedOfferTier = 'tier1';
      business.estimatedRevenue = 80000;
      business.revenueBand = 'under-150k';
      business.revenueConfidence = 'low';
      console.log(`  ${label} (default tier1 — ${err.message.substring(0, 40)})`);
    }

    // Generate merge variables
    business.mergeVariables = getAllMergeVariables(business);
  }

  console.log(`\n  Revenue estimated: ${STATS.revenueEstimated}/${enrichedBusinesses.length}\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 5: SAVE TO DATABASE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('STEP 5: SAVING TO DATABASE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const business of enrichedBusinesses) {
    try {
      saveBusiness({
        name: business.name,
        businessName: business.name,
        location: LOCATION,
        postcode: business.postcode || POSTCODE,
        address: business.address,
        website: business.website,
        phone: business.phone,
        category: business.category,
        rating: business.rating,
        reviewCount: business.reviewCount,
        ownerFirstName: business.ownerFirstName,
        ownerLastName: business.ownerLastName,
        ownerEmail: business.email,
        emailSource: business.emailSource,
        emailVerified: business.emailVerified,
        estimatedRevenue: business.estimatedRevenue,
        revenueBand: business.revenueBand,
        revenueConfidence: business.revenueConfidence,
        assignedOfferTier: business.assignedOfferTier,
        setupFee: business.setupFee,
        monthlyPrice: business.monthlyPrice,
        owners: business.owners,
        llmExtraction: business.llmExtraction || undefined
      }, {
        status: 'enriched',
        location: LOCATION,
        postcode: POSTCODE,
        scrapedAt: new Date().toISOString(),
        enrichedAt: new Date().toISOString()
      });
      STATS.savedToDb++;
    } catch (err) {
      console.log(`  DB ERROR: ${business.name} — ${err.message}`);
    }
  }

  console.log(`  Saved ${STATS.savedToDb} businesses to database\n`);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 6: EXPORT TO LEMLIST (unless --scrape-only)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!SCRAPE_ONLY) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 6: EXPORTING TO LEMLIST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const exportedEmails = new Set();

    for (const business of enrichedBusinesses) {
      if (!business.email || !business.emailVerified) {
        STATS.exportSkipped++;
        continue;
      }

      if (exportedEmails.has(business.email.toLowerCase())) {
        STATS.exportSkipped++;
        continue;
      }

      try {
        const mv = business.mergeVariables;
        await addLeadToCampaign(CAMPAIGN_ID, {
          email: business.email,
          firstName: mv.firstName,
          lastName: mv.lastName,
          companyName: mv.companyName,
          phone: business.phone,
          companyDomain: business.website ? (() => { try { return new URL(business.website).hostname.replace(/^www\./, ''); } catch { return null; } })() : null,
          timezone: 'Europe/London',
          businessType: mv.businessType,
          location: mv.location,
          localIntro: mv.localIntro,
          observationSignal: mv.observationSignal,
          meetingOption: mv.meetingOption,
          microOfferPrice: mv.microOfferPrice,
          multiOwnerNote: mv.multiOwnerNote || '',
          noNameNote: mv.noNameNote || ''
        });

        exportedEmails.add(business.email.toLowerCase());
        STATS.exported++;
        console.log(`  OK    ${business.name} → ${logger.sanitizeData(business.email)} (${business.assignedOfferTier})`);
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        if (err.message.includes('DUPLICATE') || err.message.includes('already exist')) {
          STATS.exportSkipped++;
        } else {
          STATS.exportErrors++;
          console.log(`  ERR   ${business.name}: ${err.message}`);
        }
      }
    }

    console.log(`\n  Exported: ${STATS.exported}, Skipped: ${STATS.exportSkipped}, Errors: ${STATS.exportErrors}\n`);
  } else {
    console.log('  Skipping Lemlist export (--scrape-only mode)\n');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SUMMARY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`  Location:              ${LOCATION}, ${POSTCODE}`);
  console.log(`  Categories searched:   ${STATS.categoriesSearched}`);
  console.log(`  Duration:              ${duration}s\n`);

  console.log('  --- Scraping ---');
  console.log(`  Total scraped:         ${STATS.totalScraped}`);
  console.log(`  Chains filtered:       ${STATS.chainsFiltered}`);
  console.log(`  Duplicates removed:    ${STATS.duplicatesRemoved}`);
  console.log(`  Unique businesses:     ${STATS.uniqueBusinesses}\n`);

  console.log('  --- Enrichment ---');
  console.log(`  With website:          ${STATS.withWebsite}`);
  console.log(`  Names found (total):   ${STATS.namesFound}`);
  console.log(`    Regex:               ${STATS.namesFound - STATS.llmNamesFound}`);
  console.log(`    LLM (Haiku):         ${STATS.llmNamesFound} ($${((STATS.llmInputTokens / 1_000_000) * 0.80 + (STATS.llmOutputTokens / 1_000_000) * 4.00).toFixed(3)})`);
  console.log(`  Emails found:          ${STATS.emailsFound}\n`);

  console.log('  --- Email Verification ---');
  console.log(`  Auto-valid (website):  ${STATS.emailsAutoValid}`);
  console.log(`  Reoon valid:           ${STATS.emailsReoonValid}`);
  console.log(`  Reoon risky:           ${STATS.emailsReoonRisky}`);
  console.log(`  Reoon invalid:         ${STATS.emailsReoonInvalid}\n`);

  console.log('  --- Output ---');
  console.log(`  Saved to DB:           ${STATS.savedToDb}`);
  if (!SCRAPE_ONLY) {
    console.log(`  Exported to Lemlist:   ${STATS.exported}`);
  }
  console.log();

  // Category breakdown
  const byCat = {};
  for (const b of enrichedBusinesses) {
    const cat = b.category || 'unknown';
    if (!byCat[cat]) byCat[cat] = { total: 0, withEmail: 0, verified: 0 };
    byCat[cat].total++;
    if (b.email) byCat[cat].withEmail++;
    if (b.emailVerified) byCat[cat].verified++;
  }

  console.log('  --- By Category ---');
  console.log(`  ${'Category'.padEnd(25)} Total  Email  Verified`);
  for (const [cat, counts] of Object.entries(byCat).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${cat.padEnd(25)} ${String(counts.total).padStart(5)}  ${String(counts.withEmail).padStart(5)}  ${String(counts.verified).padStart(8)}`);
  }
  console.log();
}

run().then(() => {
  console.log('Done.\n');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
