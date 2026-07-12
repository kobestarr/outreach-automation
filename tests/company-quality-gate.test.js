// tests/company-quality-gate.test.js
const assert = require('assert');
const G = require('../shared/outreach-core/enrichment/company-quality-gate.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

(async () => {
  // ===================== Stage A: hardRuleDrop (pure, no I/O) =====================

  await test('false-drop guard: "Van Hire Ltd" survives (bare "hire" is not a recruiter signal)', () => {
    const r = G.hardRuleDrop({ companyName: 'Van Hire Ltd', roleTitle: 'Driver' });
    assert.strictEqual(r.lane, null);
    assert.strictEqual(r.dropReason, null);
  });

  await test('false-drop guard: "Marketing & Communications Manager" survives (not a PR role)', () => {
    const r = G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'Marketing & Communications Manager' });
    assert.strictEqual(r.lane, null);
  });

  await test('recruiter WITH corroboration drops: "Reed Recruitment"', () => {
    const r = G.hardRuleDrop({ companyName: 'Reed Recruitment', roleTitle: 'Consultant' });
    assert.strictEqual(r.lane, 'drop');
    assert.strictEqual(r.dropReason, 'recruiter');
  });

  await test('recruiter WITH corroboration drops: named agency "Hays plc" and "Talent Solutions"', () => {
    assert.strictEqual(G.hardRuleDrop({ companyName: 'Hays plc', roleTitle: 'x' }).lane, 'drop');
    assert.strictEqual(G.hardRuleDrop({ companyName: 'XYZ Talent Solutions', roleTitle: 'x' }).lane, 'drop');
  });

  await test('bare "talent"/"resourc" without corroboration => review, NOT drop', () => {
    const a = G.hardRuleDrop({ companyName: 'Talent Ltd', roleTitle: 'x' });
    const b = G.hardRuleDrop({ companyName: 'Resourcing Solutions Ltd', roleTitle: 'x' });
    assert.strictEqual(a.lane, 'review');
    assert.strictEqual(b.lane, 'review');
  });

  await test('"Role at RealCo @ Recruiter" title pattern => review, NOT drop', () => {
    const r = G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'SEO Manager @ Reed' });
    assert.strictEqual(r.lane, 'review');
    assert.strictEqual(r.dropReason, null);
  });

  await test('gig-platform drops', () => {
    const r = G.hardRuleDrop({ companyName: 'Scale AI', roleTitle: 'AI Trainer' });
    assert.strictEqual(r.lane, 'drop');
    assert.strictEqual(r.dropReason, 'gig-platform');
  });

  await test('agency-competitor drops on named agency', () => {
    const r = G.hardRuleDrop({ companyName: 'VaynerMedia', roleTitle: 'Content Manager' });
    assert.strictEqual(r.lane, 'drop');
    assert.strictEqual(r.dropReason, 'agency-competitor');
  });

  await test('agency-competitor drops on generic "agency" + marketing/content role', () => {
    const r = G.hardRuleDrop({ companyName: 'Bright Spark Agency', roleTitle: 'Content Manager' });
    assert.strictEqual(r.lane, 'drop');
    assert.strictEqual(r.dropReason, 'agency-competitor');
    // a non-marketing role at a generic "agency" name should NOT trigger this rule
    const ok = G.hardRuleDrop({ companyName: 'Bright Spark Agency', roleTitle: 'Warehouse Operative' });
    assert.notStrictEqual(ok.dropReason, 'agency-competitor');
  });

  await test('pr-role drops ("PR Manager", "Press Officer") but keeps marketing & comms', () => {
    assert.strictEqual(G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'PR Manager' }).lane, 'drop');
    assert.strictEqual(G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'Press Officer' }).lane, 'drop');
    assert.strictEqual(G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'Marketing & Communications Manager' }).lane, null);
  });

  await test('in-person-role drops ("Event Coordinator", "Barista")', () => {
    assert.strictEqual(G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'Event Coordinator' }).lane, 'drop');
    assert.strictEqual(G.hardRuleDrop({ companyName: 'Acme Ltd', roleTitle: 'Barista' }).lane, 'drop');
  });

  await test('known giant drops on name alone, no I/O needed', () => {
    const r = G.hardRuleDrop({ companyName: 'Google UK Ltd', roleTitle: 'Marketing Manager' });
    assert.strictEqual(r.lane, 'drop');
    assert.strictEqual(r.dropReason, 'giant');
  });

  await test('hardRuleDrop is pure: identical input twice gives identical output, no side effects', () => {
    const input = { companyName: 'Acme Ltd', roleTitle: 'SEO Manager' };
    const a = G.hardRuleDrop(input);
    const b = G.hardRuleDrop(input);
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(input, { companyName: 'Acme Ltd', roleTitle: 'SEO Manager' }); // untouched
  });

  // ===================== Stage B pure helpers =====================

  await test('estimatedHeadcountFor maps sizeBand -> headcount', () => {
    assert.strictEqual(G.estimatedHeadcountFor('small'), 10);
    assert.strictEqual(G.estimatedHeadcountFor('mid'), 100);
    assert.strictEqual(G.estimatedHeadcountFor('large'), 600);
    assert.strictEqual(G.estimatedHeadcountFor('unknown'), null);
    assert.strictEqual(G.estimatedHeadcountFor(undefined), null);
  });

  await test('laneFromEnrichment: small business => small-direct', () => {
    assert.strictEqual(G.laneFromEnrichment({ businessType: 'business', sizeBand: 'small' }), 'small-direct');
  });

  await test('laneFromEnrichment: mid or large business => mid-augmentation', () => {
    assert.strictEqual(G.laneFromEnrichment({ businessType: 'business', sizeBand: 'mid' }), 'mid-augmentation');
    assert.strictEqual(G.laneFromEnrichment({ businessType: 'business', sizeBand: 'large' }), 'mid-augmentation');
  });

  await test('laneFromEnrichment: consumer brand at large scale => drop (giant)', () => {
    assert.strictEqual(G.laneFromEnrichment({ businessType: 'brand', sizeBand: 'large' }), 'drop');
  });

  await test('laneFromEnrichment: agency => drop (competitor, any size)', () => {
    assert.strictEqual(G.laneFromEnrichment({ businessType: 'agency', sizeBand: 'small' }), 'drop');
    assert.strictEqual(G.laneFromEnrichment({ businessType: 'agency', sizeBand: 'mid' }), 'drop');
  });

  await test('laneFromEnrichment: consumer brand + in-person-ish role => review (kept as brand)', () => {
    const lane = G.laneFromEnrichment({ businessType: 'brand', sizeBand: 'mid', roleTitle: 'Retail Ambassador' });
    assert.strictEqual(lane, 'review');
  });

  // ===================== gate(): full orchestration with fake io =====================

  await test('gate(): no domain found => lane website-pitch, not a drop', async () => {
    const io = { resolveDomain: async () => null };
    const r = await G.gate({ jobId: '1', companyName: 'Unknown Co', roleTitle: 'Growth Manager', location: 'London' }, io);
    assert.strictEqual(r.lane, 'website-pitch');
    assert.strictEqual(r.companyDomain, null);
    assert.strictEqual(r.isRealEmployer, true);
  });

  await test('gate(): domain + small business profile => small-direct, headcount+confidence set', async () => {
    const io = {
      resolveDomain: async () => 'acme.com',
      companyProfile: async () => ({ oneLiner: 'Local bakery chain', sizeBand: 'small', businessType: 'business' }),
    };
    const r = await G.gate({ jobId: '2', companyName: 'Acme Bakery', roleTitle: 'Marketing Manager' }, io);
    assert.strictEqual(r.lane, 'small-direct');
    assert.strictEqual(r.companyDomain, 'acme.com');
    assert.strictEqual(r.companyOneLiner, 'Local bakery chain');
    assert.strictEqual(r.estimatedHeadcount, 10);
    assert.strictEqual(r.gateConfidence, 0.7);
  });

  await test('gate(): companyProfile fetch fails (null) => lane review, keeps the domain it found', async () => {
    const io = { resolveDomain: async () => 'acme.com', companyProfile: async () => null };
    const r = await G.gate({ jobId: '3', companyName: 'Acme Ltd', roleTitle: 'SEO Manager' }, io);
    assert.strictEqual(r.lane, 'review');
    assert.strictEqual(r.companyDomain, 'acme.com');
    assert.strictEqual(r.gateConfidence, 0.4);
  });

  await test('gate(): unique-company collapse — same company enriched ONCE across multiple records', async () => {
    let calls = 0;
    const io = {
      resolveDomain: async () => { calls++; return 'acme.com'; },
      companyProfile: async () => ({ oneLiner: 'x', sizeBand: 'mid', businessType: 'business' }),
    };
    const records = [
      { jobId: 'a', companyName: 'Acme Ltd', roleTitle: 'SEO Manager' },
      { jobId: 'b', companyName: 'ACME LTD', roleTitle: 'Content Manager' }, // same company, different casing
    ];
    const out = await G.gate(records, io);
    assert.strictEqual(calls, 1, `resolveDomain should be called once, was called ${calls} times`);
    assert.strictEqual(out[0].lane, 'mid-augmentation');
    assert.strictEqual(out[1].lane, 'mid-augmentation');
    assert.strictEqual(out[0].companyDomain, 'acme.com');
    assert.strictEqual(out[1].companyDomain, 'acme.com');
  });

  await test('gate(): records are labelled, never deleted — array length + order preserved', async () => {
    const io = { resolveDomain: async () => null };
    const records = [
      { jobId: '1', companyName: 'Reed Recruitment', roleTitle: 'Consultant' }, // will drop
      { jobId: '2', companyName: 'Good Co', roleTitle: 'SEO Manager' },        // will website-pitch
    ];
    const out = await G.gate(records, io);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].jobId, '1');
    assert.strictEqual(out[0].lane, 'drop');
    assert.strictEqual(out[1].jobId, '2');
    assert.strictEqual(out[1].lane, 'website-pitch');
  });

  await test('gate(): hard cap on enrich per run — overflow left unprocessed (lane null) for next run', async () => {
    const io = {
      resolveDomain: async () => 'x.com',
      companyProfile: async () => ({ oneLiner: 'y', sizeBand: 'small', businessType: 'business' }),
    };
    const records = [
      { jobId: '1', companyName: 'Company A Ltd', roleTitle: 'SEO Manager' },
      { jobId: '2', companyName: 'Company B Ltd', roleTitle: 'SEO Manager' },
    ];
    const out = await G.gate(records, io, { maxEnrich: 1 });
    assert.notStrictEqual(out[0].lane, null); // processed
    assert.strictEqual(out[1].lane, null);    // overflow, untouched — picked up by next run
    assert.strictEqual(out[1].companyDomain, null);
  });

  await test('gate(): accepts a single record (non-array) and returns a single object back', async () => {
    const r = await G.gate({ jobId: '1', companyName: 'Reed Recruitment', roleTitle: 'x' }, {});
    assert.ok(!Array.isArray(r));
    assert.strictEqual(r.lane, 'drop');
  });

  await test('gate(): stage-A drop sets isRealEmployer=false; stage-B giant-drop also sets isRealEmployer=false', async () => {
    const dropped = await G.gate({ jobId: '1', companyName: 'Reed Recruitment', roleTitle: 'x' }, {});
    assert.strictEqual(dropped.isRealEmployer, false);

    const io = {
      resolveDomain: async () => 'famousbrand.com',
      companyProfile: async () => ({ oneLiner: 'A famous consumer brand', sizeBand: 'large', businessType: 'brand' }),
    };
    const giant = await G.gate({ jobId: '2', companyName: 'Some Big Consumer Brand', roleTitle: 'Marketing Manager' }, io);
    assert.strictEqual(giant.lane, 'drop');
    assert.strictEqual(giant.dropReason, 'giant');
    assert.strictEqual(giant.isRealEmployer, false);
  });

  await test('gate(): review lane (stage A) does NOT get enriched by stage B (stays review, no domain lookup)', async () => {
    let calls = 0;
    const io = { resolveDomain: async () => { calls++; return 'x.com'; } };
    const r = await G.gate({ jobId: '1', companyName: 'Talent Ltd', roleTitle: 'x' }, io);
    assert.strictEqual(r.lane, 'review');
    assert.strictEqual(calls, 0, 'stage B should never run for a stage-A review-lane record');
  });

  await test('gate(): original input objects are not mutated (new objects returned)', async () => {
    const original = { jobId: '1', companyName: 'Reed Recruitment', roleTitle: 'x' };
    const snapshot = { ...original };
    await G.gate(original, {});
    assert.deepStrictEqual(original, snapshot);
  });

  console.log(`\n${passed} passed`);
})();
