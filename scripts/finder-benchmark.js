#!/usr/bin/env node
/**
 * Wave 1 benchmark for the email finder. COMPARISON ONLY: nothing here loads anything anywhere.
 *   Dry (default): prints the rows that would go to the finder and the worst-case Reoon credits. Makes no finder call.
 *   --live       : runs exactly those rows through enrichRows (live finder, daily Reoon credits only, never the reserve)
 *                  and prints old address vs new. Reuses the addresses already scraped (no re-scrape).
 * Usage: node scripts/finder-benchmark.js <final.csv> --out <NEW.csv> [--live] [--max-credits N] [--max-icypeas N]
 * --out must not exist: a benchmark never overwrites or resumes an earlier run.
 */
const fs = require('fs');
const path = require('path');
const { parseCSV } = require('../shared/outreach-core/csv/csv-util');
const { enrichRows, needsFinder, rowsToCsv } = require('../enrich-owner-emails');

function parseBenchArgs(argv) {
  const args = argv.slice(2);
  const inFile = args.find(a => !a.startsWith('--') && a.endsWith('.csv') && args[args.indexOf(a) - 1] !== '--out');
  const val = n => { const i = args.indexOf('--' + n); return i < 0 ? undefined : args[i + 1]; };
  const out = val('out');
  if (!inFile || !out || out.startsWith('--')) throw new Error('Usage: node scripts/finder-benchmark.js <final.csv> --out <NEW.csv> [--live] [--max-credits N] [--max-icypeas N]  (--out is required)');
  const int = (n, def) => {
    if (!args.includes('--' + n)) return def;
    const v = val(n);
    if (v === undefined || !/^\d+$/.test(v)) throw new Error(`--${n} needs a whole number (got '${v === undefined ? '' : v}')`);
    return parseInt(v, 10);
  };
  return { inFile, out, live: args.includes('--live'), maxCredits: int('max-credits', undefined), maxIcypeas: int('max-icypeas', 0) };
}

const finderShape = r => ({ owner_first: r.owner_first, owner_last: r.owner_last, website: r.website, company_name: r.company_name });

async function runBenchmark({ inFile, out, live, maxCredits, maxIcypeas = 0 }, deps) {
  const log = deps.log || console.log;
  if (fs.existsSync(out) || fs.existsSync(out + '.jsonl')) throw new Error(`${out} already exists. Use a NEW --out name: a benchmark never overwrites or resumes an earlier run.`);
  const parsed = parseCSV(fs.readFileSync(inFile, 'utf8')).filter(r => r.length > 1);
  const H = parsed[0];
  const rows = parsed.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i] || ''])));
  // The rule the earlier scrape recorded decides whether the row already has an owner address.
  const selected = rows.filter(r => needsFinder(r, r.email_rule));
  const est = deps.estimate(selected.map(finderShape));

  log(`Wave 1 finder benchmark: ${selected.length} of ${rows.length} rows would go to the finder (owner name, confirmed Maps match, no scraped owner address).`);
  log(`Worst case: ${est.worstCase} Reoon credits (${est.people} people, ${est.companyOnly} company-only, ${est.badInput} bad input). Typical is far lower: most people cost 1 to 2 credits.`);
  selected.forEach((r, i) => log(`${String(i + 1).padStart(3)}. ${String(r.company_name).slice(0, 34).padEnd(34)} ${`${r.owner_first} ${r.owner_last}`.trim().padEnd(22)} ${String(r.website).replace(/^https?:\/\/(www\.)?/, '').slice(0, 36).padEnd(36)} now: ${r.email || '-'} (${r.email_rule || '-'})`));
  if (!live) { log('Dry run: the finder was not called and nothing was written. Add --live to run these rows for real (daily Reoon credits only, nothing is loaded anywhere).'); return { selected, worstCase: est.worstCase, rows: [] }; }
  if (!selected.length) { log('Nothing to run.'); return { selected, worstCase: est.worstCase, rows: [] }; }

  const scrapedBySite = new Map(selected.map(r => [r.website, String(r.emails_scraped || '').split(/\s+/).filter(Boolean)]));
  const { rows: result, report } = await enrichRows(selected, {
    log: () => {}, now: deps.now,
    scrape: async w => ({ emails: scrapedBySite.get(w) || [] }),
    appendRecord: rec => fs.appendFileSync(out + '.jsonl', JSON.stringify(rec) + '\n'),
    openFinder: () => deps.openFinder({ maxCredits, maxIcypeas }),
  });
  fs.writeFileSync(out, rowsToCsv(result, H));
  const oldBy = new Map(selected.map(r => [r.company_number, r]));
  log('\nOld vs new:');
  result.forEach(r => { const o = oldBy.get(r.company_number); log(`  ${String(r.company_name).slice(0, 30).padEnd(30)} ${(o.email || '-').padEnd(34)} -> ${(r.email || '-').padEnd(34)} ${r.email_status} / ${r.email_rule}`); });
  log(`\nBy status: ${JSON.stringify(report.by_status)}`);
  log(`Reoon credits used ${report.reoon_used} | Icypeas used ${report.icypeas_used}${report.rerun ? ` | ${report.rerun} rows did not get a final answer` : ''}${report.finder_error ? ` | finder error: ${report.finder_error}` : ''}`);
  log(`Wrote ${out} (comparison only, nothing loaded).`);
  return { selected, worstCase: est.worstCase, rows: result, report };
}

module.exports = { runBenchmark, parseBenchArgs };

if (require.main === module) {
  (async () => {
    const a = parseBenchArgs(process.argv);
    const adapter = require('../shared/outreach-core/enrichment/email-finder-adapter');
    await runBenchmark(a, {
      estimate: rows => adapter.loadFinderDryRun()(rows, {}),
      openFinder: ({ maxCredits, maxIcypeas }) => adapter.openFinderBounded({ maxCredits, maxIcypeas }),
    });
    process.exit(0);
  })().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
