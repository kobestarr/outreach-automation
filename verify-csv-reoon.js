#!/usr/bin/env node
/**
 * Generic Reoon verifier for an exported Mailead/lead CSV (maps 1:1 to the file
 * you load, unlike the DB-campaign verifier). Reads emails, verifies via Reoon,
 * writes <name>-verified.csv (all rows annotated) and <name>-clean.csv (bad ones
 * dropped). Risky/unknown are KEPT (project rule); only clearly-bad are dropped.
 *
 * Usage:
 *   node verify-csv-reoon.js <csvPath> --dry-run            # plan + quota, no spend
 *   node verify-csv-reoon.js <csvPath>                      # live verify
 *   node verify-csv-reoon.js <csvPath> --limit=50           # cap (smoke test)
 *   node verify-csv-reoon.js <csvPath> --throttle-ms=250 --mode=power
 */
const fs = require('fs');
const path = require('path');
const { verifyEmail, checkAvailability } = require('./shared/outreach-core/email-verification/reoon-verifier');

const arg = Object.fromEntries(process.argv.slice(3).flatMap(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [[m[1], m[2] ?? true]] : [];
}));
const SRC = process.argv[2];
const DRY = !!arg['dry-run'];
const LIMIT = arg.limit ? parseInt(arg.limit, 10) : Infinity;
const THROTTLE = arg['throttle-ms'] ? parseInt(arg['throttle-ms'], 10) : 250;
const MODE = arg.mode || 'power';
// Clearly-bad Reoon statuses to drop from the clean file. Everything else
// (safe, valid, catch_all, risky, unknown, role) is kept.
const DROP = new Set(['invalid', 'disabled', 'disposable', 'spamtrap']);

if (!SRC || !fs.existsSync(SRC)) { console.error(`Usage: node verify-csv-reoon.js <csvPath> [--dry-run]`); process.exit(1); }

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}
const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const rows = parseCSV(fs.readFileSync(SRC, 'utf8'));
  const header = rows[0];
  const emailIdx = header.findIndex(h => /email/i.test(h));
  if (emailIdx < 0) { console.error('No email column found in header:', header.join(',')); process.exit(1); }
  const data = rows.slice(1);

  // Unique, non-empty emails (verify once, map results back to every row).
  const emails = [...new Set(data.map(r => (r[emailIdx] || '').trim().toLowerCase()).filter(Boolean))];
  const toVerify = emails.slice(0, LIMIT === Infinity ? emails.length : LIMIT);

  const avail = checkAvailability();
  console.log(`File: ${SRC}`);
  console.log(`Rows: ${data.length} | unique emails: ${emails.length} | to verify: ${toVerify.length}`);
  console.log(`Reoon quota: ${avail.remaining}/${avail.limit} remaining today (used ${avail.used})`);
  if (toVerify.length > avail.remaining) console.log(`⚠️  ${toVerify.length} > ${avail.remaining} remaining — run will stop at the cap; re-run tomorrow for the rest.`);
  if (DRY) { console.log('\n[dry-run] no API calls, no credits spent.'); return; }

  const result = new Map();
  let done = 0;
  for (const email of toVerify) {
    try {
      const v = await verifyEmail(email, MODE);
      result.set(email, v);
    } catch (e) {
      console.log(`\nStopped: ${e.message}`);
      break;
    }
    if (++done % 50 === 0) process.stdout.write(`\r  verified ${done}/${toVerify.length}`);
    if (THROTTLE) await sleep(THROTTLE);
  }
  process.stdout.write(`\r  verified ${done}/${toVerify.length}\n`);

  // Annotate + split.
  const outHeader = [...header, 'reoonStatus', 'reoonScore', 'reoonSafe'];
  const verifiedRows = [outHeader.map(esc).join(',')];
  const cleanRows = [outHeader.map(esc).join(',')];
  const tally = {};
  for (const r of data) {
    const email = (r[emailIdx] || '').trim().toLowerCase();
    const v = result.get(email);
    const status = v ? v.status : 'unchecked';
    const score = v ? (v.score ?? '') : '';
    const safe = v ? (v.isValid ? 1 : 0) : '';
    tally[status] = (tally[status] || 0) + 1;
    const line = [...r, status, score, safe].map(esc).join(',');
    verifiedRows.push(line);
    if (!DROP.has(status)) cleanRows.push(line);
  }

  const base = SRC.replace(/\.csv$/i, '');
  fs.writeFileSync(`${base}-verified.csv`, verifiedRows.join('\n') + '\n');
  fs.writeFileSync(`${base}-clean.csv`, cleanRows.join('\n') + '\n');
  console.log('\nStatus breakdown:', JSON.stringify(tally));
  console.log(`Kept (clean): ${cleanRows.length - 1} | dropped: ${data.length - (cleanRows.length - 1)}`);
  console.log(`Wrote ${path.basename(base)}-verified.csv and ${path.basename(base)}-clean.csv`);
})();
