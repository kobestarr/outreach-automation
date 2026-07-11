// tests/hiring-signal-source.test.js: hermetic (io.runSearch injected, no live linkedapi.io calls).
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../hiring-signals/hiring-signal-source.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

function tmpLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiring-signal-'));
  return path.join(dir, 'hiring-signals-seen.txt');
}

// io.runSearch keyed by term so each brand/term combination can return its own fixture.
function mkIo({ jobsByTerm = {}, ledgerFile = tmpLedger(), now = new Date('2026-07-11T00:00:00Z') } = {}) {
  const calls = [];
  return {
    ledgerFile,
    now: () => now,
    log: () => {},
    runSearch: async (term, filter) => { calls.push({ term, filter }); return jobsByTerm[term] || []; },
    calls,
  };
}

(async () => {
  // ---- title cleanup ----
  await test('cleanTitle takes the first line only', () => {
    assert.strictEqual(S.cleanTitle('SEO Manager\nVerified Hiring'), 'SEO Manager');
  });
  await test('cleanTitle strips trailing " with verification"', () => {
    assert.strictEqual(S.cleanTitle('Head of Marketing with verification'), 'Head of Marketing');
  });
  await test('cleanTitle handles both line-break AND trailing suffix together', () => {
    assert.strictEqual(S.cleanTitle('Growth Manager with verification\nBadge line'), 'Growth Manager');
  });
  await test('cleanTitle is safe on empty/null/non-string input', () => {
    assert.strictEqual(S.cleanTitle(null), '');
    assert.strictEqual(S.cleanTitle(''), '');
    assert.strictEqual(S.cleanTitle(undefined), '');
  });

  // ---- brand config coverage ----
  await test('BRAND_CONFIG has the three brands with the exact documented terms', () => {
    assert.deepStrictEqual(S.BRAND_CONFIG.kobestarr, ['SEO manager', 'digital marketing manager', 'growth manager', 'head of marketing']);
    assert.deepStrictEqual(S.BRAND_CONFIG.stripped, ['podcast producer', 'audio producer', 'content producer']);
    assert.deepStrictEqual(S.BRAND_CONFIG.dealflow, ['content marketing manager', 'content manager']);
  });
  await test('BASE_FILTER pins UK / pastWeek, no experienceLevels (invalid enum rejects workflow)', () => {
    assert.strictEqual(S.BASE_FILTER.location, 'United Kingdom');
    assert.strictEqual(S.BASE_FILTER.datePosted, 'pastWeek');
    assert.strictEqual(S.BASE_FILTER.experienceLevels, undefined);
  });

  // ---- record shape ----
  await test('toSignalRecord produces the full SignalRecord contract with correct source fields', () => {
    const raw = { jobId: 'J1', jobUrl: 'https://linkedin.com/jobs/J1', title: 'SEO Manager\nVerified', companyName: 'Acme Ltd', location: 'Manchester, UK', workplaceType: 'Hybrid', salary: '£40k', easyApply: true, isPromoted: false };
    const r = S.toSignalRecord(raw, 'kobestarr', 'SEO manager');
    assert.strictEqual(r.jobId, 'J1');
    assert.strictEqual(r.jobUrl, 'https://linkedin.com/jobs/J1');
    assert.strictEqual(r.brand, 'kobestarr');
    assert.strictEqual(r.term, 'SEO manager');
    assert.strictEqual(r.roleTitle, 'SEO Manager');
    assert.strictEqual(r.companyName, 'Acme Ltd');
    assert.strictEqual(r.location, 'Manchester, UK');
    assert.strictEqual(r.workplaceType, 'Hybrid');
    assert.strictEqual(r.salary, '£40k');
    assert.strictEqual(r.easyApply, true);
    assert.strictEqual(r.isPromoted, false);
    // v1-dormant / downstream fields present with documented defaults
    assert.strictEqual(r.jobDescription, null);
    assert.strictEqual(r.posterEmail, null);
    assert.strictEqual(r.posterName, null);
    assert.strictEqual(r.companyDomain, null);
    assert.strictEqual(r.businessType, 'unknown');
    assert.strictEqual(r.sizeBand, 'unknown');
    assert.strictEqual(r.lane, null);
    assert.strictEqual(r.dmConfidence, 0);
    assert.deepStrictEqual(r.dmSources, []);
    assert.strictEqual(r.linkedinResolved, false);
    assert.strictEqual(r.verdict, null);
  });
  await test('toSignalRecord tolerates missing/alias fields without throwing', () => {
    const r = S.toSignalRecord({ id: 'J2', company: 'Beta Co', jobTitle: 'Growth Manager' }, 'kobestarr', 'growth manager');
    assert.strictEqual(r.jobId, 'J2');
    assert.strictEqual(r.companyName, 'Beta Co');
    assert.strictEqual(r.roleTitle, 'Growth Manager');
    assert.strictEqual(r.salary, null);
  });

  // ---- jobId dedup within a run ----
  await test('sourceAll dedups exact jobId across terms within a single run', async () => {
    const io = mkIo({
      jobsByTerm: {
        'SEO manager': [{ jobId: 'DUP1', companyName: 'Acme Ltd', title: 'SEO Manager' }],
        'digital marketing manager': [{ jobId: 'DUP1', companyName: 'Acme Ltd', title: 'Digital Marketing Manager' }],
        'growth manager': [{ jobId: 'UNIQUE1', companyName: 'Gamma Ltd', title: 'Growth Manager' }],
      },
    });
    const records = await S.sourceAll(io);
    const jobIds = records.map(r => r.jobId);
    assert.strictEqual(jobIds.filter(id => id === 'DUP1').length, 1, 'DUP1 only appears once even though two terms returned it');
    assert.ok(jobIds.includes('UNIQUE1'));
  });
  await test('sourceAll drops jobless raw records (cannot dedup/ledger safely)', async () => {
    const io = mkIo({ jobsByTerm: { 'SEO manager': [{ companyName: 'NoId Ltd', title: 'SEO Manager' }] } });
    const records = await S.sourceAll(io);
    assert.strictEqual(records.length, 0);
  });

  // ---- company-level 21-day cooldown ----
  await test('isCompanyOnCooldown: true within 21 days, false just outside the window', () => {
    const now = new Date('2026-07-11T00:00:00Z');
    const recent = [{ company: 'acme', date: new Date('2026-07-01T00:00:00Z') }]; // 10 days ago
    const stale = [{ company: 'acme', date: new Date('2026-06-01T00:00:00Z') }]; // ~40 days ago
    assert.strictEqual(S.isCompanyOnCooldown('acme', recent, now), true);
    assert.strictEqual(S.isCompanyOnCooldown('acme', stale, now), false);
    assert.strictEqual(S.isCompanyOnCooldown('other-co', recent, now), false);
  });
  await test('sourceAll suppresses a company seen within 21 days even under a different jobId', async () => {
    const ledgerFile = tmpLedger();
    // Pre-seed: Acme Ltd was seen 5 days ago under a different job.
    S.appendSeenLedger(ledgerFile, [{ jobId: 'OLDJOB', company: 'acme', date: new Date('2026-07-06T00:00:00Z') }]);
    const io = mkIo({
      ledgerFile,
      jobsByTerm: { 'SEO manager': [{ jobId: 'NEWJOB', companyName: 'Acme Ltd', title: 'SEO Manager' }] },
    });
    const records = await S.sourceAll(io);
    assert.strictEqual(records.length, 0, 'Acme Ltd is on cooldown, new posting suppressed');
  });
  await test('sourceAll allows a company seen 22+ days ago (outside cooldown)', async () => {
    const ledgerFile = tmpLedger();
    S.appendSeenLedger(ledgerFile, [{ jobId: 'OLDJOB', company: 'acme', date: new Date('2026-06-01T00:00:00Z') }]);
    const io = mkIo({
      ledgerFile,
      jobsByTerm: { 'SEO manager': [{ jobId: 'NEWJOB', companyName: 'Acme Ltd', title: 'SEO Manager' }] },
    });
    const records = await S.sourceAll(io);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].jobId, 'NEWJOB');
  });
  await test('sourceAll appends newly-kept records to the ledger (future runs see them)', async () => {
    const ledgerFile = tmpLedger();
    const io = mkIo({ ledgerFile, jobsByTerm: { 'SEO manager': [{ jobId: 'J9', companyName: 'Delta Ltd', title: 'SEO Manager' }] } });
    await S.sourceAll(io);
    const entries = S.readSeenLedger(ledgerFile);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].jobId, 'J9');
    assert.strictEqual(entries[0].company, 'delta');
  });
  await test('readSeenLedger returns empty array for a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiring-signal-'));
    const missing = path.join(dir, 'nope.txt');
    assert.deepStrictEqual(S.readSeenLedger(missing), []);
  });

  // ---- sourceAll integration: fires every brand's terms ----
  await test('sourceAll fires a search for every configured brand/term combination', async () => {
    const io = mkIo({ jobsByTerm: {} });
    await S.sourceAll(io);
    const totalTerms = Object.values(S.BRAND_CONFIG).reduce((n, terms) => n + terms.length, 0);
    assert.strictEqual(io.calls.length, totalTerms);
  });
  await test('sourceAll passes BASE_FILTER through to runSearch for every call', async () => {
    const io = mkIo({ jobsByTerm: {} });
    await S.sourceAll(io);
    for (const call of io.calls) assert.deepStrictEqual(call.filter, S.BASE_FILTER);
  });
  await test('sourceAll continues past a failing searchJobs term without throwing', async () => {
    const io = mkIo({ jobsByTerm: {} });
    io.runSearch = async term => { if (term === 'SEO manager') throw new Error('boom'); return []; };
    await assert.doesNotReject(() => S.sourceAll(io));
  });

  console.log(`\n${passed} passed`);
})();
