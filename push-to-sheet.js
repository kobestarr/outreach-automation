#!/usr/bin/env node
// Append a Mailead-ready CSV to the ToSend staging sheet (the TaskMagic -> Mailead
// pickup point). Thin CLI over shared/outreach-core/sheets/sheets-client.js.
// Usage: node push-to-sheet.js <sheet URL or ID> <csv path> [--tab ToSend]
const fs = require('fs');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { extractSheetId, appendRows } = require('./shared/outreach-core/sheets/sheets-client');

(async () => {
  const args = process.argv.slice(2);
  const positional = args.filter(a => !a.startsWith('--'));
  const tab = (() => { const i = args.indexOf('--tab'); return i >= 0 ? args[i + 1] : 'ToSend'; })();
  const sheetId = extractSheetId(positional[0] || '');
  const csvArg = positional[1];
  if (!sheetId || !csvArg || !fs.existsSync(csvArg)) {
    console.error('Usage: node push-to-sheet.js <sheet URL or ID> <csv path> [--tab ToSend]');
    process.exit(2);
  }
  const rows = parseCSV(fs.readFileSync(csvArg, 'utf8')).filter(r => r.length > 1);
  const res = await appendRows(sheetId, tab, rows[0], rows.slice(1));
  console.log(`OK — appended ${res.appended} rows to '${tab}'${res.wroteHeader ? ' (with header)' : ''}.`);
  console.log('URL: https://docs.google.com/spreadsheets/d/' + sheetId);
})().catch(e => { console.error('ERROR:', e.message); process.exit(3); });
