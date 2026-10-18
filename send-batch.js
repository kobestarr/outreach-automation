#!/usr/bin/env node
// send-batch.js: CSV -> normalise -> dedup -> Reoon verify -> naturalise ->
// compose insights -> append to the campaign's Google Sheet (tab ToSend) -> ledger.
// Spec: docs/superpowers/specs/2026-07-02-send-batch-pipeline-design.md
//
// Usage: node send-batch.js <csv> --campaign <key> [--dry-run] [--limit N] [--skip-verify]
// Files with email_status columns (enrich-owner-emails.js) are routed main / inbox / probable per config/campaign-sheets.json finderRoutes.
// Env: OA_DATA_DIR pins where ledgers live (required for a live run from a git worktree).
const fs = require('fs'), path = require('path');
const { parseCSV, toCSV } = require('./shared/outreach-core/csv/csv-util');
const { normalise } = require('./shared/outreach-core/csv/normalise');
const { dedupe } = require('./shared/outreach-core/csv/dedup');
const { readLedger, appendLedger } = require('./shared/outreach-core/csv/ledger');
const { getCampaign, saveCampaign } = require('./shared/outreach-core/campaigns/campaign-registry');
const { buildHeader, buildRow } = require('./shared/outreach-core/campaigns/sheet-rows');
const { composeInsights } = require('./shared/outreach-core/content-generation/insight-composer');
const { routeFor } = require('./shared/outreach-core/campaigns/finder-route');
const G = require('./shared/outreach-core/campaigns/send-guards');

const TAB = 'ToSend';
const SHARE_WITH = 'kobi@kobestarr.io';
const BAD_STATUSES = new Set(['invalid', 'disabled', 'disposable', 'spamtrap']); // project rule: keep risky
const ROUTES = ['main', 'inbox', 'probable'];
const SKIP_REOON_STATUSES = new Set(['safe', 'role_account', 'inbox_full']); // what the finder's own Reoon check can vouch for
const REOON_FRESH_MS = 30 * 86400000;

