// tests/resolver-adapters.test.js — hermetic (global.fetch mocked, no live Companies House /
// linkedapi.io calls). Exercises the REAL io adapters decision-maker-resolver.resolve(signal, io)
// is designed to be called with: companiesHouse, linkedinPeople, websiteTeam, jdReportingLine.
const assert = require('assert');
const A = require('../shared/outreach-core/enrichment/resolver-adapters.js');
const ownerExtractor = require('../shared/outreach-core/enrichment/llm-owner-extractor.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const realFetch = global.fetch;
function restoreFetch() { global.fetch = realFetch; }

function jsonRes(body, ok = true) {
  return { ok, json: async () => body };
}

(async () => {
  // ================= companiesHouse =================

  await test('companiesHouse: strong name match + active directors -> returns Director candidates', async () => {
    global.fetch = async (url) => {
      if (String(url).includes('/search/companies')) {
        return jsonRes({ items: [{ title: 'Acme Widgets Ltd', company_number: '01234567', company_status: 'active' }] });
      }
      if (String(url).includes('/officers')) {
        return jsonRes({
          items: [
            { name: 'BOYLE, Michael John', officer_role: 'director', resigned_on: undefined },
            { name: 'SMITH, Old Exec', officer_role: 'director', resigned_on: '2020-01-01' },
          ],
        });
      }
      throw new Error('unexpected url ' + url);
    };
    try {
      const out = await A.companiesHouse('Acme Widgets Ltd', 'acmewidgets.co.uk');
      assert.strictEqual(out.length, 1); // resigned officer dropped
      assert.strictEqual(out[0].name, 'BOYLE, Michael John');
      assert.strictEqual(out[0].title, 'Director');
      assert.strictEqual(out[0].source, 'companiesHouse');
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: fuzzy search match too weak -> drop it (the "Monzo -> dissolved shell" case)', async () => {
    global.fetch = async (url) => {
      if (String(url).includes('/search/companies')) {
        // "Monzo" search returns a totally unrelated company as the fuzzy top hit
        return jsonRes({ items: [{ title: 'Bramand Consulting Limited', company_number: '99999999', company_status: 'active' }] });
      }
      throw new Error('should not fetch officers for a dropped match');
    };
    try {
      const out = await A.companiesHouse('Monzo', 'monzo.com');
      assert.deepStrictEqual(out, []);
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: dissolved company skipped even with a decent name match', async () => {
    global.fetch = async (url) => {
      if (String(url).includes('/search/companies')) {
        return jsonRes({
          items: [
            { title: 'Acme Widgets Ltd', company_number: '00000001', company_status: 'dissolved' },
          ],
        });
      }
      throw new Error('should not fetch officers for a dissolved-only result set');
    };
    try {
      const out = await A.companiesHouse('Acme Widgets Ltd', 'acmewidgets.co.uk');
      assert.deepStrictEqual(out, []);
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: picks the best-scoring ACTIVE match over a higher-listed dissolved one', async () => {
    global.fetch = async (url) => {
      if (String(url).includes('/search/companies')) {
        return jsonRes({
          items: [
            { title: 'Acme Widgets Ltd', company_number: '11111111', company_status: 'dissolved' },
            { title: 'Acme Widgets Limited', company_number: '22222222', company_status: 'active' },
          ],
        });
      }
      if (String(url).includes('/company/22222222/officers')) {
        return jsonRes({ items: [{ name: 'Jane Owner', officer_role: 'director' }] });
      }
      throw new Error('unexpected url ' + url);
    };
    try {
      const out = await A.companiesHouse('Acme Widgets Ltd', 'acmewidgets.co.uk');
      assert.strictEqual(out.length, 1);
      assert.strictEqual(out[0].name, 'Jane Owner');
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: no search results -> []', async () => {
    global.fetch = async () => jsonRes({ items: [] });
    try {
      assert.deepStrictEqual(await A.companiesHouse('Nobody Ltd', null), []);
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: missing companyName -> [] without ever calling fetch', async () => {
    global.fetch = async () => { throw new Error('should never be called'); };
    try {
      assert.deepStrictEqual(await A.companiesHouse(null, null), []);
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: network error -> [] gracefully (never throws)', async () => {
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    try {
      const out = await A.companiesHouse('Acme Widgets Ltd', 'acmewidgets.co.uk');
      assert.deepStrictEqual(out, []);
    } finally { restoreFetch(); }
  });

  await test('companiesHouse: non-ok HTTP response -> [] gracefully', async () => {
    global.fetch = async () => jsonRes({ error: 'nope' }, false);
    try {
      assert.deepStrictEqual(await A.companiesHouse('Acme Widgets Ltd', 'acmewidgets.co.uk'), []);
    } finally { restoreFetch(); }
  });

  // ================= linkedinPeople =================

  await test('linkedinPeople: workflow completes with people -> mapped candidates', async () => {
    let calls = 0;
    global.fetch = async (url, opts) => {
      calls++;
      if (opts && opts.method === 'POST') {
        return jsonRes({ workflowId: 'wf-1' });
      }
      // poll
      return jsonRes({
        result: {
          workflowStatus: 'completed',
          people: [
            { name: 'Priya Shah', headline: 'Head of Marketing at Acme', profileUrl: 'https://www.linkedin.com/in/priyashah' },
          ],
        },
      });
    };
    try {
      const out = await A.linkedinPeople('Acme Widgets Ltd', ['Head of Marketing']);
      assert.strictEqual(out.length, 1);
      assert.strictEqual(out[0].name, 'Priya Shah');
      assert.strictEqual(out[0].linkedinUrl, 'https://www.linkedin.com/in/priyashah');
      assert.strictEqual(out[0].source, 'linkedinPeople');
      assert.ok(calls >= 2); // at least one POST + one poll GET
    } finally { restoreFetch(); }
  });

  await test('linkedinPeople: workflow reports failed -> [] gracefully', async () => {
    global.fetch = async (url, opts) => {
      if (opts && opts.method === 'POST') return jsonRes({ workflowId: 'wf-2' });
      return jsonRes({ result: { workflowStatus: 'failed' } });
    };
    try {
      assert.deepStrictEqual(await A.linkedinPeople('Acme Widgets Ltd', ['Head of Marketing']), []);
    } finally { restoreFetch(); }
  });

  await test('linkedinPeople: no workflowId returned -> [] gracefully', async () => {
    global.fetch = async () => jsonRes({});
    try {
      assert.deepStrictEqual(await A.linkedinPeople('Acme Widgets Ltd', ['Head of Marketing']), []);
    } finally { restoreFetch(); }
  });

  await test('linkedinPeople: fetch throws (e.g. seat/API error) -> [] gracefully, never throws', async () => {
    global.fetch = async () => { throw new Error('network down'); };
    try {
      const out = await A.linkedinPeople('Acme Widgets Ltd', ['Head of Marketing']);
      assert.deepStrictEqual(out, []);
    } finally { restoreFetch(); }
  });

  await test('linkedinPeople: missing companyName -> [] without calling fetch', async () => {
    global.fetch = async () => { throw new Error('should never be called'); };
    try {
      assert.deepStrictEqual(await A.linkedinPeople(null, ['Head of Marketing']), []);
    } finally { restoreFetch(); }
  });

  // ================= websiteTeam =================

  await test('websiteTeam: wraps extractOwnersFromWebsite owners into candidates', async () => {
    const original = ownerExtractor.extractOwnersFromWebsite;
    ownerExtractor.extractOwnersFromWebsite = async () => ({
      owners: [{ name: 'Jane Owner', title: 'Founder', email: 'jane@acmewidgets.co.uk' }],
      emails: [],
    });
    try {
      const out = await A.websiteTeam('acmewidgets.co.uk', ['Founder']);
      assert.strictEqual(out.length, 1);
      assert.strictEqual(out[0].name, 'Jane Owner');
      assert.strictEqual(out[0].title, 'Founder');
      assert.strictEqual(out[0].email, 'jane@acmewidgets.co.uk');
      assert.strictEqual(out[0].source, 'websiteTeam');
    } finally { ownerExtractor.extractOwnersFromWebsite = original; }
  });

  await test('websiteTeam: no companyDomain -> [] without calling extractOwnersFromWebsite', async () => {
    const original = ownerExtractor.extractOwnersFromWebsite;
    ownerExtractor.extractOwnersFromWebsite = async () => { throw new Error('should never be called'); };
    try {
      assert.deepStrictEqual(await A.websiteTeam(null, ['Founder']), []);
    } finally { ownerExtractor.extractOwnersFromWebsite = original; }
  });

  await test('websiteTeam: extractOwnersFromWebsite returns null (site unreachable) -> [] gracefully', async () => {
    const original = ownerExtractor.extractOwnersFromWebsite;
    ownerExtractor.extractOwnersFromWebsite = async () => null;
    try {
      assert.deepStrictEqual(await A.websiteTeam('deadsite.co.uk', ['Founder']), []);
    } finally { ownerExtractor.extractOwnersFromWebsite = original; }
  });

  await test('websiteTeam: extractOwnersFromWebsite throws -> [] gracefully, never throws', async () => {
    const original = ownerExtractor.extractOwnersFromWebsite;
    ownerExtractor.extractOwnersFromWebsite = async () => { throw new Error('LLM API error'); };
    try {
      assert.deepStrictEqual(await A.websiteTeam('acmewidgets.co.uk', ['Founder']), []);
    } finally { ownerExtractor.extractOwnersFromWebsite = original; }
  });

  // ================= jdReportingLine =================

  await test('jdReportingLine: v1 dormant route always returns []', async () => {
    assert.deepStrictEqual(await A.jdReportingLine('Some JD text'), []);
    assert.deepStrictEqual(await A.jdReportingLine(null), []);
  });

  console.log(`\n${passed} passed`);
})();
