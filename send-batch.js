#!/usr/bin/env node
// send-batch.js — CSV -> normalise -> dedup -> Reoon verify -> naturalise ->
// compose insights -> append to the campaign's Google Sheet (tab ToSend) -> ledger.
// Spec: docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md
//
// Usage: node send-batch.js <csv> --campaign <key> [--dry-run] [--limit N] [--skip-verify]
const fs = require('fs'), path = require('path');
const { parseCSV } = require('./shared/outreach-core/csv/csv-util');
const { normalise } = require('./shared/outreach-core/csv/normalise');
const { dedupe } = require('./shared/outreach-core/csv/dedup');
const { readLedger, appendLedger } = require('./shared/outreach-core/csv/ledger');
const { getCampaign, saveCampaign } = require('./shared/outreach-core/campaigns/campaign-registry');
const { buildHeader, buildRow } = require('./shared/outreach-core/campaigns/sheet-rows');
const { composeInsights } = require('./shared/outreach-core/content-generation/insight-composer');

const TAB = 'ToSend';
const SHARE_WITH = 'kobi@kobestarr.io';
const BAD_STATUSES = new Set(['invalid', 'disabled', 'disposable', 'spamtrap']); // project rule: keep risky

async function runBatch(opts, io) {
  const { csvPath, campaign, dryRun = false, limit = 0, skipVerify = false } = opts;
  const log = io.log || console.log;

  // 1. Load + normalise
  const rows = parseCSV(io.readFile ? io.readFile(csvPath) : fs.readFileSync(csvPath, 'utf8'));
  const { leads: allLeads, skipped: badRows } = normalise(rows);
  const leads = limit > 0 ? allLeads.slice(0, limit) : allLeads;

  // 2. Campaign entry (auto-create sheet if new)
  let entry = getCampaign(io.registryFile, campaign);
  if (!entry) {
    if (dryRun) {
      log(`DRY-RUN: campaign '${campaign}' has no sheet yet; a live run would create + share one.`);
      entry = { sheetId: null, sheetUrl: '(would be created)', carriers: {} };
    } else {
      let createdMeta;
      try {
        createdMeta = await io.sheets.createSpreadsheet(`Outreach ToSend - ${campaign}`, TAB, SHARE_WITH);
      } catch (e) {
        throw new Error(
          `Could not auto-create a sheet for '${campaign}' (${e.message}).\n` +
          `Manual fallback: create a blank Google Sheet with a tab named '${TAB}', share it (Editor) with the service account, then register it:\n` +
          `  node send-batch.js --register ${campaign} <sheet URL>`);
      }
      entry = { sheetId: createdMeta.sheetId, sheetUrl: createdMeta.url, label: campaign, carriers: {} };
      saveCampaign(io.registryFile, campaign, entry);
      log(`Created sheet for '${campaign}': ${createdMeta.url}`);
    }
  }

  // 3. Dedup: file + ledger + target sheet
  const ledgerSet = readLedger(io.ledgerFile);
  const sheetEmails = entry.sheetId ? await io.sheets.readColumn(entry.sheetId, TAB, 'email') : [];
  const { kept, skipped: dupes } = dedupe(leads, ledgerSet, new Set(sheetEmails));
  const skipped = [...badRows, ...dupes];

  if (dryRun) {
    log(`DRY-RUN [${campaign}] input:${leads.length} would-verify:${skipVerify ? 0 : kept.length} would-push(before verify):${kept.length}`);
    for (const s of dupes.slice(0, 10)) log(`  skip ${s.email} (${s.reason})`);
    if (kept[0]) {
      const insights = composeInsights(kept[0], entry.carriers || {});
      log('  sample insights: ' + JSON.stringify(insights));
    }
    return { wouldPush: kept.length, skipped, pushed: 0 };
  }

  // 4. Verify (Reoon) unless pre-verified
  let survivors = kept;
  if (!skipVerify && kept.length) {
    const results = await io.verifyEmails(kept.map(l => l.email));
    const byEmail = Object.fromEntries(results.map(r => [String(r.email).toLowerCase(), r]));
    survivors = [];
    let noResult = 0;
    for (const lead of kept) {
      const r = byEmail[lead.email];
      if (!r) { noResult++; skipped.push({ email: lead.email, reason: 'reoon_no_result' }); continue; }
      if (BAD_STATUSES.has(r.status)) { skipped.push({ email: lead.email, reason: 'reoon_' + r.status }); continue; }
      lead.reoonStatus = r.status; lead.reoonScore = String(r.score ?? ''); lead.reoonSafe = r.isSafeToSend ? '1' : '0';
      survivors.push(lead);
    }
    if (noResult) log(`WARNING: ${noResult} leads had no Reoon result (daily quota truncation?) - skipped, NOT pushed. Re-run tomorrow or use --limit.`);
  }

  // 5. Naturalise company names (batched; identity fallback)
  if (io.naturalise) survivors = await io.naturalise(survivors);

  // 6. Compose insights + build rows
  const extraRefCols = [...new Set(survivors.flatMap(l => Object.keys(l.ref || {})))];
  const carrierFields = Object.keys(entry.carriers || {});
  const header = buildHeader(extraRefCols, carrierFields);
  const outRows = survivors.map(l => buildRow(l, header, composeInsights(l, entry.carriers || {})));

  // 7. Append + ledger + report
  let pushed = 0;
  if (outRows.length) {
    const res = await io.sheets.appendRows(entry.sheetId, TAB, header, outRows);
    pushed = res.appended;
    appendLedger(io.ledgerFile, survivors.map(l => l.email));
  }
  log(`[${campaign}] pushed:${pushed} skipped:${skipped.length} sheet: ${entry.sheetUrl}`);
  return { pushed, skipped, sheetUrl: entry.sheetUrl };
}

