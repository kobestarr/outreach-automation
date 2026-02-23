#!/usr/bin/env node

/**
 * Campaign Enrichment Script
 *
 * Enriches businesses in a specific campaign with website data:
 * - Scrape websites for emails + contact names (regex)
 * - LLM extraction for businesses where regex found nothing
 * - Save enriched data back to DB
 *
 * Usage:
 *   node enrich-campaign.js --campaign=ufh-football-clubs             # Enrich all
 *   node enrich-campaign.js --campaign=ufh-football-clubs --limit=10  # Test with 10
 *   node enrich-campaign.js --campaign=ufh-football-clubs --llm-only  # Skip regex, just LLM
 *   node enrich-campaign.js --campaign=ufh-football-clubs --dry-run   # Show what would be enriched
 */

const path = require('path');
const { initDatabase, loadBusinesses, saveBusiness, getBusinessStats, closeDatabase } = require('./ksd/local-outreach/orchestrator/modules/database');
const { scrapeWebsite, parseName } = require('./shared/outreach-core/enrichment/website-scraper');
const { extractOwnersFromWebsite } = require('./shared/outreach-core/enrichment/llm-owner-extractor');

// Per-website timeout wrapper — auto-skips any site that takes too long
const SCRAPE_TIMEOUT_MS = 60000; // 60s max per website
const LLM_TIMEOUT_MS = 30000;    // 30s max per LLM call

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT after ${ms / 1000}s: ${label}`)), ms)
    ),
  ]);
}

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const CAMPAIGN = getArg('campaign');
const LIMIT = getArg('limit') ? parseInt(getArg('limit')) : null;
const LLM_ONLY = hasFlag('llm-only');
const DRY_RUN = hasFlag('dry-run');

if (!CAMPAIGN) {
  console.error('ERROR: --campaign=<name> is required');
  process.exit(1);
}

async function main() {
  console.log(`\n=== Enrichment: ${CAMPAIGN} ===\n`);

  initDatabase();

  // Load businesses for this campaign
  const allBusinesses = loadBusinesses({ campaign: CAMPAIGN });
  console.log(`Total in campaign: ${allBusinesses.length}`);

  // Filter to those with websites and not yet enriched
  let toEnrich = allBusinesses.filter(b => {
    const biz = b.business || {};
    const hasWebsite = biz.website &&
      !biz.website.includes('facebook.com') &&
      !biz.website.includes('instagram.com') &&
      !biz.website.includes('twitter.com');
    // Skip already enriched (has email or has been through LLM)
    const alreadyEnriched = biz.ownerFirstName || biz.ownerEmail || biz.email;
    return hasWebsite && !alreadyEnriched;
  });

  if (LIMIT) toEnrich = toEnrich.slice(0, LIMIT);

  console.log(`With website (not yet enriched): ${toEnrich.length}`);
  if (LIMIT) console.log(`Limited to: ${LIMIT}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN — would enrich:\n');
    for (const b of toEnrich.slice(0, 20)) {
      console.log(`  ${b.business?.name || b.business?.businessName} — ${b.business?.website}`);
    }
    if (toEnrich.length > 20) console.log(`  ... and ${toEnrich.length - 20} more`);
    console.log(`\nEstimated LLM cost: ~$${(toEnrich.length * 0.003).toFixed(2)}`);
    closeDatabase();
    return;
  }

  // Stats tracking
  const stats = {
    processed: 0,
    websiteScraped: 0,
    websiteFailed: 0,
    regexNamesFound: 0,
    regexEmailsFound: 0,
    llmProcessed: 0,
    llmNamesFound: 0,
    llmEmailsFound: 0,
    llmInputTokens: 0,
    llmOutputTokens: 0,
  };

  // Step 1: Website scraping + regex extraction
  if (!LLM_ONLY) {
    console.log('\n--- Step 1: Website Scraping + Regex Extraction ---\n');

    for (let i = 0; i < toEnrich.length; i++) {
      const b = toEnrich[i];
      const biz = b.business || {};
      const name = biz.name || biz.businessName || 'Unknown';
      const website = biz.website;

      process.stdout.write(`  [${i + 1}/${toEnrich.length}] ${name.substring(0, 40).padEnd(40)} `);

      try {
        const websiteData = await withTimeout(scrapeWebsite(website), SCRAPE_TIMEOUT_MS, website);
        stats.websiteScraped++;

        // Extract contact info
        const peopleWithEmails = (websiteData.ownerNames || []).filter(o => o.matchedEmail && o.hasEmailMatch);
        let ownerFirst = null, ownerLast = null, email = null;

        if (peopleWithEmails.length > 0) {
          // Use first person with email
          const best = peopleWithEmails[0];
          const parsed = parseName(best.name);
          ownerFirst = parsed.firstName;
          ownerLast = parsed.lastName;
          email = best.matchedEmail;
        } else {
          // Use first owner name + first email (might be separate people)
          if (websiteData.ownerNames?.length > 0) {
            const parsed = parseName(websiteData.ownerNames[0].name);
            ownerFirst = parsed.firstName;
            ownerLast = parsed.lastName;
          }
          email = websiteData.emails?.[0] || null;
        }

        // Update the business object
        if (ownerFirst) {
          biz.ownerFirstName = ownerFirst;
          biz.ownerLastName = ownerLast;
          stats.regexNamesFound++;
        }
        if (email) {
          biz.ownerEmail = email;
          biz.email = email;
          biz.emailSource = 'website-scraping';
          biz.emailVerified = true; // Website emails = auto-valid
          stats.regexEmailsFound++;
        }

        // Store all owners for reference
        if (websiteData.ownerNames?.length > 0) {
          biz.owners = websiteData.ownerNames.map(o => ({
            name: o.name,
            title: o.title,
            email: o.matchedEmail,
          }));
        }

        // Save back to DB
        saveBusiness(biz, {
          location: b.location,
          postcode: b.postcode,
          status: 'enriched',
          enrichedAt: new Date().toISOString(),
          campaigns: [CAMPAIGN],
        });

        const nameStr = ownerFirst ? `${ownerFirst} ${ownerLast || ''}`.trim() : '-';
        const emailStr = email || '-';
        console.log(`Name: ${nameStr} | Email: ${emailStr}`);

      } catch (err) {
        stats.websiteFailed++;
        console.log(`FAILED: ${err.message.substring(0, 60)}`);
      }

      stats.processed++;
    }
  }

  // Step 2: LLM extraction for businesses still missing contact names
  console.log('\n--- Step 2: LLM Contact Extraction ---\n');

  // Reload from DB to get updated data
  const refreshed = loadBusinesses({ campaign: CAMPAIGN });
  const needsLlm = refreshed.filter(b => {
    const biz = b.business || {};
    return biz.website &&
      !biz.ownerFirstName &&
      !biz.website.includes('facebook.com') &&
      !biz.website.includes('instagram.com');
  });

  const llmBatch = LIMIT ? needsLlm.slice(0, LIMIT) : needsLlm;
  console.log(`Businesses needing LLM extraction: ${llmBatch.length}\n`);

  for (let i = 0; i < llmBatch.length; i++) {
    const b = llmBatch[i];
    const biz = b.business || {};
    const name = biz.name || biz.businessName || 'Unknown';
    const website = biz.website;

    process.stdout.write(`  [${i + 1}/${llmBatch.length}] ${name.substring(0, 40).padEnd(40)} `);

    try {
      const result = await withTimeout(extractOwnersFromWebsite(name, website), LLM_TIMEOUT_MS, website);
      stats.llmProcessed++;

      if (!result) {
        console.log('No website text');
        continue;
      }

      stats.llmInputTokens += result.inputTokens || 0;
      stats.llmOutputTokens += result.outputTokens || 0;

      let ownerFirst = null, ownerLast = null;
      if (result.owners?.length > 0) {
        const best = result.owners[0];
        const parts = best.name.trim().split(/\s+/);
        ownerFirst = parts[0];
        ownerLast = parts.slice(1).join(' ');
        stats.llmNamesFound++;
      }

      // Check for emails from LLM
      let email = biz.ownerEmail || biz.email;
      if (!email && result.emails?.length > 0) {
        // Prefer personal emails
        const personal = result.emails.find(e => e.type === 'personal');
        email = personal?.email || result.emails[0].email;
        stats.llmEmailsFound++;
      }

      if (ownerFirst) {
        biz.ownerFirstName = ownerFirst;
        biz.ownerLastName = ownerLast;
      }
      if (email && !biz.ownerEmail) {
        biz.ownerEmail = email;
        biz.email = email;
        biz.emailSource = 'website-scraping';
        biz.emailVerified = true;
      }
      biz.llmExtraction = result;

      // Save back to DB
      saveBusiness(biz, {
        location: b.location,
        postcode: b.postcode,
        status: 'enriched',
        enrichedAt: new Date().toISOString(),
        campaigns: [CAMPAIGN],
      });

      const nameStr = ownerFirst ? `${ownerFirst} ${ownerLast || ''}`.trim() : '-';
      const emailStr = email || '-';
      console.log(`Name: ${nameStr} | Email: ${emailStr}`);

    } catch (err) {
      console.log(`ERROR: ${err.message.substring(0, 60)}`);
    }
  }

  // Summary
  const llmCost = (stats.llmInputTokens * 0.80 / 1_000_000) + (stats.llmOutputTokens * 4.00 / 1_000_000);

  console.log('\n\n=== ENRICHMENT SUMMARY ===\n');
  console.log(`Campaign: ${CAMPAIGN}`);
  console.log(`Websites scraped: ${stats.websiteScraped} (${stats.websiteFailed} failed)`);
  console.log(`Regex names found: ${stats.regexNamesFound}`);
  console.log(`Regex emails found: ${stats.regexEmailsFound}`);
  console.log(`LLM processed: ${stats.llmProcessed}`);
  console.log(`LLM names found: ${stats.llmNamesFound}`);
  console.log(`LLM emails found: ${stats.llmEmailsFound}`);
  console.log(`LLM cost: $${llmCost.toFixed(4)}`);

  // Final campaign stats
  const finalStats = getBusinessStats({ campaign: CAMPAIGN });
  console.log(`\n${CAMPAIGN} campaign:`);
  console.log(`  Total: ${finalStats.total}`);
  console.log(`  With email: ${finalStats.withEmail}`);
  console.log(`  Enriched: ${finalStats.byStatus?.enriched || 0}`);

  closeDatabase();
}

main().catch(err => {
  console.error('Fatal error:', err);
  closeDatabase();
  process.exit(1);
});
