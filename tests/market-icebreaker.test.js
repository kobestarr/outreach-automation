const test = require('node:test'); const assert = require('node:assert');
const M = require('../shared/outreach-core/enrichment/market-lib');
const I = require('../shared/outreach-core/enrichment/icebreaker-lib');

const mem = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => m.set(k, v), m }; };

test('grouping merges near duplicates down to target', async () => {
  const cos = Array.from({ length: 6 }, (_, i) => ({ email: `e${i}@x.com`, company: 'C' + i, industry: '', description: '' }));
  let n = 0;
  const llm = async (p) => {
    if (p.startsWith('These are market labels')) return JSON.stringify({ 'AI compliance tools for banks': 'AI compliance software for banks', 'AI compliance software for banks': 'AI compliance software for banks', 'Bank compliance AI': 'AI compliance software for banks', 'Pet food': 'Pet food', 'Dog food': 'Pet food' });
    const labs = ['AI compliance tools for banks', 'AI compliance software for banks', 'Bank compliance AI', 'Pet food', 'Dog food', 'ai compliance software for banks'];
    return JSON.stringify(labs.map((m, i) => ({ i, market: m })));
  };
  const out = await M.groupMarkets(cos, llm, { targetMax: 2 });
  assert.deepStrictEqual([...new Set(out.values())].sort(), ['AI compliance software for banks', 'Pet food']);
});

test('cost cap stops further calls and cache is reused', async () => {
  const cache = mem(); let calls = 0;
  const ask = async () => { calls++; return { text: '1. **Acme**', urls: [], cost: 1 }; };
  const r = await M.runMarketChecks(['a', 'b', 'c'], ask, cache, { capUsd: 3, perCallEstimate: 1 });
  assert.strictEqual(calls, 3); assert.ok(r.stopped); assert.ok(r.spent <= 3);
  const before = calls;
  const r2 = await M.runMarketChecks(['a', 'b'], ask, cache, { capUsd: 3, perCallEstimate: 1 });
  assert.strictEqual(calls, before + 1); // a fully cached; only b's second phrasing is new
  assert.ok(r2.spent <= 3);
});

test('cache reuse costs nothing', async () => {
  const cache = mem(); let calls = 0;
  const ask = async () => { calls++; return { text: 'x', urls: [], cost: 0.01 }; };
  await M.runMarketChecks(['a'], ask, cache, { capUsd: 5 });
  const c1 = calls; const r = await M.runMarketChecks(['a'], ask, cache, { capUsd: 5 });
  assert.strictEqual(calls, c1); assert.strictEqual(r.spent, 0);
});

test('matchCompany finds position and competitors', () => {
  const answers = [{ text: '1. **Acme Ltd** good\n2. **Honeycake** ok\n3. **Beta**\n4. **Gamma**\n5. **Delta**\n6. **Eps**', urls: [] }];
  const r = M.matchCompany({ company: 'Honeycake', website: 'https://honeycakeapp.com/' }, answers);
  assert.strictEqual(r.appears, true); assert.strictEqual(r.position, 2); assert.strictEqual(r.named_instead.length, 4);
  const n = M.matchCompany({ company: 'Zed', website: 'https://zed.io' }, answers);
  assert.strictEqual(n.appears, false);
});

const SITE = 'Acme builds compliance software for community banks and credit unions across the UK. '.repeat(5);
const base = { phrase: 'community banks', clause: 'your focus on community banks', siteText: SITE };

test('icebreaker rejects dashes, missing observation, banned rounds, long lines', () => {
    assert.strictEqual(I.validateIcebreaker('Nice work on community-banks.', { ...base, mode: 'none', round: 'Seed' }).reason, 'dash');
  assert.strictEqual(I.validateIcebreaker('Really like your focus on community banks — great.', { ...base, mode: 'none', round: 'Seed' }).reason, 'dash');
  assert.strictEqual(I.validateIcebreaker('Really like it.', { ...base, phrase: '', mode: 'none', round: 'Seed' }).reason, 'missing_observation');
  assert.strictEqual(I.validateIcebreaker('Really like your focus on gardening robots.', { ...base, phrase: 'gardening robots', clause: 'your focus on gardening robots', mode: 'none', round: 'Seed' }).reason, 'observation_not_in_site');
  assert.strictEqual(I.validateIcebreaker('Saw the Series A back in March, and your focus on community banks is a smart move.', { ...base, mode: 'old', round: 'Venture - Series Unknown' }).reason, 'banned_round');
  assert.strictEqual(I.validateIcebreaker('Really like your focus on community banks and the stock rally.', { ...base, mode: 'none', round: 'Post-IPO Equity' }).reason, 'stock_words');
  const long = 'Really like your focus on community banks ' + 'and so many other things that we could possibly mention here today friends okay ok and more words to push it far over the cap of twenty five.';
  assert.strictEqual(I.validateIcebreaker(long, { ...base, mode: 'none', round: 'Seed' }).reason, 'too_long');
  assert.ok(I.validateIcebreaker('Saw the Seed back in March, and your focus on community banks is a smart move.', { ...base, mode: 'old', round: 'Seed' }).ok);
});

test('funding modes: banned round words never named', () => {
  assert.strictEqual(I.fundingMode('Seed', '2026-09-10').mode, 'recent');
  assert.strictEqual(I.fundingMode('Seed', '2026-03-10').mode, 'old');
  assert.strictEqual(I.fundingMode('Debt Financing', '2026-09-10').mode, 'neutral');
  assert.strictEqual(I.fundingMode('Post-IPO Equity', '2026-03-10').mode, 'none');
  assert.strictEqual(I.fundingMode('Pre-Seed', '2026-03-10').rp, 'pre seed round');
});

test('held rows never get a generic line', async () => {
  const row = { company_name: 'Acme', round: 'Seed' };
  const parse = JSON.parse;
  const bad = await I.makeIcebreaker(row, '2026-03-10', SITE, async () => '{"phrase":"gardening robots","clause":"your focus on gardening robots"}', parse);
  assert.ok(bad.held && !bad.line);
  const empty = await I.makeIcebreaker(row, '2026-03-10', '', async () => { throw new Error('should not call'); }, parse);
  assert.strictEqual(empty.held, 'site_unreachable_or_empty');
  let calls = 0;
  const ok = await I.makeIcebreaker(row, '2026-03-10', SITE, async () => (++calls === 1 ? '{"phrase":"made up thing","clause":"your made up thing"}' : '{"phrase":"community banks","clause":"your focus on community banks"}'), parse);
  assert.strictEqual(calls, 2); assert.match(ok.line, /^Saw the seed round back in March, and your focus on community banks is a smart move\.$/);
});
