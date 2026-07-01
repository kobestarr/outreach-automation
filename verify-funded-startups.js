#!/usr/bin/env node
/**
 * Reoon-verify the funded-startups checked CSV, then split by deliverability.
 *
 *   warm  -> Reoon safe/valid          (send now, normal cadence)
 *   other -> catch_all/risky/unknown   (slow drip, protect domain reputation)
 *   drop  -> invalid/disposable/etc    (never send)
 *
 * Usage:
 *   node verify-funded-startups.js [csvPath] [--dry-run] [--limit=N] [--hot-only]
 * Default input: exports/funded-startups-2026-05-checked.csv
 * Outputs: exports/funded-startups-<month>-warm.csv / -other.csv / -drop.csv
 */
const fs = require('fs');
const path = require('path');
const { verifyEmail, checkAvailability } = require('./shared/outreach-core/email-verification/reoon-verifier');

const SRC = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : 'exports/funded-startups-2026-05-checked.csv';
const arg = Object.fromEntries(process.argv.slice(2).flatMap(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [[m[1], m[2] ?? true]] : []; }));
const DRY_RUN = !!arg['dry-run'];
const LIMIT = arg.limit ? parseInt(arg.limit, 10) : Infinity;
const HOT_ONLY = !!arg['hot-only'];

function parseCsv(t) {
  const rows = []; let f = '', row = [], q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i+1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i+1] === '\n') i++; row.push(f); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; f = ''; } else f += c; } }
  if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows;
}
const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// Reoon status -> our bucket. NB: catch_all is NOT warm — Reoon flags it
// is_safe_to_send but the specific mailbox is unverifiable, so it goes to the
// slow-drip "other" pool (Kobi's plan: warm = clean only, other = risky).
const WARM = new Set(['safe', 'valid']);
const DROP = new Set(['invalid', 'disposable', 'disabled', 'spamtrap', 'unknown_domain', 'error']);
function bucketFor(status /*, isSafe ignored on purpose */) {
  const s = (status || '').toLowerCase();
  if (WARM.has(s)) return 'warm';
  if (DROP.has(s)) return 'drop';
  return 'other'; // catch_all, role_account, risky, unknown, gray
}
const isHotVal = v => v === '1' || String(v).toLowerCase() === 'true';

async function main() {
  const rows = parseCsv(fs.readFileSync(SRC, 'utf8'));
  const header = rows[0];
  const ei = header.indexOf('email');
  const hi = header.indexOf('hot');
  if (ei < 0) throw new Error('no email column in ' + SRC);

  let data = rows.slice(1).filter(r => (r[ei] || '').includes('@'));
  if (HOT_ONLY) data = data.filter(r => String(r[hi]).toLowerCase() === 'true' || r[hi] === '1');
  data = data.slice(0, LIMIT);

  const avail = checkAvailability();
  console.log(`Source: ${SRC}`);
  console.log(`Candidates with email: ${data.length}${HOT_ONLY ? ' (hot-only)' : ''}`);
  console.log(`Reoon quota: ${avail.remaining}/${avail.limit} remaining today`);

  if (DRY_RUN) {
    const bybk = {}; data.forEach(r => { const b = header.indexOf('bucket'); bybk[r[b]] = (bybk[r[b]] || 0) + 1; });
    console.log('DRY-RUN — no API calls. Pitch-bucket split:', JSON.stringify(bybk));
    console.log(`Would verify ${Math.min(data.length, avail.remaining)} emails.`);
    return;
  }
  if (data.length > avail.remaining) {
    console.log(`WARNING: ${data.length} > ${avail.remaining} remaining — only first ${avail.remaining} will verify; rest error->other.`);
  }

  const outHeader = [...header, 'reoonStatus', 'reoonScore', 'reoonSafe', 'verifyBucket'];
  const buckets = { warm: [], other: [], drop: [] };
  let done = 0;
  for (const r of data) {
    const email = r[ei];
    let v;
    try { v = await verifyEmail(email, 'power'); }
    catch (e) { v = { status: 'error', score: '', isSafeToSend: false, error: e.message }; }
    const vb = bucketFor(v.status);
    buckets[vb].push([...r, v.status || '', v.score ?? '', v.isSafeToSend ? '1' : '0', vb]);
    done++;
    if (done % 25 === 0 || done === data.length) process.stdout.write(`  ${done}/${data.length}\r`);
    await new Promise(z => setTimeout(z, 100));
  }
  console.log('');

  const month = (typeof arg.tag === 'string' && arg.tag) || (SRC.match(/(\d{4}-\d{2})/) || [])[1] || 'out';
  for (const [b, list] of Object.entries(buckets)) {
    const out = path.join('exports', `funded-startups-${month}-${b}.csv`);
    fs.writeFileSync(out, [outHeader.map(esc).join(','), ...list.map(r => r.map(esc).join(','))].join('\n'));
    console.log(`${b.padEnd(5)} ${String(list.length).padStart(4)}  -> ${out}`);
  }
  const hotWarm = buckets.warm.filter(r => isHotVal(r[hi])).length;
  console.log(`\nWarm + HOT (verified, real website/AI hook): ${hotWarm}`);
}
main().catch(e => { console.error(e); process.exit(1); });
