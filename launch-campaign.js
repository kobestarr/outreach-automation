#!/usr/bin/env node
/**
 * One-command campaign prep: raw leads CSV -> verified, deduped, naturalised,
 * Mailead-ready CSV in ~/Downloads + a config card printed to the console.
 * The "here's the next CSV, let's go" button.
 *
 * Usage:
 *   node launch-campaign.js <input.csv> --name "KSD · AI Search · Funded" [--boxes dealflow] [--verify]
 *   --verify     Reoon-verify and keep only safe (recommended for unverified lists; slow, live)
 *   --boxes      dealflow | ksd | stripped  (just prints the right box hint on the card)
 *   --no-open    don't reveal the file in Finder
 *
 * If the input already carries reoonStatus/reoonSafe columns, safe rows are kept automatically.
 * For a RAW funded "1K - Current Month" drop, use the funded SOP instead
 * (process-funded-startups.js -> verify-funded-startups.js -> assemble-funded-mailead.js).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const argv = process.argv.slice(2);
const SRC = argv[0];
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const NAME = opt('name', 'Campaign');
const BOXES = String(opt('boxes', 'dealflow')).toLowerCase();
const VERIFY = !!opt('verify', false);
const OPEN = !opt('no-open', false);

if (!SRC || !fs.existsSync(SRC)) { console.error('Usage: node launch-campaign.js <input.csv> --name "..." [--boxes dealflow] [--verify]'); process.exit(1); }

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
const SUFFIX = /,?\s+(ltd|limited|inc\.?|llc|plc|co\.?|corp\.?|gmbh)\.?$/i;
function naturalise(name) {
  let n = (name || '').replace(SUFFIX, '').trim();
  const letters = n.replace(/[^A-Za-z]/g, '');
  if (letters.length > 4 && letters === letters.toUpperCase()) n = n.replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return n;
}

const rows = parseCSV(fs.readFileSync(SRC, 'utf8'));
const H = rows[0].map(h => h.trim().toLowerCase());
const find = (...names) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return H.findIndex(h => names.some(n => h.includes(n))); };
const col = { first: find('first_name', 'first', 'firstname'), email: find('email'), company: find('company_name', 'company'),
  website: find('website', 'url', 'domain'), li: find('linkedin_url', 'linkedin', 'li'),
  rstatus: find('reoonstatus'), rsafe: find('reoonsafe') };
if (col.email < 0 || col.first < 0) { console.error('CSV needs at least email + first_name columns.'); process.exit(1); }

let data = rows.slice(1);
// dedup by email
const seen = new Set();
data = data.filter(r => { const e = (r[col.email] || '').trim().toLowerCase(); if (!e || seen.has(e)) return false; seen.add(e); return true; });
const rawCount = data.length;

// keep safe if pre-verified
let note = '';
if (col.rstatus >= 0) { const before = data.length; data = data.filter(r => (r[col.rstatus] || '') === 'safe'); note = `pre-verified: kept ${data.length} safe of ${before}`; }
else if (VERIFY) {
  const emails = data.map(r => (r[col.email] || '').trim()).join('\n');
  const tmp = path.join(os.tmpdir(), 'lc-verify-' + Date.now() + '.csv');
  fs.writeFileSync(tmp, 'first_name,email\n' + data.map(r => `${esc(r[col.first])},${esc(r[col.email])}`).join('\n') + '\n');
  console.log('Reoon-verifying (safe-only)...');
  execSync(`node "${path.join(__dirname, 'verify-csv-reoon.js')}" "${tmp}" --throttle-ms=150`, { stdio: 'inherit' });
  const verified = parseCSV(fs.readFileSync(tmp.replace('.csv', '-verified.csv'), 'utf8'));
  const vh = verified[0].map(h => h.toLowerCase()); const vi = { e: vh.indexOf('email'), s: vh.indexOf('reoonstatus') };
  const safe = new Set(verified.slice(1).filter(r => r[vi.s] === 'safe').map(r => (r[vi.e] || '').toLowerCase()));
  const before = data.length; data = data.filter(r => safe.has((r[col.email] || '').trim().toLowerCase()));
  note = `Reoon: kept ${data.length} safe of ${before}`;
} else { note = '⚠️ NOT verified (pass --verify or pre-verify before sending)'; }

// write Mailead-ready CSV
const date = new Date().toISOString().slice(0, 10);
const slug = NAME.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const HDR = ['first_name', 'email', 'company_name', 'website', 'linkedin_url'];
const outLines = [HDR.join(',')];
for (const r of data) outLines.push([r[col.first] || '', r[col.email] || '', naturalise(col.company >= 0 ? r[col.company] : ''), col.website >= 0 ? r[col.website] : '', col.li >= 0 ? r[col.li] : ''].map(esc).join(','));
const repoOut = path.join(__dirname, 'exports', `${slug}-mailead-${date}.csv`);
fs.writeFileSync(repoOut, outLines.join('\n') + '\n');
const dlOut = path.join(os.homedir(), 'Downloads', `MAILEAD-${slug}-${data.length}-${date}.csv`);
fs.writeFileSync(dlOut, outLines.join('\n') + '\n');
if (OPEN) { try { execSync(`open -R "${dlOut}"`); } catch (e) {} }

const boxHint = { dealflow: 'DealFlow (9)', ksd: 'Kobestarr Digital (9)', stripped: 'Stripped (9)' }[BOXES] || BOXES;
console.log('\n================ CAMPAIGN READY ================');
console.log(`Campaign:  ${NAME}`);
console.log(`Leads:     ${data.length} (from ${rawCount} deduped) — ${note}`);
console.log(`CSV:       ${dlOut}`);
console.log(`Boxes:     ${boxHint}`);
console.log(`Mapping:   first_name -> First Name | company_name -> Company Name`);
console.log(`Cadence:   Day 0/3/6/12, Mon-Fri, first touch never Friday`);
console.log(`Next:      new Mailead campaign -> drag the Downloads CSV -> map columns -> paste sequence -> ${boxHint} -> activate`);
console.log('===============================================');
