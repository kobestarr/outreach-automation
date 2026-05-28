#!/usr/bin/env node

/**
 * Area Business Scraper — KSD / David Wood trades / Private medical
 *
 * Expands the South-Manchester local-outreach scrape outward (tiered areas)
 * and across three verticals, each tagged into its own campaign. Models the
 * Outscraper submit/poll + dedup + campaign-tag flow from explore-football-clubs.js.
 *
 * Verticals (each → its own campaign tag):
 *   broad   → ksd-local-2026                  (all professional/consumer/service/lifestyle types)
 *   trades  → local-trades-david-wood-2026    (trades only; cleaning/window/gutter/carpet EXCLUDED to protect David Wood)
 *   medical → medical-private-website-2026     (private healthcare practices; emails come from website scraping, NOT Consulti — see reference-consulti-coverage-gaps)
 *
 * Area tiers:
 *   1   affluent Cheshire belt (Wilmslow, Alderley Edge, Hale, Altrincham, Knutsford...)
 *   2   + South Manchester suburbs (Didsbury, Chorlton, Sale, Marple, Poynton...)
 *   3   + reach (Macclesfield, Stockport core, Manchester city centre)
 *   all everything
 *
 * Usage:
 *   node explore-area-businesses.js --vertical=trades --tier=1 --dry-run
 *   node explore-area-businesses.js --vertical=medical --tier=all --dry-run
 *   node explore-area-businesses.js --vertical=broad --tier=2
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
const VERTICAL = (process.argv.find(a => a.startsWith('--vertical=')) || '').split('=')[1] || 'trades';
const TIER = (process.argv.find(a => a.startsWith('--tier=')) || '').split('=')[1] || '1';

// --- Vertical definitions: campaign tag + search terms ---
const VERTICALS = {
  broad: {
    campaign: 'ksd-local-2026',
    terms: [
      // professional / B2B
      'accountant', 'solicitor', 'commercial lawyer', 'estate agent', 'financial advisor',
      'insurance broker', 'mortgage broker', 'business consultant', 'IT support company',
      'recruitment agency', 'architect', 'surveyor', 'manufacturer', 'wholesaler',
      // consumer / lifestyle
      'restaurant', 'cafe', 'deli', 'farm shop', 'gym', 'yoga studio', 'pilates studio',
      'personal trainer', 'hair salon', 'barber', 'nail bar', 'beauty salon', 'florist',
      'car mechanic', 'tutor', 'nursery', 'driving instructor',
      // services
      'photographer', 'videographer', 'interior designer', 'web designer', 'counsellor',
      'caterer', 'removal company', 'wedding venue', 'event planner',
    ],
  },
  trades: {
    campaign: 'local-trades-david-wood-2026',
    terms: [
      // core trades
      'plumber', 'electrician', 'roofer', 'builder', 'gardener', 'landscaper',
      'painter and decorator', 'joiner', 'plasterer', 'tiler', 'kitchen fitter',
      'bathroom fitter', 'locksmith', 'handyman', 'driveway paving', 'fencing contractor',
      'heating engineer', 'boiler installer', 'tree surgeon', 'pest control',
      // new high-value trades
      'scaffolder', 'glazier', 'EV charger installer', 'solar panel installer',
      'damp proofing specialist', 'loft conversion company', 'house extension builder',
      'garden room company', 'drainage contractor', 'garage door company',
      'blinds and shutters', 'CCTV installer', 'home AV installer',
    ],
  },
  medical: {
    campaign: 'medical-private-website-2026',
    terms: [
      'cosmetic dentist', 'dental implant clinic', 'orthodontist', 'private dentist',
      'private physiotherapist', 'sports injury clinic', 'aesthetic clinic', 'botox clinic',
      'skin clinic', 'dermatologist', 'plastic surgery clinic', 'cosmetic surgery clinic',
      'osteopath', 'chiropractor', 'podiatrist', 'private GP', 'psychologist',
      'psychotherapist', 'private clinic',
    ],
  },
};

// Categories never wanted in the David Wood trades campaign (cleaning competitors)
const TRADES_EXCLUDE = /clean|window|gutter|carpet|jet ?wash|pressure ?wash/i;

// --- Area tiers ---
const TIER_LOCATIONS = {
  1: [
    { name: 'Wilmslow', postcode: 'SK9' },
    { name: 'Alderley Edge', postcode: 'SK9' },
    { name: 'Prestbury', postcode: 'SK10' },
    { name: 'Knutsford', postcode: 'WA16' },
    { name: 'Hale', postcode: 'WA15' },
    { name: 'Hale Barns', postcode: 'WA15' },
    { name: 'Bowdon', postcode: 'WA14' },
    { name: 'Altrincham', postcode: 'WA14' },
  ],
  2: [
    { name: 'Didsbury', postcode: 'M20' },
    { name: 'Chorlton', postcode: 'M21' },
    { name: 'Sale', postcode: 'M33' },
    { name: 'Marple', postcode: 'SK6' },
    { name: 'Poynton', postcode: 'SK12' },
    { name: 'Heaton Moor', postcode: 'SK4' },
    { name: 'Heaton Mersey', postcode: 'SK4' },
  ],
  3: [
    { name: 'Macclesfield', postcode: 'SK11' },
    { name: 'Stockport', postcode: 'SK1' },
    { name: 'Stockport', postcode: 'SK3' },
    { name: 'Manchester city centre', postcode: 'M1' },
    { name: 'Manchester', postcode: 'M2' },
    { name: 'Manchester', postcode: 'M4' },
  ],
};

function getLocations(tier) {
  if (tier === 'all') return [...TIER_LOCATIONS[1], ...TIER_LOCATIONS[2], ...TIER_LOCATIONS[3]];
  if (tier === '2') return [...TIER_LOCATIONS[1], ...TIER_LOCATIONS[2]];
  if (tier === '3') return [...TIER_LOCATIONS[1], ...TIER_LOCATIONS[2], ...TIER_LOCATIONS[3]];
  return TIER_LOCATIONS[1];
}

const verticalConfig = VERTICALS[VERTICAL];
if (!verticalConfig) {
  console.error(`ERROR: Unknown vertical "${VERTICAL}". Use: ${Object.keys(VERTICALS).join(', ')}`);
  process.exit(1);
}
const CAMPAIGN = verticalConfig.campaign;
const SEARCH_TERMS = verticalConfig.terms;
const LOCATIONS = getLocations(TIER);

async function searchOutscraper(query, location) {
  const fullQuery = `${query} ${location.name.toLowerCase()}, ${location.postcode.toLowerCase()}`;
  const url = `https://api.outscraper.com/maps/search-v3?query=${encodeURIComponent(fullQuery)}&limit=500`;
  console.log(`  Submitting: "${fullQuery}"`);

  const submitRes = await fetch(url, { headers: { 'X-API-KEY': API_KEY } });
  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`Submit failed (${submitRes.status}): ${text}`);
  }
  const jobId = (await submitRes.json()).id;
  console.log(`  Job ID: ${jobId} — polling...`);

  let delay = 2000;
  for (let attempt = 1; attempt <= 30; attempt++) {
    await new Promise(r => setTimeout(r, delay));
    const pollRes = await fetch(`https://api.outscraper.cloud/requests/${jobId}`, { headers: { 'X-API-KEY': API_KEY } });
    if (!pollRes.ok) { delay = Math.min(delay * 1.5, 16000); continue; }
    const pollData = await pollRes.json();
    if (pollData.status === 'Success' || pollData.status === 'Completed') return pollData.data?.[0] || [];
    if (pollData.status === 'Error') throw new Error(`Job failed: ${JSON.stringify(pollData)}`);
    console.log(`  Poll ${attempt}/30 — status: ${pollData.status}`);
    delay = Math.min(delay * 1.5, 16000);
  }
  throw new Error('Timeout waiting for results');
}

async function main() {
  console.log(`\n=== Area Scraper — ${VERTICAL} → ${CAMPAIGN} (tier ${TIER}) ===\n`);
  console.log(`Locations: ${LOCATIONS.length} | Terms: ${SEARCH_TERMS.length}`);
  const totalQueries = SEARCH_TERMS.length * LOCATIONS.length;

  if (DRY_RUN) {
    console.log('DRY RUN — no API calls\n');
    console.log('Locations:');
    LOCATIONS.forEach(l => console.log(`  ${l.name} (${l.postcode})`));
    console.log('\nSearch terms:');
    SEARCH_TERMS.forEach(t => console.log(`  ${t}`));
    console.log(`\nTotal queries: ${totalQueries}`);
    console.log(`Estimated cost: ~$${(totalQueries * 30 * 0.002).toFixed(2)} (assuming ~30 results each)`);
    console.log(`Campaign tag: ${CAMPAIGN}`);
    if (VERTICAL === 'trades') console.log(`Cleaning exclusion active: ${TRADES_EXCLUDE}`);
    console.log('\nRun without --dry-run to execute.\n');
    return;
  }

  initDatabase();
  const allResults = new Map();
  const perQueryCounts = [];
  let excludedCleaning = 0;

  for (const loc of LOCATIONS) {
    console.log(`\n========== ${loc.name} (${loc.postcode}) ==========`);
    for (const term of SEARCH_TERMS) {
      console.log(`\n--- "${term}" in ${loc.name} ---`);
      try {
        const results = await searchOutscraper(term, loc);
        const counts = { location: loc.name, term, total: results.length, new: 0, dupeInRun: 0, dupeInDB: 0, excluded: 0 };
        for (const biz of results) {
          const category = biz.type || biz.category || term;
          // Trades: never include cleaning competitors (protect David Wood)
          if (VERTICAL === 'trades' && (TRADES_EXCLUDE.test(category) || TRADES_EXCLUDE.test(biz.name || ''))) {
            counts.excluded++; excludedCleaning++; continue;
          }
          const placeId = biz.place_id || `${biz.name}_${biz.full_address}`;
          if (allResults.has(placeId)) { counts.dupeInRun++; continue; }
          if (checkDuplicate({ name: biz.name, postcode: biz.postal_code, website: biz.website, address: biz.address })) counts.dupeInDB++;
          allResults.set(placeId, {
            name: biz.name, businessName: biz.name, category,
            address: biz.address, postcode: biz.postal_code, phone: biz.phone,
            website: biz.website, email: biz.email, rating: biz.rating, reviewCount: biz.reviews,
            placeId, searchTerm: term, searchLocation: loc.name, searchPostcode: loc.postcode,
          });
          counts.new++;
        }
        console.log(`  Found: ${results.length} | ${counts.new} new | ${counts.dupeInRun} dupe(run) | ${counts.dupeInDB} dupe(DB) | ${counts.excluded} excluded`);
        perQueryCounts.push(counts);
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        perQueryCounts.push({ location: loc.name, term, error: err.message });
      }
    }
  }

  console.log('\n\n=== SCRAPE SUMMARY ===');
  console.log(`Total unique businesses: ${allResults.size}`);
  if (VERTICAL === 'trades') console.log(`Cleaning competitors excluded: ${excludedCleaning}`);

  if (SCRAPE_ONLY) {
    console.log('\n--scrape-only: not writing to DB.');
    closeDatabase();
    return;
  }

  let saved = 0, updated = 0;
  for (const [, biz] of allResults) {
    const existingId = checkDuplicate(biz);
    saveBusiness(biz, {
      location: biz.searchLocation,
      postcode: biz.postcode || biz.searchPostcode,
      status: 'scraped',
      scrapedAt: new Date().toISOString(),
      enrichedAt: null,
      campaigns: [CAMPAIGN],
    });
    if (existingId) updated++; else saved++;
  }
  console.log(`\nNew records: ${saved} | Updated (tag added): ${updated}`);
  console.log(`${CAMPAIGN} now has: ${getBusinessStats({ campaign: CAMPAIGN }).total} businesses`);

  const outputPath = path.join(__dirname, 'exports', `${CAMPAIGN}-tier${TIER}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(), vertical: VERTICAL, campaign: CAMPAIGN, tier: TIER,
    locations: LOCATIONS, searchTerms: SEARCH_TERMS, totalUnique: allResults.size,
    excludedCleaning, perQueryCounts, businesses: Array.from(allResults.values()),
  }, null, 2));
  console.log(`Raw results: exports/${CAMPAIGN}-tier${TIER}.json`);

  console.log(`\nNext: node enrich-campaign.js --campaign=${CAMPAIGN}  (website scrape + LLM emails)`);
  closeDatabase();
}

main().catch(err => { console.error('Fatal error:', err); closeDatabase(); process.exit(1); });
