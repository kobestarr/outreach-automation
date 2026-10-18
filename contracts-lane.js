#!/usr/bin/env node
'use strict';
/**
 * Contracts lane: for each good remote contract role, find the likely hiring manager and a verified email.
 *   node contracts-lane.js --in exports/contract-roles-2026-10-18.csv --out exports/contracts-send.csv [--dry-run]
 *     [--max-credits 150] [--min-score 5] [--desc-from raw1.csv,raw2.csv] [--no-web] [--no-search]
 * Free HTTP only. Reoon daily credits only (never the reserve), Icypeas cap 0, hard ceiling 150 credits. Never sends or loads anything.
 */
const fs = require('fs');
const path = require('path');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const P = require('./shared/outreach-core/contracts/pipeline');

function readRows(file) {
  const a = parseCSV(fs.readFileSync(file, 'utf8'));
  const h = a[0];
  return a.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (['dry-run', 'no-web', 'no-search'].includes(k)) o[k] = true; else o[k] = argv[++i]; } else o._.push(a);
  }
  return o;
}

function descriptionLookup(files) {
  const byUrl = new Map(), byKey = new Map();
  const key = (t, c) => `${String(t).toLowerCase().trim()}|${String(c).toLowerCase().trim()}`;
  for (const f of files) for (const r of readRows(f)) {
    const d = r.description; if (!d) continue;
    for (const u of [r.job_url, r.job_url_direct, r.url]) if (u) byUrl.set(u, d);
    byKey.set(key(r.title, r.company || r.company_name), d);
  }
  return (row) => byUrl.get(row.url) || byUrl.get(row.job_url) || byKey.get(key(row.title, row.company || row.company_name)) || '';
}

async function ddgSearch(query) {
  const https = require('https');
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const html = await new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }, timeout: 10000 }, (r) => {
      const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => res(Buffer.concat(c).toString('utf8')));
    });
    req.on('error', rej); req.on('timeout', () => { req.destroy(); rej(new Error('timeout')); });
  });
  return [...html.matchAll(/uddg=([^&"]+)/g)].map((m) => decodeURIComponent(m[1])).slice(0, 6);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.in || !a.out) { console.error('usage: node contracts-lane.js --in roles.csv --out send.csv [--dry-run] [--max-credits 150] [--desc-from a.csv,b.csv]'); process.exit(2); }
  const dataDir = process.env.OA_DATA_DIR || path.join(__dirname, 'data');
  const rows = readRows(a.in);
  const descriptions = a['desc-from'] ? descriptionLookup(a['desc-from'].split(',')) : null;

  const { fetchWebsite } = require('./shared/outreach-core/enrichment/website-scraper');
  const ch = require('./shared/outreach-core/enrichment/ch-owner');
  const deps = {
    fetchHtml: a['no-web'] ? async () => { throw new Error('offline'); } : (u) => fetchWebsite(u, 8000),
    search: a['no-web'] || a['no-search'] ? null : ddgSearch,
    ch: a['no-web'] ? null : {
      searchCompany: async (name) => {
        const r = await ch.chFetchJson(`/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`);
        return ((r && r.items) || []).map((i) => ({ title: i.title, company_number: i.company_number, company_status: i.company_status }));
      },
      lookupOwner: (n) => ch.lookupOwner(n),
    },
    openFinder: ({ maxCredits }) => require('./shared/outreach-core/enrichment/email-finder-adapter').openFinder({ maxCredits, maxIcypeas: 0 }),
  };
  const res = await P.run({ rows, deps, dataDir, dryRun: !!a['dry-run'], maxCredits: a['max-credits'] === undefined ? P.MAX_CREDITS_CEILING : Number(a['max-credits']), minScore: a['min-score'] === undefined ? 5 : Number(a['min-score']), descriptions, log: (m) => console.error('  ' + m) });

  const base = a.out.replace(/\.csv$/i, '');
  if (!a['dry-run']) {
    fs.writeFileSync(a.out, P.toCsv(P.SEND_COLUMNS, res.send.map(P.sendRow)));
    fs.writeFileSync(base + '-held.csv', P.toCsv(P.HELD_COLUMNS, res.held.map(P.heldRow)));
    fs.writeFileSync(base + '-recruiters.csv', P.toCsv(P.HELD_COLUMNS, res.recruiters.map(P.recruiterRow)));
  }
  console.log(JSON.stringify({ dryRun: !!a['dry-run'], plan: res.plan, finder: res.finderSummary }, null, 2));
  if (a['dry-run']) {
    console.log('\nPlan (no finder calls, no Reoon credits):');
    for (const c of res.candidates) console.log(`  ${c.role.company} | ${c.role.title} -> ${c.hm.name} (${c.hm.title || 'n/a'}) via ${c.hm.source}/${c.hm.confidence} @ ${c.domain}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { readRows, parseArgs, descriptionLookup };
