#!/usr/bin/env node
/**
 * Pull the next daily batch from the scored funded reserve: top N not-yet-pulled,
 * highest leadScore first. Maintains a ledger so it walks the whole reserve once,
 * best-first, never repeating. Writes a dated batch CSV (original funded columns,
 * so process-funded-startups.js can consume it).
 *
 * Usage: node daily-funded-batch.js [--batch 250] [--ranked exports/funded-reserve-ranked.csv]
 *                                   [--ledger data/funded-reserve-pulled.txt] [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const BATCH = parseInt(opt('batch', '250'), 10);
const RANKED = opt('ranked', 'exports/funded-reserve-ranked.csv');
const LEDGER = opt('ledger', 'data/funded-reserve-pulled.txt');
const DRY = !!opt('dry-run', false);
const DATE = new Date().toISOString().slice(0, 10);

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

if (!fs.existsSync(RANKED)) { console.error(`Ranked reserve not found: ${RANKED}. Run score-funded-reserve.js first.`); process.exit(1); }
const rows = parseCSV(fs.readFileSync(RANKED, 'utf8'));
const H = rows[0].map(h => h.replace(/^﻿/, '').trim());
const emailIx = H.findIndex(h => /decision maker email/i.test(h));
// strip the appended score columns from the batch output (keep only original funded columns)
const scoreCols = ['leadScore', 'sc_geo', 'sc_recency', 'sc_size', 'sc_need', 'sc_role', 'sc_complete'];
const keepIx = H.map((h, i) => scoreCols.includes(h) ? -1 : i).filter(i => i >= 0);

const pulled = fs.existsSync(LEDGER) ? new Set(fs.readFileSync(LEDGER, 'utf8').split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)) : new Set();
const data = rows.slice(1); // already sorted by score desc
const batch = [];
for (const r of data) {
  const e = (r[emailIx] || '').trim().toLowerCase();
  if (!e || pulled.has(e)) continue;
  batch.push(r);
  if (batch.length >= BATCH) break;
}
const remaining = data.length - pulled.size - batch.length;

console.log(`Reserve: ${data.length} total | already pulled: ${pulled.size} | this batch: ${batch.length} | remaining after: ${remaining}`);
if (!batch.length) { console.log('Reserve exhausted — nothing to pull.'); process.exit(0); }

const OUT = path.join('exports', `funded-batch-${DATE}.csv`);
const outH = keepIx.map(i => H[i]);
const lines = [outH.map(esc).join(',')];
for (const r of batch) lines.push(keepIx.map(i => r[i] || '').map(esc).join(','));

if (DRY) {
  console.log(`\n[dry-run] would write ${batch.length} -> ${OUT} and append to ${LEDGER}`);
  console.log('Top 5 of this batch:');
  const orgIx = H.findIndex(h => /organization name/i.test(h)), scIx = H.indexOf('leadScore');
  batch.slice(0, 5).forEach(r => console.log(`  ${r[scIx] || '?'}  ${(r[orgIx] || '').slice(0, 30)}`));
  process.exit(0);
}
fs.writeFileSync(OUT, lines.join('\n') + '\n');
fs.appendFileSync(LEDGER, batch.map(r => (r[emailIx] || '').trim().toLowerCase()).join('\n') + '\n');
console.log(`\nWrote ${batch.length} -> ${OUT}`);
console.log(`Ledger updated (${pulled.size + batch.length} total pulled).`);
