#!/usr/bin/env node
/**
 * For each row (needs website + owner_first from add-ch-owners.js) pick the best email to reach the OWNER.
 * Phase 1 scrapes every site (resumable). Phase 2 asks Kobi's email finder, once, about the rows that still have
 * no owner address (owner name present AND maps_match yes/probable), then chooseOwnerEmail() picks by status.
 * Resumable: <out>.jsonl holds v:2 records; only FINAL finder answers count as done, errors and skips run again.
 * Writes <out> CSV at the end with email_status, email_confidence, email_suggested (never sent), email_source, email_checked_at.
 *
 * Usage: node enrich-owner-emails.js <in.csv> --out <out.csv> [--no-guess] [--limit N] [--max-credits N] [--max-icypeas N]
 *   --max-credits  Reoon credits for this run. Default: today's daily balance minus 300 (the funded daily batch shares the key).
 *   --max-icypeas  Icypeas finds for this run. Default 0.
 * Never spends the Reoon reserve. A new --out is a new run; reuse the same --out only to resume.
 */
const fs = require('fs');
const { parseCSV, toCSV } = require('./shared/outreach-core/csv/csv-util');
const { pickBestEmail, chooseOwnerEmail } = require('./shared/outreach-core/enrichment/owner-email');

const OUT_COLUMNS = ['email', 'email_rule', 'email_fallback', 'emails_scraped', 'email_status', 'email_confidence', 'email_suggested', 'email_source', 'email_checked_at'];
// Finder answers that are an answer. Anything else (error, skipped, not_run, retry_later) runs again on resume.
const FINAL = new Set(['found', 'found_flagged', 'found_generic', 'catch_all_found', 'icypeas_found', 'catch_all_unresolved',
  'unverifiable', 'left_company', 'not_found', 'no_mx', 'suppressed', 'bad_input']);
const SCRAPE_MATCH = new Set(['yes', 'probable', 'check']);
const FINDER_MATCH = new Set(['yes', 'probable']);
const OWNER_SCRAPED = new Set(['owner-match', 'owner-freemail']);
/** Does this row go to the finder? Needs a site, an owner name, a confirmed Maps match, and no scraped owner address yet. */
function needsFinder(row, scrapedRule, noGuess = false) {
  return !noGuess && !!row.website && !!String(row.owner_first || '').trim() && FINDER_MATCH.has(row.maps_match) && !OWNER_SCRAPED.has(scrapedRule);
}
const keyOf = (r, i) => (r.company_number ? String(r.company_number) : `row${i}`);

/** Last record per row wins; v1 records (no v) are ignored; a row only counts as finder-done on a FINAL status. */
function loadRecords(records) {
  const scrape = new Map(), finder = new Map();
  let ignored = 0;
  for (const rec of records || []) {
    if (!rec || rec.v !== 2 || !rec.key) { ignored++; continue; }
    if (rec.kind === 'scrape') scrape.set(rec.key, rec);
    else if (rec.kind === 'finder') {
      if (rec.result && FINAL.has(rec.result.status)) finder.set(rec.key, rec);
      else finder.delete(rec.key);
    }
  }
  return { scrape, finder, ignored };
}

async function enrichRows(rows, io) {
  const log = io.log || (() => {});
  const now = io.now || (() => new Date());
  const { scrape: scraped, finder: finderDone, ignored } = loadRecords(io.records);
  if (ignored) log(`ignoring ${ignored} old or unreadable resume records (v1 or torn lines)`);
  const append = rec => io.appendRecord && io.appendRecord({ v: 2, ...rec });

  // ---- Phase 1: scrape every row ----
  const picks = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], key = keyOf(r, i);
    let rec = scraped.get(key);
    if (!rec) {
      let emails = [], error = '';
      const canScrape = r.website && SCRAPE_MATCH.has(r.maps_match);
      if (canScrape) {
        try { const s = await io.scrape(r.website); emails = (s && s.emails) || []; error = (s && s.error) || ''; }
        catch (e) { error = e.message; }
      }
      const pick = canScrape ? pickBestEmail({ emails, website: r.website, owner: { first: r.owner_first, last: r.owner_last } }) : { email: null, rule: 'no-website' };
      rec = { kind: 'scrape', key, company_number: r.company_number || '', scraped: emails, pick: { email: pick.email || '', rule: pick.rule }, error };
      append(rec); scraped.set(key, rec);
      log(`scrape ${i + 1}/${rows.length} ${String(r.company_name).slice(0, 30)} -> ${pick.email || '-'} (${pick.rule})`);
    }
    picks[i] = rec;
  }

  // ---- Phase 2: one findMany call for the rows that still have no owner address ----
  const eligible = rows.map((_, i) => i).filter(i => needsFinder(rows[i], picks[i].pick.rule, io.noGuess));
  const results = new Map(); // row index -> { result, checked_at }
  for (const i of eligible) { const d = finderDone.get(keyOf(rows[i], i)); if (d) results.set(i, { result: d.result, checked_at: d.checked_at || '' }); }
  const queue = eligible.filter(i => !results.has(i));
  const report = { rows: rows.length, finder_rows: eligible.length, resumed: eligible.length - queue.length, queued: queue.length,
    reoon_used: 0, icypeas_used: 0, rerun: 0, finder_error: '', by_status: {}, by_rule: {} };

  if (queue.length) {
    let finder = null;
    try {
      finder = await io.openFinder();
      const batch = queue.map(i => ({ owner_first: rows[i].owner_first, owner_last: rows[i].owner_last, website: rows[i].website, company_name: rows[i].company_name }));
      const keep = (qi, result) => {
        const i = queue[qi], checked_at = now().toISOString();
        results.set(i, { result, checked_at });
        append({ kind: 'finder', key: keyOf(rows[i], i), company_number: rows[i].company_number || '', result, checked_at });
      };
      const { results: out, summary } = await finder.findMany(batch, { onResult: (qi, _p, result) => keep(qi, result) });
      out.forEach((result, qi) => keep(qi, result)); // final answers (a retry pass may have changed them) supersede
      report.reoon_used = (summary && summary.reoon_used) || 0;
      report.icypeas_used = (summary && summary.icypeas_used) || 0;
    } catch (e) {
      report.finder_error = e.message;
      log(`FINDER FAILED: ${e.message}. Scraped picks are kept; rerun to retry the finder rows.`);
      // Rows that already got a FINAL answer before the failure keep it; every other queued row is an error to re-run.
      queue.filter(i => !results.has(i) || !FINAL.has(results.get(i).result.status))
        .forEach(i => results.set(i, { result: { status: 'error', email: '', note: e.message }, checked_at: now().toISOString() }));
    } finally {
      try { if (finder && finder.close) finder.close(); } catch { /* closing is best effort */ }
    }
  }
  report.rerun = [...results.values()].filter(x => !FINAL.has(x.result.status)).length;

  // ---- Phase 3: choose by status ----
  const out = rows.map((r, i) => {
    const scrapedRec = picks[i];
    const f = results.get(i);
    const c = chooseOwnerEmail({ pick: scrapedRec.pick, finderResult: f ? f.result : null });
    const status = !f && !c.email ? 'not_checked' : c.email_status;
    const fallback = scrapedRec.pick.email && scrapedRec.pick.email !== c.email ? scrapedRec.pick.email : '';
    const row = { ...r, email: c.email, email_rule: c.email_rule, email_fallback: fallback, emails_scraped: (scrapedRec.scraped || []).join(' '),
      email_status: status, email_confidence: c.email_confidence, email_suggested: c.email_suggested, email_source: c.email_source,
      email_checked_at: f ? f.checked_at : '' };
    report.by_status[status] = (report.by_status[status] || 0) + 1;
    report.by_rule[c.email_rule] = (report.by_rule[c.email_rule] || 0) + 1;
    return row;
  });
  return { rows: out, report };
}

