#!/usr/bin/env node
/**
 * Assemble the verified funded-founders cut into Mailead-ready route files.
 * Input: the warm (+ optionally other) files from verify-funded-startups.js
 *        (Reoon-verified; carry reoonSafe/siteStatus/aiInvisible/bucket).
 * Output: funded-mailead-{A,B,C}-<date>.csv routed by lead component, names naturalised.
 *
 * Routing (which email sequence each lead gets):
 *   A build-led   : siteStatus broken (dead/parked/thin/http4xx/http5xx)
 *   C podcast     : bucket == stripped (media/consumer/notable)
 *   B ai-search   : everyone else (live but AI-invisible)
 * Identity (sender brand) is the lead's `bucket` (kobestarr/dealflow/stripped);
 * see memory reference-media-brand-positioning. Route = sequence, bucket = brand.
 *
 * Usage:
 *   node assemble-funded-mailead.js --warm exports/funded-startups-2026-07-warm.csv \
 *        [--other exports/funded-startups-2026-07-other.csv] [--date 2026-07-01] [--safe-only]
 *   --safe-only  keep only reoonSafe==1 rows (recommended for first send wave)
 */
const fs = require('fs');
const path = require('path');

const arg = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => {
  if (a.startsWith('--')) { const k = a.slice(2); const v = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true; return [[k, v]]; }
  return [];
}));
const WARM = arg.warm;
const OTHER = arg.other;
const DATE = typeof arg.date === 'string' ? arg.date : new Date().toISOString().slice(0, 10);
const SAFE_ONLY = !!arg['safe-only'];
const BROKEN = new Set(['dead', 'parked', 'thin']);

if (!WARM || !fs.existsSync(WARM)) {
  console.error('Usage: node assemble-funded-mailead.js --warm <warm.csv> [--other <other.csv>] [--date YYYY-MM-DD] [--safe-only]');
  process.exit(1);
}

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

// Naturalise shouty company names for subject lines (4MINDS -> 4Minds), strip legal suffixes.
const SUFFIX = /,?\s+(ltd|limited|inc\.?|llc|plc|co\.?|corp\.?|gmbh)\.?$/i;
function naturalise(name) {
  let n = (name || '').replace(SUFFIX, '').trim();
  const letters = n.replace(/[^A-Za-z]/g, '');
  if (letters.length > 4 && letters === letters.toUpperCase()) n = n.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return n;
}

function load(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  const h = rows[0].map(x => x.trim());
  const idx = name => h.findIndex(x => x.toLowerCase() === name);
  const col = { name: idx('name'), dm: idx('dm'), email: idx('email'), li: h.findIndex(x => /^li$|linkedin/i.test(x)),
    website: idx('website'), bucket: idx('bucket'), site: idx('sitestatus'), ai: idx('aiinvisible'),
    round: idx('round'), fund: idx('fundusd'), country: idx('country'), pos: idx('pos'), safe: idx('reoonsafe') };
  return rows.slice(1).map(r => ({
    name: naturalise(r[col.name]), first: (r[col.dm] || '').trim().split(/\s+/)[0] || '',
    email: r[col.email] || '', li: col.li >= 0 ? r[col.li] : '', website: r[col.website] || '',
    bucket: (r[col.bucket] || 'dealflow').toLowerCase(), site: (r[col.site] || '').toLowerCase(),
    ai: r[col.ai] || '', round: r[col.round] || '', fund: r[col.fund] || '', country: r[col.country] || '',
    pos: r[col.pos] || '', safe: r[col.safe] || '',
  }));
}

let leads = [...load(WARM), ...load(OTHER)];
const seen = new Set();
leads = leads.filter(l => { const e = l.email.toLowerCase(); if (!e || seen.has(e)) return false; seen.add(e); return true; });
if (SAFE_ONLY) leads = leads.filter(l => l.safe === '1');

const route = l => (BROKEN.has(l.site) || /^http[45]/.test(l.site)) ? 'A' : (l.bucket === 'stripped' ? 'C' : 'B');
const buckets = { A: [], B: [], C: [] };
leads.forEach(l => buckets[route(l)].push(l));

const names = { A: 'buildled', B: 'aisearch', C: 'podcast' };
const HDR = ['first_name', 'email', 'company_name', 'website', 'linkedin_url', 'route', 'siteStatus', 'aiInvisible', 'round', 'fundUsd', 'country', 'pos', 'bucket'];
for (const k of ['A', 'B', 'C']) {
  const out = path.join('exports', `funded-mailead-${k}-${names[k]}-${DATE}.csv`);
  const lines = [HDR.join(',')];
  for (const l of buckets[k]) lines.push([l.first, l.email, l.name, l.website, l.li, k, l.site, l.ai, l.round, l.fund, l.country, l.pos, l.bucket].map(esc).join(','));
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`Route ${k} (${names[k]}): ${buckets[k].length} -> ${out}`);
}
console.log(`\nTotal assembled: ${leads.length}${SAFE_ONLY ? ' (safe-only)' : ''}`);
