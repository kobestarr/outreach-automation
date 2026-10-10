// tests/company-size-gate.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../shared/outreach-core/enrichment/company-size-gate');

// ---------- classifyProfile (pure) ----------

test('micro-entity accounts drop', () => {
  const r = G.classifyProfile({ company_status: 'active', accounts: { last_accounts: { type: 'micro-entity' } } });
  assert.strictEqual(r.size, 'micro');
  assert.strictEqual(r.drop, true);
  assert.strictEqual(r.reason, 'micro-entity');
});

test('dormant accounts drop', () => {
  const r = G.classifyProfile({ company_status: 'active', accounts: { last_accounts: { type: 'dormant' } } });
  assert.strictEqual(r.drop, true);
  assert.strictEqual(r.reason, 'dormant');
});

test('dissolved / liquidation companies drop', () => {
  for (const s of ['dissolved', 'liquidation', 'administration']) {
    const r = G.classifyProfile({ company_status: s, accounts: { last_accounts: { type: 'full' } } });
    assert.strictEqual(r.drop, true, s);
    assert.strictEqual(r.reason, 'status-' + s);
  }
});

test('full / medium / group accounts are larger and kept', () => {
  for (const t of ['full', 'medium', 'group', 'audited-abridged', 'audit-exemption-subsidiary']) {
    const r = G.classifyProfile({ company_status: 'active', accounts: { last_accounts: { type: t } } });
    assert.strictEqual(r.size, 'larger', t);
    assert.strictEqual(r.drop, false, t);
  }
});

test('small-company filings are kept', () => {
  for (const t of ['small', 'total-exemption-full', 'total-exemption-small', 'unaudited-abridged', 'partial-exemption']) {
    const r = G.classifyProfile({ company_status: 'active', accounts: { last_accounts: { type: t } } });
    assert.strictEqual(r.size, 'small', t);
    assert.strictEqual(r.drop, false, t);
  }
});

test('no accounts filed yet (new company) is kept, not guessed', () => {
  const r = G.classifyProfile({ company_status: 'active', accounts: { next_due: '2028-02-14' } });
  assert.strictEqual(r.size, 'no-accounts');
  assert.strictEqual(r.drop, false);
});

test('missing profile is unknown and kept', () => {
  const r = G.classifyProfile(null);
  assert.strictEqual(r.size, 'unknown');
  assert.strictEqual(r.drop, false);
});

// ---------- normaliseName / pickMatch (pure) ----------

test('normaliseName strips legal suffixes, "the", punctuation and case', () => {
  assert.strictEqual(G.normaliseName('The Acme Co. Ltd'), 'acme co');
  assert.strictEqual(G.normaliseName('ACME LIMITED'), 'acme');
  assert.strictEqual(G.normaliseName('Acme & Sons PLC'), 'acme and sons');
  assert.strictEqual(G.normaliseName('Smith-Jones LLP'), 'smith jones');
});

test('pickMatch takes the single active exact-name match', () => {
  const items = [
    { title: 'GOALHANGER COMMERCIAL LIMITED', company_number: '17219925', company_status: 'active' },
    { title: 'GOALHANGER FILMS LIMITED', company_number: '07000001', company_status: 'active' },
  ];
  const m = G.pickMatch(items, 'Goalhanger Films');
  assert.strictEqual(m.company_number, '07000001');
});

test('pickMatch refuses a near-miss (the Goalhanger trap): no match, not the first result', () => {
  const items = [{ title: 'GOALHANGER COMMERCIAL LIMITED', company_number: '17219925', company_status: 'active' }];
  assert.strictEqual(G.pickMatch(items, 'Goalhanger'), null);
});

test('pickMatch ignores dissolved namesakes and refuses when two active companies tie', () => {
  const dissolvedOnly = [{ title: 'ACME LTD', company_number: '1', company_status: 'dissolved' }, { title: 'ACME LIMITED', company_number: '2', company_status: 'active' }];
  assert.strictEqual(G.pickMatch(dissolvedOnly, 'Acme').company_number, '2');
  const tie = [{ title: 'ACME LTD', company_number: '1', company_status: 'active' }, { title: 'ACME LIMITED', company_number: '2', company_status: 'active' }];
  assert.strictEqual(G.pickMatch(tie, 'Acme'), null);
});

// ---------- checkCompany (I/O injected) ----------

function fakeFetch(map) {
  const calls = [];
  const fn = async (path) => { calls.push(path); if (!(path in map)) throw new Error('unexpected ' + path); return map[path]; };
  fn.calls = calls;
  return fn;
}

