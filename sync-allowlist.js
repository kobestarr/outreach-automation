#!/usr/bin/env node
/**
 * sync-allowlist.js — keep the reply-watcher's allowlist current as leads are added.
 *
 * The reply-watcher (clawdbot) matches inbound mail against data/outreach-allowlist.txt to tell
 * a real prospect reply from inbox noise. That file was a one-time snapshot, so NEW leads
 * (cardiologists, new Consulti/Outscraper batches, loose CSVs) weren't covered and their replies
 * would be missed. This regenerates the allowlist from the source(s) of truth and (optionally)
 * pushes it to clawdbot, so "add leads → trust capture" actually holds.
 *
 * Principle: the allowlist is a SUPERSET. A missing emailed lead = a dropped reply (bad). An extra
 * entry = harmless. So we err wide: every email in the DB + every email in any campaign CSV.
 *
 * Sources:
 *   - SQLite DB owner_email (all non-empty)         [primary]
 *   - any CSV passed with --csv <path> (repeatable) [loose lists: LeadRocks, Doctify, etc.]
 *   - all exports/*.csv when --include-exports is set
 *
 * Usage:
 *   node sync-allowlist.js --dry-run                 # show what would change, write nothing
 *   node sync-allowlist.js                           # rewrite data/outreach-allowlist.txt locally
 *   node sync-allowlist.js --csv ~/Downloads/leadrocks_cardiologists_2024_01_11.csv
 *   node sync-allowlist.js --push                    # rewrite locally AND scp to clawdbot
 *
 * --push runs: scp data/outreach-allowlist.txt clawdbot:/root/data/outreach-allowlist.txt
 * (the watcher re-reads the file every run, so no restart needed.)
 *
 * Node note: uses python3's sqlite3 to read the DB (no better-sqlite3 dep at repo root).
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const DB = path.join(HERE, 'ksd/local-outreach/orchestrator/data/businesses.db');
const OUT = path.join(HERE, 'data/outreach-allowlist.txt');
const CLAWDBOT_DEST = 'clawdbot:/root/data/outreach-allowlist.txt';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const PUSH = argv.includes('--push');
const INCLUDE_EXPORTS = argv.includes('--include-exports');
const csvArgs = argv.reduce((a, v, i) => (v === '--csv' && argv[i + 1] ? [...a, argv[i + 1]] : a), []);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const norm = (e) => (e || '').trim().toLowerCase();

function fromDb() {
  if (!fs.existsSync(DB)) { console.warn('! DB not found:', DB); return []; }
  const py = `import sqlite3;db=sqlite3.connect(${JSON.stringify(DB)});\nprint('\\n'.join(r[0] for r in db.execute("SELECT DISTINCT lower(trim(owner_email)) FROM businesses WHERE owner_email IS NOT NULL AND owner_email!=''").fetchall() if r[0]))`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').map(norm).filter((e) => EMAIL_RE.test(e));
}

function fromCsv(file) {
  if (!fs.existsSync(file)) { console.warn('! CSV not found:', file); return []; }
  const text = fs.readFileSync(file, 'utf8');
  // permissive: pull every email-looking token from the file (handles any column layout)
  const found = text.match(/[^@\s",;]+@[^@\s",;]+\.[^@\s",;]+/g) || [];
  return found.map(norm).filter((e) => EMAIL_RE.test(e));
}

function main() {
  const sources = [];
  const db = fromDb();
  sources.push(['DB owner_email', db]);

  const csvFiles = [...csvArgs];
  if (INCLUDE_EXPORTS) {
    const ex = path.join(HERE, 'exports');
    if (fs.existsSync(ex)) for (const f of fs.readdirSync(ex)) if (f.endsWith('.csv')) csvFiles.push(path.join(ex, f));
  }
  for (const f of csvFiles) sources.push([`csv ${path.basename(f)}`, fromCsv(f)]);

  const set = new Set();
  for (const [label, emails] of sources) {
    const before = set.size;
    emails.forEach((e) => set.add(e));
    console.log(`  + ${label}: ${emails.length} emails (+${set.size - before} new)`);
  }
  const merged = [...set].sort();

  const current = fs.existsSync(OUT)
    ? new Set(fs.readFileSync(OUT, 'utf8').split('\n').map(norm).filter(Boolean))
    : new Set();
  const added = merged.filter((e) => !current.has(e));
  const removed = [...current].filter((e) => !set.has(e));

  console.log(`\ncurrent allowlist: ${current.size}  →  new: ${merged.length}`);
  console.log(`  added:   ${added.length}${added.length ? '  e.g. ' + added.slice(0, 3).join(', ') : ''}`);
  console.log(`  dropped: ${removed.length}${removed.length ? '  e.g. ' + removed.slice(0, 3).join(', ') : ''}`);

  if (DRY) { console.log('\n[dry-run] nothing written.'); return; }

  fs.writeFileSync(OUT, merged.join('\n') + '\n');
  console.log(`\nwrote ${merged.length} → ${OUT}`);

  if (PUSH) {
    console.log(`pushing → ${CLAWDBOT_DEST} ...`);
    execFileSync('scp', [OUT, CLAWDBOT_DEST], { stdio: 'inherit' });
    console.log('pushed. watcher picks it up on its next 15-min run.');
  } else {
    console.log('(local only — run with --push to sync clawdbot)');
  }
}

main();