// Spec: docs/superpowers/specs/2026-10-18-email-finder-integration-design.md (revisions 1-6)
async function runBatch(opts, io) {
  const { csvPath, campaign, dryRun = false, limit = 0, skipVerify = false } = opts;
  const log = io.log || console.log;
  const dataDir = io.dataDir || path.dirname(io.ledgerFile);
  const nowMs = io.now ? io.now() : Date.now();
  const today = io.today ? io.today() : new Date(nowMs).toISOString().slice(0, 10);
  const finder = io.finder || null;

  // Fail closed: a live run must be able to check suppression and the Reoon balance.
  if (!dryRun && !finder) throw new Error('The email finder could not be loaded, so suppression and the Reoon balance cannot be checked. Refusing a live run. Fix the finder (email-finder balance) and run again.');
  if (!dryRun && (typeof finder.isSuppressed !== 'function')) throw new Error('This email finder is too old: it has no isSuppressed(). Update kobestarr-tools engines/email-finder.');
  if (dryRun && (!finder || typeof finder.isSuppressed !== 'function')) log('NOTE: finder suppression was not checked (finder unavailable or too old). A live run would refuse to start.');

  // 1. Load + normalise
  const rows = parseCSV(io.readFile ? io.readFile(csvPath) : fs.readFileSync(csvPath, 'utf8'));
  const { leads: allLeads, skipped: badRows } = normalise(rows);
  const leads = limit > 0 ? allLeads.slice(0, limit) : allLeads;
  const skipped = [...badRows];

  // 2. Route every lead by how its address was found (fail closed), then the never-send gates
  const routed = leads.map(lead => ({ lead, ...routeFor(lead) }));
  const excluded = routed.filter(x => x.route === 'excluded').map(x => ({ ...x.lead, route: 'excluded', reason: x.reason }));
  const dnc = G.readDoNotContact(path.join(dataDir, 'do-not-contact.txt'));
  const isSuppressed = lead => !!finder && typeof finder.isSuppressed === 'function' &&
    [lead.email, G.firmDomain(lead.website)].filter(Boolean).some(x => finder.isSuppressed(x));
  const ledgerSet = readLedger(io.ledgerFile);
  const firms = G.firmContext(dataDir);
  const routeOf = new Map(routed.map(x => [x.lead, x.route]));
  let gated = [];
  const emailSeen = new Set();
  for (const { lead, route } of routed) {
    if (route === 'excluded') continue;
    const why = G.isDoNotContact(dnc, lead) || (isSuppressed(lead) ? 'finder_suppressed' : null);
    if (why) { skipped.push({ email: lead.email, reason: why }); continue; }
    if (emailSeen.has(lead.email)) { skipped.push({ email: lead.email, reason: 'dupe_in_file' }); continue; }
    emailSeen.add(lead.email);
    if (ledgerSet.has(lead.email)) { skipped.push({ email: lead.email, reason: 'in_ledger' }); continue; }
    const seen = G.firmSeen(firms, lead);
    if (seen) { skipped.push({ email: lead.email, reason: seen }); continue; }
    gated.push({ lead, route });
  }
  const firmPass = G.dedupeFirms(gated);
  skipped.push(...firmPass.dropped);
  gated = firmPass.kept;

  // 3. Pre-flight: every route that has rows needs a registered sheet BEFORE anything is pushed
  let entry = getCampaign(io.registryFile, campaign);
  const routeKeys = (entry && entry.finderRoutes) || {};
  const targets = { main: { key: campaign, entry } };
  const held = {}, missingSheets = [];
  if (entry && !entry.sheetId) missingSheets.push(campaign); // registered but no sheet yet (e.g. 'sheet pending')
  for (const route of ROUTES.slice(1)) {
    const items = gated.filter(x => x.route === route);
    if (!items.length) continue;
    const key = routeKeys[route];
    if (!key) { held[route] = { items, key: null }; continue; }
    const e = getCampaign(io.registryFile, key);
    if (!e || !e.sheetId) { missingSheets.push(key); continue; }
    targets[route] = { key, entry: e };
  }
  if (missingSheets.length) {
    const msg = `Campaign sheet missing for route${missingSheets.length > 1 ? 's' : ''} ${missingSheets.map(k => `'${k}'`).join(', ')}. Nothing was pushed. ` +
      `Create the blank sheet (tab '${TAB}'), share it with the service account, then: node send-batch.js --register <key> <sheet URL>`;
    if (!dryRun) throw new Error(msg);
    log('DRY-RUN WARNING: ' + msg);
  }

  // 4. Main campaign entry (auto-create if new)
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
    targets.main = { key: campaign, entry };
  }

  // 5. Dedupe against each target sheet
  const groups = {};
  for (const route of ROUTES) {
    const t = targets[route];
    const items = gated.filter(x => x.route === route && t);
    if (!t) continue;
    const sheetEmails = t.entry.sheetId ? await io.sheets.readColumn(t.entry.sheetId, TAB, 'real_email') : [];
    const { kept, skipped: dupes } = dedupe(items.map(x => x.lead), new Set(), new Set(sheetEmails));
    skipped.push(...dupes);
    groups[route] = kept;
  }

  // 6. Held (route with no campaign key) and excluded rows are written out, never dropped silently
  const heldOut = {};
  for (const [route, h] of Object.entries(held)) {
    const file = path.join(dataDir, `held-${campaign}-${route}.csv`);
    writeRows(file, h.items.map(x => x.lead), route, `no campaign key for route '${route}'`);
    heldOut[route] = { n: h.items.length, file };
    log(`HELD ${h.items.length} ${route} rows (no campaign configured for this route): ${file}`);
  }
  let excludedFile = null;
  if (excluded.length) {
    excludedFile = path.join(dataDir, `excluded-${campaign}-${today}.csv`);
    writeRows(excludedFile, excluded, 'excluded', null);
    const why = {}; excluded.forEach(e => { why[e.reason] = (why[e.reason] || 0) + 1; });
    log(`EXCLUDED ${excluded.length} rows (${JSON.stringify(why)}): ${excludedFile}`);
  }
  const wouldPushByRoute = Object.fromEntries(ROUTES.map(r => [r, (groups[r] || []).length]));
  const wouldPush = Object.values(wouldPushByRoute).reduce((a, b) => a + b, 0);
  const base = { skipped, excluded, held: heldOut, excludedFile, missingSheets, sheetUrl: entry.sheetUrl };

  if (dryRun) {
    log(`DRY-RUN [${campaign}] input:${leads.length} would-push:${wouldPush} ${JSON.stringify(wouldPushByRoute)} held:${Object.values(heldOut).reduce((a, h) => a + h.n, 0)} excluded:${excluded.length}`);
    for (const s of skipped.slice(0, 10)) log(`  skip ${s.email} (${s.reason})`);
    if (groups.main && groups.main[0]) log('  sample insights: ' + JSON.stringify(composeInsights(groups.main[0], entry.carriers || {})));
    return { ...base, wouldPush, wouldPushByRoute, pushed: 0 };
  }

  // 7. Reoon: skip rows the finder verified itself in the last 30 days; check the daily balance before spending
  const all = ROUTES.flatMap(r => groups[r] || []);
  const vouched = new Map();
  if (!skipVerify && finder && typeof finder.lastVerified === 'function') {
    for (const lead of all) {
      if (!lead.ref || lead.ref.email_source !== 'finder') continue;
      let v = null;
      try { v = finder.lastVerified(lead.email); } catch { v = null; } // any doubt means a normal Reoon check
      if (v && SKIP_REOON_STATUSES.has(v.status) && Number.isFinite(v.verified_at) && nowMs - v.verified_at < REOON_FRESH_MS && nowMs >= v.verified_at) vouched.set(lead, v);
    }
  }
  const toVerify = skipVerify ? [] : all.filter(l => !vouched.has(l));
  if (toVerify.length) {
    let daily;
    try {
      if (typeof finder.balance !== 'function') throw new Error('finder has no balance()');
      daily = Number((await finder.balance()).daily);
      if (!Number.isFinite(daily)) throw new Error('no daily figure');
    } catch (e) {
      const aborted = `could not read the Reoon balance (${e.message}), so nothing was verified or pushed`;
      log('ABORTED: ' + aborted);
      return { ...base, pushed: 0, aborted };
    }
    if (toVerify.length > daily) {
      const aborted = `Reoon daily credits too low: ${toVerify.length} addresses need checking, ${daily} left today. Nothing was verified or pushed (the reserve is never touched). Use --limit ${Math.max(0, daily)} or wait for tomorrow.`;
      log('ABORTED: ' + aborted);
      return { ...base, pushed: 0, aborted };
    }
  }

  // 8. Verify (Reoon) unless pre-verified
  const survivorsBy = {};
  let verifiedBy = {};
  if (toVerify.length) {
    const results = await io.verifyEmails(toVerify.map(l => l.email));
    verifiedBy = Object.fromEntries(results.map(r => [String(r.email).toLowerCase(), r]));
  }
  let noResult = 0;
  for (const route of ROUTES) {
    survivorsBy[route] = [];
    for (const lead of groups[route] || []) {
      if (skipVerify) { survivorsBy[route].push(lead); continue; }
      const v = vouched.get(lead);
      if (v) { lead.reoonStatus = v.status; lead.reoonScore = ''; lead.reoonSafe = v.status === 'safe' ? '1' : '0'; survivorsBy[route].push(lead); continue; }
      const r = verifiedBy[lead.email];
      if (!r) { noResult++; skipped.push({ email: lead.email, reason: 'reoon_no_result' }); continue; }
      if (BAD_STATUSES.has(r.status)) { skipped.push({ email: lead.email, reason: 'reoon_' + r.status }); continue; }
      lead.reoonStatus = r.status; lead.reoonScore = String(r.score ?? ''); lead.reoonSafe = r.isSafeToSend ? '1' : '0';
      survivorsBy[route].push(lead);
    }
  }
  if (noResult) log(`WARNING: ${noResult} leads had no Reoon result (daily quota truncation?) - skipped, NOT pushed. Re-run tomorrow or use --limit.`);

  // 9. Per route: naturalise, compose insights, append, ledgers
  const pushedByRoute = { main: 0, inbox: 0, probable: 0 };
  const urls = {};
  for (const route of ROUTES) {
    let survivors = survivorsBy[route] || [];
    const t = targets[route];
    if (!t || !survivors.length) continue;
    if (io.naturalise) survivors = await io.naturalise(survivors);
    const carriers = t.entry.carriers || {};
    const header = buildHeader([...new Set(survivors.flatMap(l => Object.keys(l.ref || {})))], Object.keys(carriers));
    const outRows = survivors.map(l => buildRow(l, header, composeInsights(l, carriers)));
    const res = await io.sheets.appendRows(t.entry.sheetId, TAB, header, outRows);
    pushedByRoute[route] = res.appended;
    appendLedger(io.ledgerFile, survivors.map(l => l.email));
    G.appendCompanyLedger(path.join(dataDir, 'company-ledger.txt'), survivors.map(l => ({ company_number: l.ref && l.ref.company_number, domain: G.firmDomain(l.website) })));
    urls[route] = t.entry.sheetUrl;
  }
  G.seedCompanyLedger(dataDir);
  const pushed = Object.values(pushedByRoute).reduce((a, b) => a + b, 0);
  log(`[${campaign}] pushed:${pushed} ${JSON.stringify(pushedByRoute)} skipped:${skipped.length} excluded:${excluded.length} held:${Object.values(heldOut).reduce((a, h) => a + h.n, 0)} sheet: ${entry.sheetUrl}`);
  return { ...base, pushed, pushedByRoute, sheetUrls: urls };
}

