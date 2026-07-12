#!/usr/bin/env node
// One-off: re-profile the resolved records with the now-working crawl4ai+LLM profiler, recompute
// lanes, keep dm/email, rebuild the digest action-first. Skips re-source/re-resolve (reuses 04-final).
const fs = require('fs'), path = require('path');
const { companyProfileReal, laneFromEnrichment, estimatedHeadcountFor } = require('../shared/outreach-core/enrichment/company-quality-gate');
const { enrichDecisionMaker } = require('../shared/outreach-core/enrichment/enrich-decision-maker');
const { withVerdicts, splitBuckets, renderDigest } = require('./build-digest');
const { normName } = require('../shared/outreach-core/enrichment/decision-maker-resolver');
const { websiteEmailLookup } = require('../shared/outreach-core/enrichment/resolver-adapters');

const dir = process.argv[2] || 'hiring-signals/runs/2026-07-11';
const records = JSON.parse(fs.readFileSync(path.join(dir, '04-final.json'), 'utf8'));

(async () => {
  const profileCache = new Map();
  const nonDrop = records.filter(r => r.lane !== 'drop' && r.companyDomain);
  const uniqueDomains = [...new Set(nonDrop.map(r => r.companyDomain))];
  console.log(`re-profiling ${uniqueDomains.length} unique domains via crawl4ai...`);
  let i = 0;
  for (const domain of uniqueDomains) {
    try { profileCache.set(domain, await companyProfileReal(domain)); } catch { profileCache.set(domain, null); }
    if (++i % 10 === 0) console.log(`  ...${i}/${uniqueDomains.length}`);
  }
  // apply profiles + recompute lane (never override a hard-rule drop)
  let relaned = 0, emailed = 0;
  for (const r of records) {
    if (r.lane === 'drop' || !r.companyDomain) continue;
    const p = profileCache.get(r.companyDomain);
    if (!p) continue;
    r.companyOneLiner = p.oneLiner || r.companyOneLiner;
    r.sizeBand = p.sizeBand || r.sizeBand;
    r.businessType = p.businessType || r.businessType;
    r.estimatedHeadcount = estimatedHeadcountFor(r.sizeBand);
    const newLane = laneFromEnrichment({ businessType: r.businessType, sizeBand: r.sizeBand, roleTitle: r.roleTitle });
    if (newLane && newLane !== r.lane) { r.lane = newLane; relaned++; }
    if (r.businessType === 'agency') r.dropReason = 'agency-competitor';
    r.gateConfidence = 0.7;
  }
  // re-enrich (website emails now work too via crawl4ai in websiteTeam's LLM path)
  const actionable = records.filter(r => ['small-direct', 'mid-augmentation', 'website-pitch', 'review'].includes(r.lane) && r.dmName && r.companyDomain);
  console.log(`re-enriching ${actionable.length} with dm+domain...`);
  for (const r of actionable) { Object.assign(r, await enrichDecisionMaker(r, { websiteEmailLookup })); if (r.email) emailed++; }

  const wv = withVerdicts(records);
  const b = splitBuckets(wv);
  fs.writeFileSync(path.join(dir, '04-final.json'), JSON.stringify(wv, null, 2));
  fs.writeFileSync(path.join(dir, 'digest.md'), renderDigest(wv));
  console.log(`DONE: relaned ${relaned}, safe emails ${emailed}`);
  console.log(`lanes: ${JSON.stringify(wv.filter(r => r.lane !== 'drop').reduce((a, r) => ((a[r.lane] = (a[r.lane] || 0) + 1), a), {}))}`);
  console.log(`buckets: emailLead ${b.emailLead.length}, prospConnect ${b.prospConnect.length}, manualFind ${b.manualFind.length}, websitePitch ${b.websitePitch.length}, dropped ${b.dropped.length}`);
})();
