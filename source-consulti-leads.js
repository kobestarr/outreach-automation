#!/usr/bin/env node

/**
 * Consulti Database Sourcing — replaces Outscraper for verticals Consulti covers.
 *
 * Uses POST /leads/search (the Consulti B2B database) to pull contacts by
 * keyword + city, returning name + email + LinkedIn + job title + company domain
 * directly. Costs 1 lead credit per RESULT returned; 0-result queries are FREE.
 * This is the productive way to burn the expiring lead credits.
 *
 * Discovered via live probe 2026-05-27 (no public docs):
 *   endpoint: POST https://www.consulti.ai/api/v1/leads/search
 *   body fields: q, titles, industries, countries, states, cities, company,
 *                empMin, empMax, emailStatus, excludeListId, page, size
 *   response: { leads:[...], total, total_after_exclusion, page, size, credits_used }
 *
 * Usage:
 *   node source-consulti-leads.js --vertical=trades --tier=1 --dry-run
 *   node source-consulti-leads.js --vertical=medical --tier=all --max-credits=500
 *   node source-consulti-leads.js --vertical=broad --tier=2 --max-credits=1000
 */

const consulti = require('./shared/outreach-core/email-verification/consulti-verifier');
const {
  initDatabase, saveBusiness, checkDuplicate, addCampaignToBusiness,
  closeDatabase, getBusinessStats,
} = require('./ksd/local-outreach/orchestrator/modules/database');

const BASE = 'https://www.consulti.ai/api/v1';
const KEY = consulti.getKey();
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const args = Object.fromEntries(process.argv.slice(2).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [[m[1], m[2] ?? true]] : [];
}));
const VERTICAL = args.vertical || 'trades';
const TIER = args.tier || '1';
const SIZE = parseInt(args.size || '25', 10);
const START_PAGE = parseInt(args['start-page'] || '1', 10);
const MAX_PAGES = parseInt(args['max-pages'] || '4', 10);
const MAX_CREDITS = parseInt(args['max-credits'] || '500', 10);
const DRY = !!args['dry-run'];

const VERTICALS = {
  broad: { campaign: 'ksd-local-2026', terms: [
    'accountant', 'solicitor', 'estate agent', 'financial advisor', 'mortgage broker',
    'business consultant', 'IT support', 'recruitment agency', 'architect', 'surveyor',
    'restaurant', 'cafe', 'gym', 'hair salon', 'barber', 'beauty salon', 'florist',
    'photographer', 'interior designer', 'web designer', 'caterer', 'wedding venue', 'event planner',
  ] },
  trades: { campaign: 'local-trades-david-wood-2026', terms: [
    'plumber', 'electrician', 'roofer', 'builder', 'landscaper', 'painter and decorator',
    'joiner', 'plasterer', 'tiler', 'kitchen fitter', 'bathroom fitter', 'locksmith',
    'heating engineer', 'tree surgeon', 'scaffolder', 'glazier', 'solar panel installer',
    'loft conversion', 'house extension', 'garden room', 'driveway', 'fencing contractor',
  ] },
  medical: { campaign: 'medical-private-website-2026', terms: [
    'cosmetic dentist', 'dental implant', 'orthodontist', 'private dentist',
    'private physiotherapist', 'aesthetic clinic', 'botox clinic', 'dermatologist',
    'plastic surgeon', 'cosmetic surgeon', 'osteopath', 'chiropractor', 'podiatrist',
    'private GP', 'psychologist', 'psychotherapist',
  ] },
};
const TRADES_EXCLUDE = /clean|window|gutter|carpet|jet ?wash|pressure ?wash/i;

const TIER_CITIES = {
  1: ['Wilmslow', 'Alderley Edge', 'Prestbury', 'Knutsford', 'Hale', 'Altrincham', 'Bowdon'],
  2: ['Didsbury', 'Chorlton', 'Sale', 'Marple', 'Poynton', 'Stockport'],
  3: ['Macclesfield', 'Manchester'],
};
function cities(tier) {
  if (tier === 'all' || tier === '3') return [...TIER_CITIES[1], ...TIER_CITIES[2], ...TIER_CITIES[3]];
  if (tier === '2') return [...TIER_CITIES[1], ...TIER_CITIES[2]];
  return TIER_CITIES[1];
}

const vConf = VERTICALS[VERTICAL];
if (!vConf) { console.error(`Unknown vertical "${VERTICAL}". Use: ${Object.keys(VERTICALS).join(', ')}`); process.exit(1); }
const CAMPAIGN = vConf.campaign;
// --terms=a,b,c overrides the vertical's default term list (target the proven high-yield categories)
const TERMS = args.terms ? String(args.terms).split(',').map(s => s.trim()).filter(Boolean) : vConf.terms;
// --cities=A,B,C overrides the tier list (avoids re-querying already-sourced cities)
const CITIES = args.cities ? String(args.cities).split(',').map(s => s.trim()).filter(Boolean) : cities(TIER);