test('checkCompany with a company number skips search and classifies the profile', async () => {
  const fetchJson = fakeFetch({ '/company/01234567': { company_status: 'active', accounts: { last_accounts: { type: 'micro-entity' } } } });
  const r = await G.checkCompany({ name: 'Whatever', companyNumber: '1234567' }, { fetchJson });
  assert.strictEqual(r.drop, true);
  assert.strictEqual(r.companyNumber, '01234567');
  assert.deepStrictEqual(fetchJson.calls, ['/company/01234567']);
});

test('checkCompany by name: matched micro-entity drops', async () => {
  const fetchJson = fakeFetch({
    '/search/companies?q=Tiny%20Studio&items_per_page=20': { items: [{ title: 'TINY STUDIO LTD', company_number: '11111111', company_status: 'active' }] },
    '/company/11111111': { company_status: 'active', accounts: { last_accounts: { type: 'micro-entity' } } },
  });
  const r = await G.checkCompany({ name: 'Tiny Studio' }, { fetchJson });
  assert.strictEqual(r.drop, true);
  assert.strictEqual(r.reason, 'micro-entity');
  assert.strictEqual(r.matchedName, 'TINY STUDIO LTD');
});

test('checkCompany by name: no confident match keeps the lead as unmatched', async () => {
  const fetchJson = fakeFetch({ '/search/companies?q=Goalhanger&items_per_page=20': { items: [{ title: 'GOALHANGER COMMERCIAL LIMITED', company_number: '17219925', company_status: 'active' }] } });
  const r = await G.checkCompany({ name: 'Goalhanger' }, { fetchJson });
  assert.strictEqual(r.size, 'unmatched');
  assert.strictEqual(r.drop, false);
});

test('checkCompany never drops on an API error', async () => {
  const fetchJson = async () => { throw new Error('ECONNRESET'); };
  const r = await G.checkCompany({ name: 'Acme' }, { fetchJson });
  assert.strictEqual(r.size, 'error');
  assert.strictEqual(r.drop, false);
});

test('checkCompany uses and fills the cache', async () => {
  const cache = {};
  const fetchJson = fakeFetch({
    '/search/companies?q=Acme&items_per_page=20': { items: [{ title: 'ACME LTD', company_number: '22222222', company_status: 'active' }] },
    '/company/22222222': { company_status: 'active', accounts: { last_accounts: { type: 'full' } } },
  });
  await G.checkCompany({ name: 'Acme' }, { fetchJson, cache });
  const again = await G.checkCompany({ name: 'ACME' }, { fetchJson, cache });
  assert.strictEqual(again.size, 'larger');
  assert.strictEqual(fetchJson.calls.length, 2, 'second lookup served from cache');
});

test('checkCompany does not cache errors', async () => {
  const cache = {};
  await G.checkCompany({ name: 'Acme' }, { fetchJson: async () => { throw new Error('timeout'); }, cache });
  assert.deepStrictEqual(cache, {});
});

// ---------- gateLeads (batch helper) ----------

test('gateLeads checks UK rows only, drops micro, annotates the rest', async () => {
  const leads = [
    { name: 'Tiny UK Ltd', country: 'United Kingdom' },
    { name: 'Big UK Ltd', country: 'United Kingdom' },
    { name: 'US Co', country: 'United States' },
  ];
  const seen = [];
  const check = async ({ name }) => { seen.push(name); return name.startsWith('Tiny') ? { size: 'micro', drop: true, reason: 'micro-entity' } : { size: 'larger', drop: false }; };
  const { kept, dropped } = await G.gateLeads(leads, { check, pauseMs: 0 });
  assert.deepStrictEqual(seen, ['Tiny UK Ltd', 'Big UK Ltd']);
  assert.deepStrictEqual(kept.map(l => l.name), ['Big UK Ltd', 'US Co']);
  assert.deepStrictEqual(dropped.map(l => l.name), ['Tiny UK Ltd']);
  assert.strictEqual(kept[0].chSize, 'larger');
  assert.strictEqual(kept[1].chSize, 'not-uk');
  assert.strictEqual(dropped[0].chReason, 'micro-entity');
});

test('gateLeads accepts UK spellings (UK, GB, England, Scotland)', async () => {
  const leads = ['UK', 'GB', 'England', 'Scotland', 'united kingdom'].map(c => ({ name: 'X ' + c, country: c }));
  let n = 0;
  await G.gateLeads(leads, { check: async () => { n++; return { size: 'small', drop: false }; }, pauseMs: 0 });
  assert.strictEqual(n, 5);
});

test('gateLeads assumeUk checks rows that have no country column', async () => {
  let n = 0;
  const { kept } = await G.gateLeads([{ name: 'A' }, { name: 'B' }], { assumeUk: true, check: async () => { n++; return { size: 'small', drop: false }; }, pauseMs: 0 });
  assert.strictEqual(n, 2);
  assert.strictEqual(kept.length, 2);
});