function writeRows(file, leads, route, reason) {
  const H = ['email', 'first_name', 'last_name', 'company_name', 'category', 'town', 'website', 'company_number', 'email_status', 'email_confidence', 'email_rule', 'route', 'reason'];
  const line = l => [l.email, l.first_name, l.last_name, l.company_name, l.category, l.town, l.website, l.ref && l.ref.company_number,
    l.ref && l.ref.email_status, l.ref && l.ref.email_confidence, l.ref && l.ref.email_rule, route, reason || l.reason || ''];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toCSV([H, ...leads.map(line)]));
}

/** --register <key> <sheet URL>: merge into the existing entry so finderRoutes, carriers and the mailead block survive. */
function registerCampaign({ registryFile, key, url, extractSheetId }) {
  const existing = getCampaign(registryFile, key) || {};
  const merged = { ...existing, sheetId: extractSheetId(url), sheetUrl: url, label: existing.label || key, carriers: existing.carriers || {} };
  if (typeof merged.note === 'string' && /^sheet pending/i.test(merged.note)) delete merged.note;
  saveCampaign(registryFile, key, merged);
  return merged;
}

module.exports = { runBatch, registerCampaign };

// ---- CLI ----
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const flag = n => args.includes('--' + n);
    const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

    const registryFile = path.join(__dirname, 'config/campaign-sheets.json');
    // --register <key> <sheet URL>: manual fallback for blocked auto-create. Merges into the existing entry.
    if (flag('register')) {
      const i = args.indexOf('--register');
      const [key, url] = [args[i + 1], args[i + 2]];
      const { extractSheetId } = require('./shared/outreach-core/sheets/sheets-client');
      if (!key || !url) { console.error('Usage: node send-batch.js --register <campaign> <sheet URL>'); process.exit(2); }
      const merged = registerCampaign({ registryFile, key, url, extractSheetId });
      console.log(`Registered '${key}'.`);
      if (Object.keys(merged.carriers).length === 0) {
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
    const dryRun = flag('dry-run');

    // All ledgers, do-not-contact and load files come from ONE pinned folder (OA_DATA_DIR, default the main checkout).
    // A live run from a git worktree without OA_DATA_DIR is refused: a worktree's data/ is a stale copy.
    const dataDir = G.resolveDataDir({ repoDir: __dirname, dryRun });

    // Read-only finder: suppression, 30-day Reoon memory and the Reoon balance. No finding, no credits spent.
    let finder = null;
    try { finder = require('./shared/outreach-core/enrichment/email-finder-adapter').openFinder({ maxCredits: 0, maxIcypeas: 0 }); }
    catch (e) { console.error(`Email finder unavailable: ${e.message}`); }

    const sheets = require('./shared/outreach-core/sheets/sheets-client');
    const { verifyEmails, getQuotaRemaining } = require('./shared/outreach-core/email-verification/reoon-verifier');
    const io = {
      registryFile,
      dataDir,
      ledgerFile: path.join(dataDir, 'sent-ledger.txt'),
      sheets,
      finder,
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
    let res;
    try { res = await runBatch({ csvPath, campaign, dryRun, limit, skipVerify: flag('skip-verify') }, io); }
    finally { try { if (finder) finder.close(); } catch { /* best effort */ } }
    if (res.aborted) process.exit(3);
    if (!dryRun && !flag('skip-verify')) console.log('Reoon quota remaining today:', getQuotaRemaining());
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
