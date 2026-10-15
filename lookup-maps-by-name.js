#!/usr/bin/env node
/**
 * Look up named companies on Google Maps, ONE result per company: "<name>, <postcode>".
 * Provider: Google Places API (New) Text Search (default) or Outscraper (--provider outscraper).
 * For lists that already know WHO (e.g. the Companies House established-firms list) and need
 * website / phone / Google category / reviews. Area sweeps stay in explore-area-businesses.js.
 *
 * API (checked 2026-10-15 against outscraper-python client.py): POST https://api.app.outscraper.com/google-maps-search,
 * header X-API-KEY, JSON {query:[...], organizationsPerQueryLimit:1, language:'en', region:'GB', async:false}.
 * Batches of <= 50 queries stay synchronous.
 * Google Places (checked 2026-10-15, developers.google.com text-search docs): POST https://places.googleapis.com/v1/places:searchText,
 * headers X-Goog-Api-Key + X-Goog-FieldMask, body {textQuery, regionCode:'GB', pageSize:1}. websiteUri/phone/rating/userRatingCount
 * make it the Enterprise SKU: 1,000 free calls/month (shared with Rallie, whose key this is: vault googlePlaces).
 *
 * Usage: node lookup-maps-by-name.js <in.csv> --out <out.csv> [--filter-sub "A|B"] [--limit N] [--dry-run]
 */
const fs = require('fs');
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const IN = process.argv[2], OUT = opt('out', 'exports/maps-lookup.csv');
const SUBS = opt('filter-sub', null), LIMIT = parseInt(opt('limit', '0'), 10), DRY = !!opt('dry-run', false);
const PROVIDER = opt('provider', 'google');
const COST_PER_RESULT = PROVIDER === 'google' ? 0 : 0.002; // google: inside 1,000 free/month; outscraper: CLAUDE.md working figure

function parseCSV(t) { const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (row.length > 1) rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const H = rows[0]; return rows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
}
const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(limited|ltd|plc|llp|the|uk|services?|group)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const district = pc => (String(pc || '').toUpperCase().match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}$/) || [])[1] || '';
function nameMatch(a, b) { // share of the company's significant words found in the Maps title
  const A = norm(a).split(' ').filter(w => w.length > 2), B = new Set(norm(b).split(' '));
  return A.length ? A.filter(w => B.has(w)).length / A.length : 0;
}

(async () => {
  let rows = parseCSV(fs.readFileSync(IN, 'utf8')).filter(r => r.passes === '1' || r.passes === undefined);
  if (SUBS) { const s = new Set(SUBS.split('|')); rows = rows.filter(r => s.has(r.subcategory)); }
  if (LIMIT) rows = rows.slice(0, LIMIT);
  const queries = rows.map(r => `${r.company_name}, ${r.postcode}`);
  console.log(`${rows.length} companies -> ${queries.length} Maps queries via ${PROVIDER}, 1 result each. Est. cost $${(queries.length * COST_PER_RESULT).toFixed(2)}${PROVIDER === 'google' ? ' (free tier: 1,000/month shared with Rallie)' : ''}`);
  queries.slice(0, 5).forEach(q => console.log('  e.g. ' + q));
  if (DRY) { console.log('[dry-run] no API calls'); return; }

  const creds = require(process.env.HOME + '/.credentials/api-keys.json');
  const out = [];
  const record = (src, p) => {
    const score = p.name ? nameMatch(src.company_name, p.name) : 0;
    const sameArea = p.postal_code && district(p.postal_code) === src.district;
    out.push({ ...src, maps_name: p.name || '', maps_match: !p.name ? 'none' : score >= 0.6 ? 'yes' : (score >= 0.34 && sameArea) ? 'probable' : 'check',
      maps_category: p.category || '', website: p.website || '', phone: p.phone || '', rating: p.rating || '', reviews: p.reviews || '',
      maps_postcode: p.postal_code || '', maps_town: p.city || '', business_status: p.business_status || '', place_id: p.place_id || '' });
  };
  if (PROVIDER === 'google') {
    const key = creds.googlePlaces.apiKey;
    const MASK = 'places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.postalAddress,places.businessStatus';
    for (let i = 0; i < queries.length; i++) {
      const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': MASK },
        body: JSON.stringify({ textQuery: queries[i], regionCode: 'GB', pageSize: 1 }) });
      const j = await r.json();
      if (!r.ok) { console.error('Places error', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
      const g = (j.places || [])[0] || {};
      record(rows[i], { name: g.displayName && g.displayName.text, website: g.websiteUri, phone: g.nationalPhoneNumber,
        category: g.primaryTypeDisplayName && g.primaryTypeDisplayName.text, rating: g.rating, reviews: g.userRatingCount,
        postal_code: g.postalAddress && g.postalAddress.postalCode, city: g.postalAddress && g.postalAddress.locality,
        business_status: g.businessStatus, place_id: g.id });
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${queries.length}`);
      await new Promise(res => setTimeout(res, 150));
    }
  } else {
    const k = creds.outscraper; const key = typeof k === 'string' ? k : k.apiKey;
    for (let i = 0; i < queries.length; i += 40) {
      const batch = queries.slice(i, i + 40);
      const r = await fetch('https://api.app.outscraper.com/google-maps-search', { method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: batch, organizationsPerQueryLimit: 1, language: 'en', region: 'GB', async: false }) });
      const j = await r.json();
      if (!r.ok || !j.data) { console.error('Outscraper error', r.status, JSON.stringify(j).slice(0, 300)); process.exit(1); }
      j.data.forEach((places, n) => { const p = (places || [])[0] || {};
        record(rows[i + n], { name: p.name, website: p.site || p.website, phone: p.phone, category: p.category || p.type, rating: p.rating,
          reviews: p.reviews, postal_code: p.postal_code, city: p.city, business_status: p.business_status, place_id: p.place_id }); });
      console.log(`  ${Math.min(i + 40, queries.length)}/${queries.length}`);
    }
  }
  const H = Object.keys(out[0]);
  fs.writeFileSync(OUT, [H.join(','), ...out.map(o => H.map(h => esc(o[h])).join(','))].join('\n'));
  const c = k2 => out.filter(o => o.maps_match === k2).length;
  console.log(`match yes:${c('yes')} probable:${c('probable')} check:${c('check')} none:${c('none')} | with website: ${out.filter(o => o.website).length} | wrote ${OUT}`);
})();
