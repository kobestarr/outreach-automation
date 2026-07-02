#!/usr/bin/env node
// Seed data/sent-ledger.txt from CSVs that were ALREADY loaded into a sender.
// Usage: node seed-ledger.js <csv> [<csv> ...]   (email column found by /email/i)
const fs = require('fs'), path = require('path');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { appendLedger } = require('./shared/outreach-core/csv/ledger');

const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node seed-ledger.js <csv> [...]'); process.exit(2); }
let total = 0;
for (const f of files) {
  const rows = parseCSV(fs.readFileSync(f, 'utf8'));
  const idx = rows[0].findIndex(h => /email/i.test(h));
  if (idx < 0) { console.error(`SKIP ${f}: no email column`); continue; }
  const emails = rows.slice(1).map(r => r[idx]).filter(e => e && e.includes('@'));
  const added = appendLedger(path.join(__dirname, 'data/sent-ledger.txt'), emails);
  console.log(`${f}: ${added} new emails into ledger`);
  total += added;
}
console.log(`TOTAL added: ${total}`);