function parseEnrichArgs(argv) {
  const args = argv.slice(2);
  const inFile = args.find(a => !a.startsWith('--') && a.endsWith('.csv') && args[args.indexOf(a) - 1] !== '--out');
  if (!inFile) throw new Error('Usage: node enrich-owner-emails.js <in.csv> --out <out.csv> [--no-guess] [--limit N] [--max-credits N] [--max-icypeas N]');
  const val = n => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1]; };
  const has = n => args.includes('--' + n);
  const int = (n, def, min) => {
    if (!has(n)) return def;
    const v = val(n);
    if (v === undefined || !/^\d+$/.test(v) || parseInt(v, 10) < min) throw new Error(`--${n} needs a whole number >= ${min} (got '${v === undefined ? '' : v}')`);
    return parseInt(v, 10);
  };
  return { inFile, out: val('out') || inFile.replace(/\.csv$/, '-emails.csv'), noGuess: has('no-guess'),
    limit: int('limit', 0, 1), maxCredits: int('max-credits', undefined, 0), maxIcypeas: int('max-icypeas', 0, 0) };
}

function rowsToCsv(rows, baseHeader) {
  const H = [...baseHeader.filter(h => !OUT_COLUMNS.includes(h)), ...OUT_COLUMNS];
  return toCSV([H, ...rows.map(r => H.map(h => r[h]))]);
}

module.exports = { enrichRows, needsFinder, parseEnrichArgs, loadRecords, rowsToCsv, FINAL, OUT_COLUMNS };

if (require.main === module) {
  (async () => {
    const a = parseEnrichArgs(process.argv);
    const { scrapeWebsite } = require('./shared/outreach-core/enrichment/website-scraper');
    const { openFinderBounded } = require('./shared/outreach-core/enrichment/email-finder-adapter');
    const JL = a.out + '.jsonl';
    const parsed = parseCSV(fs.readFileSync(a.inFile, 'utf8')).filter(r => r.length > 1);
    const H = parsed[0];
    let rows = parsed.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
    if (a.limit) rows = rows.slice(0, a.limit);
    const records = fs.existsSync(JL) ? fs.readFileSync(JL, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }) : [];
    const { rows: out, report } = await enrichRows(rows, {
      noGuess: a.noGuess, records, log: console.log,
      scrape: w => Promise.race([scrapeWebsite(w), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 60000))]),
      appendRecord: rec => fs.appendFileSync(JL, JSON.stringify(rec) + '\n'),
      openFinder: () => openFinderBounded({ maxCredits: a.maxCredits, maxIcypeas: a.maxIcypeas }),
    });
    fs.writeFileSync(a.out, rowsToCsv(out, H));
    console.log('STATUS:', JSON.stringify(report.by_status), '| RULES:', JSON.stringify(report.by_rule));
    console.log(`finder rows ${report.finder_rows} (resumed ${report.resumed}) | Reoon credits used ${report.reoon_used} | Icypeas used ${report.icypeas_used}`);
    if (report.rerun) console.log(`${report.rerun} finder rows did not get a final answer (error, skipped or retry). Run the same command again to retry only those.`);
    console.log('wrote', a.out);
    process.exit(0);
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
