#!/usr/bin/env node
// hiring-signals/run-signal-engine.js — the end-to-end wiring.
// source -> gate -> resolve (with the field mapping the Code Adversary specified) -> enrich -> digest.
// Intermediate results saved per stage under hiring-signals/runs/<date>/ so a long real run is
// inspectable and resumable. BUILD & STAGE ONLY: produces a digest, sends nothing.
//
// Usage: node hiring-signals/run-signal-engine.js [--brands kobestarr,stripped,dealflow]
//        [--max-enrich N] [--max-leads N] [--dry-source path.json] [--stage-from <sourced|gated|enriched>]
const fs = require('fs'), path = require('path');
const source = require('./hiring-signal-source');
const { gate, resolveDomainReal, companyProfileReal } = require('../shared/outreach-core/enrichment/company-quality-gate');
const { resolve } = require('../shared/outreach-core/enrichment/decision-maker-resolver');
const adapters = require('../shared/outreach-core/enrichment/resolver-adapters');
const { enrichDecisionMaker } = require('../shared/outreach-core/enrichment/enrich-decision-maker');
const { withVerdicts, splitBuckets, renderDigest } = require('./build-digest');

const ACTIONABLE_LANES = new Set(['small-direct', 'mid-augmentation', 'website-pitch', 'review']);

// The Code Adversary's mandated mapping between resolve() and the canonical record.
function flattenResolver(record, r) {
  record.dmName = r && r.person ? r.person.name : null;
  record.dmTitle = r && r.person ? r.person.title : null;
  record.dmLinkedIn = r && r.person ? r.person.linkedinUrl : null;
  record.dmConfidence = r && typeof r.confidence === 'number' ? r.confidence : 0;
  record.dmSources = (r && r.sources) || [];
  record.segment = (r && r.segment) || null;
  return record;
}

function save(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
}
function laneCounts(records) {
  return records.reduce((a, r) => ((a[r.lane || 'null'] = (a[r.lane || 'null'] || 0) + 1), a), {});
}

async function run(opts = {}) {
  const {
    brands = ['kobestarr', 'stripped', 'dealflow'],
    maxEnrich = 500,          // high so realistic weekly volume never hits gate overflow (avoids F3)
    maxLeads = 0,             // 0 = no cap on resolve+enrich
    skipLinkedin = false,     // skip the 5min-async linkedinPeople lookup for speed (Companies House still resolves founders)
    runDir, log = console.log, stageFrom = 'sourced', drySourceFile = null,
  } = opts;
  // Resolver adapters: omit linkedinPeople when skipLinkedin (mid-augmentation leads then go to manualFind).
  const resolverAdapters = skipLinkedin
    ? { companiesHouse: adapters.companiesHouse, websiteTeam: adapters.websiteTeam }
    : adapters;
  const dir = runDir || path.join(__dirname, 'runs', new Date().toISOString().slice(0, 10));

  // ---- STAGE 1: source ----
  let records;
  if (stageFrom !== 'sourced' && fs.existsSync(path.join(dir, '01-sourced.json'))) {
    records = JSON.parse(fs.readFileSync(path.join(dir, '01-sourced.json'), 'utf8'));
    log(`resumed ${records.length} sourced records`);
  } else if (drySourceFile) {
    records = JSON.parse(fs.readFileSync(drySourceFile, 'utf8'));
    log(`loaded ${records.length} records from ${drySourceFile} (dry source)`);
  } else {
    log('STAGE 1 source: firing searchJobs per brand/term (async ~5min each)...');
    const io = { runSearch: (term, filter) => source.searchJobs(term, filter) };
    records = await source.sourceAll({ ...io, brands });
    save(dir, '01-sourced.json', records);
    log(`sourced ${records.length} unique signals`);
  }

  // ---- STAGE 2: gate ----
  if (!records.every(r => r.lane) || stageFrom === 'sourced') {
    log('STAGE 2 gate: hard rules + unique-company enrichment...');
    const gateIo = { resolveDomain: resolveDomainReal, companyProfile: companyProfileReal };
    records = await gate(records, gateIo, { maxEnrich });
    save(dir, '02-gated.json', records);
    log(`gated. lanes: ${JSON.stringify(laneCounts(records))}`);
  }

  // ---- STAGE 3: resolve + enrich (actionable lanes only) ----
  let actionable = records.filter(r => ACTIONABLE_LANES.has(r.lane));
  if (maxLeads > 0) actionable = actionable.slice(0, maxLeads);
  log(`STAGE 3 resolve+enrich: ${actionable.length} actionable records...`);
  let done = 0, resolved = 0, emailed = 0, failed = 0;
  for (const record of actionable) {
    try {
      const r = await resolve({ ...record, companyHeadcount: record.estimatedHeadcount }, resolverAdapters);
      flattenResolver(record, r);
      if (record.dmName) resolved++;
      Object.assign(record, await enrichDecisionMaker(record, { websiteEmailLookup: adapters.websiteEmailLookup })); // enrich returns a COPY; merge it back
      if (record.email) emailed++;
    } catch (e) {
      failed++; record.pipelineError = String(e.message || e).slice(0, 200);
    }
    if (++done % 10 === 0) { log(`  ...${done}/${actionable.length} (dm ${resolved}, email ${emailed}, fail ${failed})`); save(dir, '03-enriched.partial.json', records); }
  }
  save(dir, '03-enriched.json', records);
  log(`enriched. decision-makers ${resolved}, safe emails ${emailed}, failures ${failed}`);

  // ---- STAGE 4: digest ----
  const withV = withVerdicts(records);
  const buckets = splitBuckets(withV);
  const digest = renderDigest(withV);
  save(dir, '04-final.json', withV);
  fs.writeFileSync(path.join(dir, 'digest.md'), digest);
  save(dir, 'buckets.json', {
    emailLead: buckets.emailLead.length, prospConnect: buckets.prospConnect.length,
    manualFind: buckets.manualFind.length, websitePitch: buckets.websitePitch.length,
    dropped: buckets.dropped.length,
  });
  log(`STAGE 4 digest -> ${path.join(dir, 'digest.md')}`);
  log(`buckets: emailLead ${buckets.emailLead.length}, prospConnect ${buckets.prospConnect.length}, ` +
      `manualFind ${buckets.manualFind.length}, websitePitch ${buckets.websitePitch.length}, dropped ${buckets.dropped.length}`);
  return { dir, records: withV, buckets, digest };
}

module.exports = { run, flattenResolver, ACTIONABLE_LANES };

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  const val = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
  const brands = val('brands') ? val('brands').split(',') : undefined;
  const maxEnrich = val('max-enrich') ? parseInt(val('max-enrich'), 10) : undefined;
  const maxLeads = val('max-leads') ? parseInt(val('max-leads'), 10) : undefined;
  const opts = { stageFrom: val('stage-from') || 'sourced', drySourceFile: val('dry-source') };
  if (brands) opts.brands = brands;
  if (maxEnrich) opts.maxEnrich = maxEnrich;
  if (maxLeads) opts.maxLeads = maxLeads;
  if (args.includes('--skip-linkedin')) opts.skipLinkedin = true;
  run(opts).then(r => console.log('DONE', r.dir)).catch(e => { console.error('FATAL', e); process.exit(1); });
}
