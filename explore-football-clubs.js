#!/usr/bin/env node

/**
 * Football Clubs/Academies Scraper — UFH Campaign
 *
 * Scrapes youth football clubs and academies via Outscraper,
 * saves to DB with campaign tag, deduplicates across locations.
 *
 * Usage:
 *   node explore-football-clubs.js --dry-run                    # Show what would be searched (default: GM+EC)
 *   node explore-football-clubs.js --scrape-only                # Scrape + save to DB (no enrichment)
 *   node explore-football-clubs.js                              # Full: scrape + save
 *   node explore-football-clubs.js --area=chelsea               # Chelsea/West London area
 *   node explore-football-clubs.js --area=gm                    # Greater Manchester + East Cheshire (default)
 *   node explore-football-clubs.js --area=original              # Original Bramhall + Poynton only
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
const AREA_ARG = (process.argv.find(a => a.startsWith('--area=')) || '').split('=')[1] || 'gm';

// Search terms — targeting youth/kids football organisations
const SEARCH_TERMS = [
  'youth football club',
  'junior football club',
  'football academy',
  'kids football coaching',
  'football training for children',
  'mini soccer',
];

// --- Area configurations ---

const AREAS = {
  original: {
    campaign: 'ufh-football-clubs',
    locations: [
      { name: 'Bramhall', postcode: 'SK7' },
      { name: 'Poynton', postcode: 'SK12' },
    ],
  },
  gm: {
    campaign: 'ufh-football-clubs',
    locations: [
      // Original
      { name: 'Bramhall', postcode: 'SK7' },
      { name: 'Poynton', postcode: 'SK12' },
      // Stockport borough
      { name: 'Stockport', postcode: 'SK1' },
      { name: 'Cheadle', postcode: 'SK8' },
      { name: 'Marple', postcode: 'SK6' },
      { name: 'Romiley', postcode: 'SK6' },
      { name: 'Hazel Grove', postcode: 'SK7' },
      { name: 'Heaton Moor', postcode: 'SK4' },
      // East Cheshire
      { name: 'Macclesfield', postcode: 'SK10' },
      { name: 'Wilmslow', postcode: 'SK9' },
      { name: 'Alderley Edge', postcode: 'SK9' },
      { name: 'Knutsford', postcode: 'WA16' },
      { name: 'Congleton', postcode: 'CW12' },
      { name: 'Sandbach', postcode: 'CW11' },
      { name: 'Nantwich', postcode: 'CW5' },
      // Tameside
      { name: 'Ashton-under-Lyne', postcode: 'OL6' },
      { name: 'Hyde', postcode: 'SK14' },
      { name: 'Denton', postcode: 'M34' },
      { name: 'Stalybridge', postcode: 'SK15' },
      { name: 'Droylsden', postcode: 'M43' },
      // Trafford
      { name: 'Sale', postcode: 'M33' },
      { name: 'Altrincham', postcode: 'WA14' },
      { name: 'Stretford', postcode: 'M32' },
      { name: 'Urmston', postcode: 'M41' },
      { name: 'Timperley', postcode: 'WA15' },
      // Other GM
      { name: 'Salford', postcode: 'M5' },
      { name: 'Bury', postcode: 'BL9' },
      { name: 'Rochdale', postcode: 'OL11' },
      { name: 'Oldham', postcode: 'OL1' },
      { name: 'Bolton', postcode: 'BL1' },
      { name: 'Wigan', postcode: 'WN1' },
      { name: 'Leigh', postcode: 'WN7' },
      // High Peak
      { name: 'Glossop', postcode: 'SK13' },
      { name: 'New Mills', postcode: 'SK22' },
      { name: 'Buxton', postcode: 'SK17' },
      { name: 'Chapel-en-le-Frith', postcode: 'SK23' },
    ],
  },
  chelsea: {
    campaign: 'ufh-chelsea-area-clubs',
    locations: [
      // Core Chelsea/Fulham area
      { name: 'Fulham', postcode: 'SW6' },
      { name: 'Chelsea', postcode: 'SW3' },
      { name: 'Hammersmith', postcode: 'W6' },
      { name: 'Wandsworth', postcode: 'SW18' },
      { name: 'Battersea', postcode: 'SW11' },
      { name: 'Putney', postcode: 'SW15' },
      { name: 'Parsons Green', postcode: 'SW6' },
      { name: 'Clapham', postcode: 'SW4' },
      { name: 'Brixton', postcode: 'SW2' },
      { name: 'Wimbledon', postcode: 'SW19' },
      { name: 'Kingston upon Thames', postcode: 'KT1' },
      { name: 'Richmond', postcode: 'TW9' },
      { name: 'Hounslow', postcode: 'TW3' },
      { name: 'Chiswick', postcode: 'W4' },
      { name: 'Kensington', postcode: 'W8' },
      { name: 'Earls Court', postcode: 'SW5' },
    ],
  },
};

const areaConfig = AREAS[AREA_ARG];
if (!areaConfig) {
  console.error(`ERROR: Unknown area "${AREA_ARG}". Use: ${Object.keys(AREAS).join(', ')}`);
  process.exit(1);
}

const CAMPAIGN = areaConfig.campaign;
const LOCATIONS = areaConfig.locations;

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
  console.log(`\n=== Football Clubs/Academies — ${CAMPAIGN} (${AREA_ARG}) ===\n`);
  console.log(`Area: ${AREA_ARG} — ${LOCATIONS.length} locations`);

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
  const outputPath = path.join(__dirname, 'exports', `${CAMPAIGN}-exploration-${AREA_ARG}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const output = {
    timestamp: new Date().toISOString(),
    campaign: CAMPAIGN,
    area: AREA_ARG,
    locations: LOCATIONS,
    searchTerms: SEARCH_TERMS,
    totalUnique: allResults.size,
    perQueryCounts,
    duplicatesInDB: duplicatesInDB.length,
    businesses: Array.from(allResults.values()),
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Raw results saved to: exports/${CAMPAIGN}-exploration-${AREA_ARG}.json`);

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
  console.log(`  1. Enrich: node enrich-campaign.js --campaign=${CAMPAIGN}`);
  console.log(`  2. Export CSV: node export-campaign.js --campaign=${CAMPAIGN} --has-email --clean`);
  console.log(`  3. Mailead CSV: node export-campaign.js --campaign=${CAMPAIGN} --has-email --clean --format=mailead\n`);

  closeDatabase();
}

main().catch(err => {
  console.error('Fatal error:', err);
  closeDatabase();
  process.exit(1);
});
