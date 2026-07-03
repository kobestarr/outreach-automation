#!/usr/bin/env node
// load-to-mailead.js — the send-batch last mile. Reads the campaign's ToSend sheet
// and loads leads into an existing Mailead campaign via the direct add_lead API.
// Replaces the (never-built) TaskMagic flow. Spec: docs/taskmagic-flow-brief.md.
//
// Only the FOUR Title Case columns are mapped (First Name, Last Name, Email,
// Company Name). Last Name carries the packed insight phrase by design. Every
// real_* / reoon* column is ignored.
//
// Idempotent: keeps a per-campaign load-ledger (data/mailead-loaded-<id>.txt) so
// re-runs never double-push. Mailead's add_lead has NO server-side dedup and its
// success message is not proof of persistence, so this ledger is our source of truth.
//
// Usage:
//   node load-to-mailead.js --campaign <key> --title "<Mailead campaign title>" [--dry-run] [--limit N]
//   node load-to-mailead.js --campaign ksd-pro-services --title ksd-pro-services-2026-07-02 --dry-run
const fs = require('fs'), path = require('path');
const { getCampaign } = require('./shared/outreach-core/campaigns/campaign-registry');
const { MAILEAD_LABELS } = require('./shared/outreach-core/campaigns/sheet-rows');
const { isValidEmail } = require('./shared/outreach-core/validation/data-quality');

const TAB = 'ToSend';
const L = MAILEAD_LABELS; // { first_name:'First Name', last_name:'Last Name', email:'Email', company_name:'Company Name', ... }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Map a sheet row (keyed by header label) to a lead using ONLY the Mailead block columns.
function rowToLead(row) {
  return {
    first_name: (row[L.first_name] || '').trim(),
    last_name: (row[L.last_name] || '').trim(),
    email: (row[L.email] || '').trim(),
    company_name: (row[L.company_name] || '').trim(),
  };
}

function readLoadLedger(file) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean));
}
function appendLoadLedger(file, email) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, email.toLowerCase() + '\n');
}

