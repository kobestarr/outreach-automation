#!/usr/bin/env node

/**
 * Football Clubs/Academies Scraper — UFH Campaign
 *
 * Scrapes youth football clubs and academies via Outscraper,
 * saves to DB with ufh-football-clubs campaign tag, deduplicates across locations.
 *
 * Usage:
 *   node explore-football-clubs.js --dry-run       # Show what would be searched
 *   node explore-football-clubs.js --scrape-only    # Scrape + save to DB (no enrichment)
 *   node explore-football-clubs.js                  # Full: scrape + enrich + save
 */

const path = require('path');
const fs = require('fs');
const { initDatabase, saveBusiness, checkDuplicate, closeDatabase, getBusinessStats } = require('./ksd/local-outreach/orchestrator/modules/database');

// Load credentials
const credPath = path.join(process.env.HOME, '.credentials', 'api-keys.json');
const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
const API_KEY = credentials.outscraper.apiKey;

// CLI flags
const DRY_RUN = process.argv.includes('--dry-run');
const SCRAPE_ONLY = process.argv.includes('--scrape-only');

const CAMPAIGN = 'ufh-football-clubs';

// Search terms — targeting youth/kids football organisations
const SEARCH_TERMS = [
  'youth football club',
  'junior football club',
  'football academy',
  'kids football coaching',
  'football training for children',
  'mini soccer',
];

// Locations to scrape — each gets all search terms
const LOCATIONS = [
  { name: 'Bramhall', postcode: 'SK7' },
  { name: 'Poynton', postcode: 'SK12' },
];

async function searchOutscraper(query, location) {
  const fullQuery = `${query} ${location.name.toLowerCase()}, ${location.postcode.toLowerCase()}`;
  const url = `https://api.outscraper.com/maps/search-v3?query=${encodeURIComponent(fullQuery)}&limit=500`;

  console.log(`  Submitting: "${fullQuery}"`);

  const submitRes = await fetch(url, {
    headers: { 'X-API-KEY': API_KEY }
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`Submit failed (${submitRes.status}): ${text}`);
  }

  const submitData = await submitRes.json();
  const jobId = submitData.id;
  console.log(`  Job ID: ${jobId} — polling...`);

  // Poll for results
  let delay = 2000;
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, delay));

    const pollRes = await fetch(`https://api.outscraper.cloud/requests/${jobId}`, {
      headers: { 'X-API-KEY': API_KEY }
    });

    if (!pollRes.ok) {
      console.log(`  Poll attempt ${attempt} failed (${pollRes.status}), retrying...`);
      delay = Math.min(delay * 1.5, 16000);
      continue;
    }

    const pollData = await pollRes.json();

    if (pollData.status === 'Success' || pollData.status === 'Completed') {
      const results = pollData.data?.[0] || [];
      return results;
    }

    if (pollData.status === 'Error') {
      throw new Error(`Job failed: ${JSON.stringify(pollData)}`);
    }

    console.log(`  Poll ${attempt}/${maxAttempts} — status: ${pollData.status}`);
    delay = Math.min(delay * 1.5, 16000);
  }

  throw new Error('Timeout waiting for results');
}