async function searchPage(q, city, page) {
  const r = await fetch(`${BASE}/leads/search`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ q, cities: [city], countries: ['United Kingdom'], size: SIZE, page }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

function toRecord(lead, term, city) {
  const domain = lead.company_domain || null;
  return {
    name: lead.company_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown',
    ownerFirstName: lead.first_name || null,
    ownerLastName: lead.last_name || null,
    ownerEmail: lead.email || null,
    emailSource: 'consulti-search',
    emailVerified: false,
    linkedInUrl: lead.linkedin_url || null,
    website: domain ? (domain.startsWith('http') ? domain : `https://${domain}`) : null,
    category: term,
    location: lead.city || city,
    phone: lead.phone || null,
    jobTitle: lead.job_title || null,
    consultiCompany: lead.company_name || null,
  };
}

async function main() {
  console.log(`\n=== Consulti sourcing — ${VERTICAL} → ${CAMPAIGN} (tier ${TIER}) ===`);
  console.log(`Cities: ${CITIES.length} | Terms: ${TERMS.length} | size=${SIZE} maxPages=${MAX_PAGES} | cap=${MAX_CREDITS} credits\n`);

  if (DRY) {
    console.log('DRY RUN — query plan (no API calls):');
    TERMS.forEach(t => CITIES.forEach(c => console.log(`  "${t}" in ${c}`)));
    console.log(`\nTotal query slots: ${TERMS.length * CITIES.length} (each may page up to ${MAX_PAGES}×${SIZE})`);
    console.log('Cost: 1 credit per result returned; 0-result queries are free.');
    return;
  }

  const before = await consulti.getCredits();
  console.log('Credits before:', JSON.stringify(before));
  initDatabase();

  const seen = new Set();
  let creditsUsed = 0, saved = 0, updated = 0, excluded = 0, emails = 0, withLi = 0;

  outer:
  for (const city of CITIES) {
    for (const term of TERMS) {
      let page = START_PAGE, total = Infinity;
      while ((page - 1) * SIZE < total && page <= MAX_PAGES) {
        if (creditsUsed >= MAX_CREDITS) { console.log(`\n[CAP] Reached ${MAX_CREDITS}-credit cap. Stopping.`); break outer; }
        let res;
        try { res = await searchPage(term, city, page); }
        catch (e) { console.log(`  ERR "${term}"/${city} p${page}: ${e.message}`); break; }
        total = res.total || 0;
        creditsUsed += res.credits_used || 0;
        const leads = res.leads || [];
        if (page === 1 && total > 0) console.log(`  "${term}" in ${city}: total=${total} (credits so far ${creditsUsed})`);
        for (const lead of leads) {
          if (VERTICAL === 'trades' && (TRADES_EXCLUDE.test(lead.company_name || '') || TRADES_EXCLUDE.test(lead.job_title || ''))) { excluded++; continue; }
          const key = (lead.email || `${lead.first_name}_${lead.company_domain}`).toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const rec = toRecord(lead, term, city);
          const dupe = checkDuplicate({ name: rec.name, website: rec.website, postcode: null, address: null });
          const id = saveBusiness(rec, { campaigns: [CAMPAIGN], status: 'sourced', location: rec.location });
          if (id) addCampaignToBusiness(id, CAMPAIGN);
          if (dupe) updated++; else saved++;
          if (rec.ownerEmail) emails++;
          if (rec.linkedInUrl) withLi++;
        }
        await new Promise(z => setTimeout(z, 300));
        page++;
      }
    }
  }

  const after = await consulti.getCredits();
  console.log(`\n=== DONE: ${VERTICAL} ===`);
  console.log(`Unique contacts: ${seen.size} | new: ${saved} | updated: ${updated} | excluded(cleaning): ${excluded}`);
  console.log(`With email: ${emails} | with LinkedIn: ${withLi}`);
  console.log(`Lead credits used this run: ${creditsUsed}`);
  console.log(`Credits after: ${JSON.stringify(after)}`);
  console.log(`${CAMPAIGN} now has: ${getBusinessStats({ campaign: CAMPAIGN }).total} businesses`);
  console.log(`\nNext: node verify-existing-emails-consulti.js --campaign=${CAMPAIGN}  then export.`);
  closeDatabase();
}

main().catch(e => { console.error('Fatal:', e); closeDatabase(); process.exit(1); });