async function loadBatch(opts, io) {
  const { campaign, title, campaignId = null, dryRun = false, limit = 0, spacingMs = 150, maxRetries = 3 } = opts;
  const log = io.log || console.log;

  // 1. Resolve sheet + rows
  const entry = getCampaign(io.registryFile, campaign);
  if (!entry || !entry.sheetId) throw new Error(`Campaign '${campaign}' has no registered sheet.`);
  const { header, rows } = await io.sheets.readRows(entry.sheetId, TAB);
  for (const col of [L.first_name, L.last_name, L.email, L.company_name]) {
    if (!header.includes(col)) throw new Error(`ToSend sheet missing required column '${col}'. Header: ${header.join(', ')}`);
  }

  // 2. Map + filter (must have an email)
  const leads = [];
  const noEmail = [];
  for (const row of rows) {
    const lead = rowToLead(row);
    if (!lead.email || !isValidEmail(lead.email)) { noEmail.push(row); continue; }
    leads.push(lead);
  }

  // 3. Dedup: within this batch + against the load-ledger
  const ledger = readLoadLedger(io.ledgerFile);
  const seen = new Set();
  const fresh = [];
  const alreadyLoaded = [];
  const dupInFile = [];
  for (const lead of leads) {
    const key = lead.email.toLowerCase();
    if (ledger.has(key)) { alreadyLoaded.push(lead); continue; }
    if (seen.has(key)) { dupInFile.push(lead); continue; }
    seen.add(key);
    fresh.push(lead);
  }
  const targets = limit > 0 ? fresh.slice(0, limit) : fresh;

  // 4. Report / preview
  const missingInsight = targets.filter(l => !l.last_name).map(l => l.email);
  log(`[${campaign}] sheet rows:${rows.length} mapped:${leads.length} no-email:${noEmail.length} ` +
      `already-loaded:${alreadyLoaded.length} dup-in-sheet:${dupInFile.length} to-push:${targets.length}` +
      (limit > 0 ? ` (limited from ${fresh.length})` : ''));
  if (missingInsight.length) {
    log(`  NOTE: ${missingInsight.length} lead(s) have EMPTY Last Name (no insight carrier) -> ` +
        `email body line would render a gap. Emails: ${missingInsight.slice(0, 5).join(', ')}${missingInsight.length > 5 ? ' ...' : ''}`);
  }

  if (dryRun) {
    log('  DRY-RUN sample (first 3 mapped payloads):');
    for (const lead of targets.slice(0, 3)) {
      log('    ' + JSON.stringify({ email_to_add: lead.email, first_name: lead.first_name, last_name: lead.last_name, company_name: lead.company_name }));
    }
    return { toPush: targets.length, pushed: 0, failed: [], skipped: alreadyLoaded.length + dupInFile.length + noEmail.length, missingInsight };
  }

  // 5. Live push with retry + spacing; ledger each success immediately (resumable)
  const cid = campaignId !== null ? campaignId : await io.resolveCampaignId(title);
  log(`  target campaign '${title}' -> id ${cid}. Pushing ${targets.length}...`);
  let pushed = 0;
  const failed = [];
  for (let i = 0; i < targets.length; i++) {
    const lead = targets[i];
    let ok = false, lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await io.addLead(cid, lead);
        if (res.ok && res.json && res.json.success) { ok = true; break; }
        lastErr = `status ${res.status}: ${JSON.stringify(res.json)}`;
      } catch (e) { lastErr = e.message; }
      if (attempt < maxRetries) await sleep(spacingMs * attempt * 4); // backoff
    }
    if (ok) {
      pushed++;
      appendLoadLedger(io.ledgerFile, lead.email);
    } else {
      failed.push({ email: lead.email, error: lastErr });
    }
    if ((i + 1) % 50 === 0) log(`    ...${i + 1}/${targets.length} (pushed ${pushed}, failed ${failed.length})`);
    await sleep(spacingMs);
  }
  log(`[${campaign}] DONE pushed:${pushed} failed:${failed.length}`);
  for (const f of failed.slice(0, 10)) log(`  FAIL ${f.email}: ${f.error}`);
  return { toPush: targets.length, pushed, failed, skipped: alreadyLoaded.length + dupInFile.length + noEmail.length, missingInsight };
}

module.exports = { loadBatch, rowToLead };

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const flag = n => args.includes('--' + n);
    const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

    const campaign = val('campaign');
    const title = val('title');
    if (!campaign || !title) {
      console.error('Usage: node load-to-mailead.js --campaign <key> --title "<Mailead campaign title>" [--dry-run] [--limit N]');
      process.exit(2);
    }
    const limitRaw = val('limit');
    const limit = limitRaw === null ? 0 : parseInt(limitRaw, 10);
    if (limitRaw !== null && (!Number.isInteger(limit) || limit <= 0)) {
      console.error(`--limit must be a positive integer (got '${limitRaw}')`); process.exit(2);
    }

    const sheets = require('./shared/outreach-core/sheets/sheets-client');
    const mailead = require('./shared/outreach-core/campaigns/mailead-client');
    // Resolve the campaign id up front: verifies the campaign exists (even on dry-run)
    // and keys the ledger by id so retitled/renamed campaigns can never share a ledger.
    const campaignId = await mailead.resolveCampaignId(title);
    const idSlug = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const ledgerFile = path.join(__dirname, `data/mailead-loaded-${campaignId}-${idSlug}.txt`);
    const legacyLedger = path.join(__dirname, `data/mailead-loaded-${idSlug}.txt`);
    if (!fs.existsSync(ledgerFile) && fs.existsSync(legacyLedger)) {
      fs.renameSync(legacyLedger, ledgerFile);
      console.log(`Migrated ledger ${path.basename(legacyLedger)} -> ${path.basename(ledgerFile)}`);
    }
    const io = {
      registryFile: path.join(__dirname, 'config/campaign-sheets.json'),
      ledgerFile,
      sheets,
      resolveCampaignId: mailead.resolveCampaignId,
      addLead: mailead.addLead,
      log: console.log,
    };
    await loadBatch({ campaign, title, campaignId, dryRun: flag('dry-run'), limit }, io);
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
