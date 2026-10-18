#!/usr/bin/env node
/**
 * Enriched local list -> send-batch.js input for the "my window cleaner" local sequence.
 * Output columns: first_name, last_name (REAL surname), email, company, category, town, website, email_rule, company_number
 * (+ email_status, email_confidence, email_source when the input has them; never email_suggested)
 * The campaign carrier (config/campaign-sheets.json) then packs "{category} in {town}" into Mailead's Last Name,
 * e.g. "a roofer in Sale", read by the emails as {{last_name}}.
 *
 * Usage: node assemble-local-mailead.js <final.csv> --out <send.csv> [--claimed data/claimed-areas.json]
 * Skips: no email, cleaning firms, and any trade+town already claimed by a signed client (one per trade per area).
 */
const fs = require('fs');
const { nameVariants } = require('./shared/outreach-core/enrichment/owner-email');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const IN = process.argv[2], OUT = arg('out', IN.replace(/\.csv$/, '-send.csv')), CLAIMED = arg('claimed', 'data/claimed-areas.json');

// Postcode district -> the name locals use (registered or Google postcode)
const TOWN = { M14: 'Fallowfield', M16: 'Whalley Range', M19: 'Levenshulme', M20: 'Didsbury', M21: 'Chorlton', M22: 'Northenden',
  M23: 'Wythenshawe', M33: 'Sale', SK1: 'Stockport', SK2: 'Stockport', SK3: 'Stockport', SK4: 'Heaton Moor', SK5: 'Reddish',
  SK6: 'Marple', SK7: 'Bramhall', SK8: 'Cheadle', SK9: 'Wilmslow', SK10: 'Macclesfield', SK11: 'Macclesfield', SK12: 'Poynton',
  WA14: 'Altrincham', WA15: 'Hale', WA16: 'Knutsford', CW4: 'Holmes Chapel', CW12: 'Congleton' };
// Google category first (more precise), then our subcategory. Article included so "an electrician" reads right.
const BY_GOOGLE = { 'Roofing Contractor': 'a roofer', Painter: 'a painter and decorator', Landscaper: 'a landscaper', 'Landscape Designer': 'a landscaper',
  'Gardener': 'a gardener', 'Electrician': 'an electrician', 'Plumber': 'a plumber', 'Window Installation Service': 'a window fitter',
  'Fence Contractor': 'a fencing company', 'Paving Contractor': 'a driveway company', 'Kitchen Remodeler': 'a kitchen fitter', 'Glazier': 'a glazier' };
const BY_SUB = { 'Landscapers & gardeners': 'a landscaper', Roofers: 'a roofer', 'Windows & doors': 'a window company', Glaziers: 'a glazier',
  'Painters & decorators': 'a painter and decorator', 'Driveways & paving': 'a driveway company', Fencing: 'a fencing company',
  'Joiners, kitchens, windows & doors': 'a joiner', Electricians: 'an electrician', 'Plumbing, heating & air-con': 'a heating engineer' };
const CLEANING = /\bclean(ing|ers?)\b|window\s*clean|gutter/i;

function parseCSV(t) { const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); if (row.length > 1) rows.push(row); row = []; f = ''; } else f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const H = rows[0]; return rows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
}
const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const district = pc => (String(pc || '').toUpperCase().match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)\s*\d[A-Z]{2}$/) || [])[1] || '';
// Google listing names are often keyword-stuffed ("X Ltd - Timber Windows & Doors", "X (Stockport)"): keep the brand only
const cleanName = n => { let s = String(n).split(/\s+[-|\u2013\u2014:]\s+/)[0];
  s = s.replace(/\s*\([^)]*\)\s*$/, '').replace(/\b(limited|ltd)\.?$/i, '').replace(/[\s,]+$/, '').trim();
  return (s === s.toUpperCase() && /[A-Z]{4}/.test(s)) ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s; };
const niceCompany = (r) => {
  if (['yes', 'probable'].includes(r.maps_match) && r.maps_name) return cleanName(r.maps_name);
  return r.company_name.toLowerCase().replace(/\b(limited|ltd)\b\.?/g, '').trim().replace(/\b[a-z]/g, c => c.toUpperCase());
};

const rows = parseCSV(fs.readFileSync(IN, 'utf8'));
const claimed = fs.existsSync(CLAIMED) ? JSON.parse(fs.readFileSync(CLAIMED, 'utf8')) : []; // [{category:"a roofer", town:"Sale", client:"..."}]
const isClaimed = (cat, town) => claimed.some(c => c.category === cat && c.town === town);
// Finder columns ride along so send-batch can route by how the address was found. email_suggested (a guess) never does.
// A file with no email_status column is a legacy file and stays that way; one WITH the column keeps it even when blank (send-batch then fails closed).
const HAS_STATUS = rows.length > 0 && 'email_status' in rows[0];
const out = [], skipped = {};
const skip = why => { skipped[why] = (skipped[why] || 0) + 1; };
for (const r of rows) {
  if (!r.email) { skip('no email'); continue; }
  if (CLEANING.test(r.company_name + ' ' + r.maps_name + ' ' + r.maps_category)) { skip('cleaning (protects Dave)'); continue; }
  const town = TOWN[district(['yes', 'probable'].includes(r.maps_match) ? r.maps_postcode : '')] || TOWN[r.district] || '';
  const category = BY_GOOGLE[r.maps_category] || BY_SUB[r.subcategory] || '';
  if (!town || !category) { skip('no town/trade label'); continue; }
  if (isClaimed(category, town)) { skip('area already claimed'); continue; }
  if (!r.owner_first) { skip('no owner name'); continue; }
  // Greet by the name they use: tony@ for owner Anthony -> "Hi Tony"
  let first = r.owner_first;
  const local = (r.email.split('@')[0] || '').split(/[._-]/)[0].toLowerCase();
  if (['owner-match', 'owner-guess-verified', 'finder-found'].includes(r.email_rule)) {
    if (local !== first.toLowerCase() && nameVariants(first).includes(local)) first = local[0].toUpperCase() + local.slice(1);
  }
  out.push({ first_name: first, last_name: r.owner_last, email: r.email, company: niceCompany(r), category, town,
    website: r.website, email_rule: r.email_rule, company_number: r.company_number,
    ...(HAS_STATUS ? { email_status: r.email_status || '', email_confidence: r.email_confidence || '', email_source: r.email_source || '' } : {}) });
}
const H = Object.keys(out[0] || { first_name: '' });
fs.writeFileSync(OUT, [H.join(','), ...out.map(o => H.map(h => esc(o[h])).join(','))].join('\n'));
console.log(`send-ready ${out.length} | skipped ${JSON.stringify(skipped)} | wrote ${OUT}`);
const per = {}; out.forEach(o => { const k = `${o.category} in ${o.town}`; per[k] = (per[k] || 0) + 1; });
const clash = Object.entries(per).filter(([, n]) => n > 1);
if (clash.length) console.log('NOTE same trade+area more than once (fine until one signs, then the rest are skipped):', JSON.stringify(Object.fromEntries(clash)));