async function main() {
  console.log(`\n=== Football Clubs/Academies — ${CAMPAIGN} ===\n`);

  const totalQueries = SEARCH_TERMS.length * LOCATIONS.length;

  if (DRY_RUN) {
    console.log('DRY RUN — no API calls will be made\n');
    for (const loc of LOCATIONS) {
      console.log(`Location: ${loc.name} (${loc.postcode})`);
      for (const term of SEARCH_TERMS) {
        console.log(`  - "${term} ${loc.name.toLowerCase()}, ${loc.postcode.toLowerCase()}"`);
      }
      console.log('');
    }
    console.log(`Total queries: ${totalQueries}`);
    console.log(`Estimated cost: ~$${(totalQueries * 30 * 0.002).toFixed(2)} (assuming ~30 results each)`);
    console.log(`Campaign tag: ${CAMPAIGN}`);
    console.log('\nRun without --dry-run to execute.\n');
    return;
  }

  // Initialize DB
  initDatabase();

  const allResults = new Map(); // placeId -> business (dedup across locations + terms)
  const perQueryCounts = [];
  const duplicatesInDB = [];

  for (const loc of LOCATIONS) {
    console.log(`\n========== ${loc.name} (${loc.postcode}) ==========`);

    for (const term of SEARCH_TERMS) {
      console.log(`\n--- "${term}" in ${loc.name} ---`);

      try {
        const results = await searchOutscraper(term, loc);
        const counts = { location: loc.name, term, total: results.length, new: 0, dupeInRun: 0, dupeInDB: 0 };

        for (const biz of results) {
          const placeId = biz.place_id || `${biz.name}_${biz.full_address}`;

          // Dedup within this run (across terms + locations)
          if (allResults.has(placeId)) {
            counts.dupeInRun++;
            continue;
          }

          // Check if already in DB (from KSD or other campaigns)
          const existingId = checkDuplicate({
            name: biz.name,
            postcode: biz.postal_code,
            website: biz.website,
            address: biz.address,
          });

          if (existingId) {
            counts.dupeInDB++;
            duplicatesInDB.push({ name: biz.name, existingId, placeId });
          }

          allResults.set(placeId, {
            name: biz.name,
            businessName: biz.name,
            category: biz.type || biz.category || 'youth football club',
            address: biz.address,
            postcode: biz.postal_code,
            phone: biz.phone,
            website: biz.website,
            email: biz.email,
            rating: biz.rating,
            reviewCount: biz.reviews,
            placeId: placeId,
            searchTerm: term,
            searchLocation: loc.name,
            searchPostcode: loc.postcode,
          });
          counts.new++;
        }

        console.log(`  Found: ${results.length} total | ${counts.new} new | ${counts.dupeInRun} dupe (this run) | ${counts.dupeInDB} dupe (in DB)`);
        perQueryCounts.push(counts);
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        perQueryCounts.push({ location: loc.name, term, total: 0, new: 0, dupeInRun: 0, dupeInDB: 0, error: err.message });
      }
    }
  }

  // Summary
  console.log('\n\n=== SCRAPE SUMMARY ===\n');
  console.log('Per query:');
  for (const c of perQueryCounts) {
    if (c.error) {
      console.log(`  ${c.location} / "${c.term}" — ERROR: ${c.error}`);
    } else {
      console.log(`  ${c.location} / "${c.term}" — ${c.total} total, ${c.new} new unique, ${c.dupeInRun} dupe(run), ${c.dupeInDB} dupe(DB)`);
    }
  }

  console.log(`\nTotal unique clubs/academies found: ${allResults.size}`);

  if (duplicatesInDB.length > 0) {
    console.log(`\nAlready in DB (from other campaigns): ${duplicatesInDB.length}`);
    for (const d of duplicatesInDB.slice(0, 10)) {
      console.log(`  - ${d.name} (existing ID: ${d.existingId})`);
    }
    if (duplicatesInDB.length > 10) console.log(`  ... and ${duplicatesInDB.length - 10} more`);
  }

  // Breakdown stats
  const byLocation = {};
  const withWebsite = [];
  const withEmail = [];
  const withPhone = [];

  for (const [, biz] of allResults) {
    const loc = biz.searchLocation || 'Unknown';
    byLocation[loc] = (byLocation[loc] || 0) + 1;
    if (biz.website) withWebsite.push(biz);
    if (biz.email) withEmail.push(biz);
    if (biz.phone) withPhone.push(biz);
  }

  console.log('\nBy search location:');
  for (const [loc, count] of Object.entries(byLocation)) {
    console.log(`  ${loc}: ${count}`);
  }

  console.log(`\nWith website: ${withWebsite.length}`);
  console.log(`With email (from Google): ${withEmail.length}`);
  console.log(`With phone: ${withPhone.length}`);

  // Save to DB
  console.log('\n=== SAVING TO DATABASE ===\n');
  let saved = 0;
  let updated = 0;

  for (const [, biz] of allResults) {
    const existingId = checkDuplicate(biz);
    const id = saveBusiness(biz, {
      location: biz.searchLocation,
      postcode: biz.postcode || biz.searchPostcode,
      status: 'scraped',
      scrapedAt: new Date().toISOString(),
      enrichedAt: null,
      campaigns: [CAMPAIGN],
    });

    if (existingId) {
      updated++;
    } else {
      saved++;
    }
  }

  console.log(`  New records: ${saved}`);
  console.log(`  Updated (campaign tag added): ${updated}`);

  // Campaign stats
  const stats = getBusinessStats({ campaign: CAMPAIGN });
  console.log(`\n${CAMPAIGN} campaign now has: ${stats.total} businesses`);

  // Save raw results as JSON too
  const outputPath = path.join(__dirname, 'exports', `${CAMPAIGN}-exploration.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = {
    timestamp: new Date().toISOString(),
    campaign: CAMPAIGN,
    locations: LOCATIONS,
    searchTerms: SEARCH_TERMS,
    totalUnique: allResults.size,
    perQueryCounts,
    duplicatesInDB: duplicatesInDB.length,
    businesses: Array.from(allResults.values()),
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Raw results saved to: exports/${CAMPAIGN}-exploration.json`);

  // Print sample
  console.log('\n--- Sample clubs (first 15) ---\n');
  const sample = Array.from(allResults.values()).slice(0, 15);
  for (const biz of sample) {
    console.log(`  ${biz.name} [${biz.searchLocation}]`);
    console.log(`    ${biz.address || 'No address'} | ${biz.postcode || ''}`);
    console.log(`    Web: ${biz.website || 'None'} | Phone: ${biz.phone || 'None'} | Rating: ${biz.rating || 'N/A'} (${biz.reviewCount || 0} reviews)`);
    console.log('');
  }

  console.log(`\nNext steps:`);
  console.log(`  1. Review results in exports/${CAMPAIGN}-exploration.json`);
  console.log(`  2. Export as CSV: node export-campaign.js --campaign=${CAMPAIGN} --format=csv`);
  console.log(`  3. To enrich with website data: add --enrich flag (not yet implemented)\n`);

  closeDatabase();
}

main().catch(err => {
  console.error('Fatal error:', err);
  closeDatabase();
  process.exit(1);
});
