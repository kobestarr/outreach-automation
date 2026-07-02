// shared/outreach-core/csv/dedup.js
// Three-pass dedup: within-file, global sent-ledger, target-sheet. All skips reported.
function dedupe(leads, ledgerSet, sheetSet) {
  const lower = s => String(s).toLowerCase();
  const ledger = new Set([...ledgerSet].map(lower));
  const sheet = new Set([...sheetSet].map(lower));
  const seen = new Set();
  const kept = [], skipped = [];
  for (const lead of leads) {
    const e = lower(lead.email);
    if (seen.has(e)) { skipped.push({ email: e, reason: 'dupe_in_file' }); continue; }
    seen.add(e);
    if (ledger.has(e)) { skipped.push({ email: e, reason: 'in_ledger' }); continue; }
    if (sheet.has(e)) { skipped.push({ email: e, reason: 'in_sheet' }); continue; }
    kept.push(lead);
  }
  return { kept, skipped };
}

module.exports = { dedupe };