module.exports = { runBatch };

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const flag = n => args.includes('--' + n);
    const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

    const registryFile = path.join(__dirname, 'config/campaign-sheets.json');
    // --register <key> <sheet URL>: manual fallback for blocked auto-create
    if (flag('register')) {
      const i = args.indexOf('--register');
      const [key, url] = [args[i + 1], args[i + 2]];
      const { extractSheetId } = require('./shared/outreach-core/sheets/sheets-client');
      if (!key || !url) { console.error('Usage: node send-batch.js --register <campaign> <sheet URL>'); process.exit(2); }
      const carriers = (getCampaign(registryFile, key) || {}).carriers || {};
      saveCampaign(registryFile, key, { sheetId: extractSheetId(url), sheetUrl: url, label: key, carriers });
      console.log(`Registered '${key}'.`);
      if (Object.keys(carriers).length === 0) {
        console.log(`NOTE: no carriers configured for '${key}' - real values will map straight through to Mailead. Add carriers to config/campaign-sheets.json before sending if this campaign needs insight personalisation.`);
      }
      return;
    }

    const csvPath = args.find(a => !a.startsWith('--') && a.endsWith('.csv'));
    const campaign = val('campaign');
    if (!csvPath || !fs.existsSync(csvPath) || !campaign) {
      console.error('Usage: node send-batch.js <csv> --campaign <key> [--dry-run] [--limit N] [--skip-verify]');
      process.exit(2);
    }

    const sheets = require('./shared/outreach-core/sheets/sheets-client');
    const { verifyEmails, getQuotaRemaining } = require('./shared/outreach-core/email-verification/reoon-verifier');
    const io = {
      registryFile,
      ledgerFile: path.join(__dirname, 'data/sent-ledger.txt'),
      sheets,
      // zip input emails back in: do not assume reoon results carry .email
      verifyEmails: async emails => (await verifyEmails(emails)).map((r, i) => ({ ...r, email: r.email || emails[i] })),
      naturalise: null, // v1: company_full/company_name from the CSV is already clean for KSD batches
      log: console.log,
    };
    const limitRaw = val('limit');
    const limit = limitRaw === null ? 0 : parseInt(limitRaw, 10);
    if (limitRaw !== null && (!Number.isInteger(limit) || limit <= 0)) {
      console.error(`--limit must be a positive integer (got '${limitRaw}')`); process.exit(2);
    }
    const res = await runBatch({ csvPath, campaign, dryRun: flag('dry-run'), limit, skipVerify: flag('skip-verify') }, io);
    if (!flag('dry-run') && !flag('skip-verify')) console.log('Reoon quota remaining today:', getQuotaRemaining());
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
