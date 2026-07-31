// tests/reaction-icp-gate.test.js
// Gate for the daily LinkedIn reactions batch. Stage 1 (2026-07-22, Kobi):
// company pages HARD-BLOCK; every other signal is shadow-scored only, so the
// dials get tuned on real data while the ramp climbs 10/day toward 400+.
const assert = require('assert');
const G = require('../reaction-icp-gate.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

(async () => {
  // ============ isCompanyAuthor: the one BLOCKING rule ============

  await test('company page blocked by author.type', () => {
    assert.strictEqual(G.isCompanyAuthor({ type: 'COMPANY', name: 'High Pay Centre' }), true);
  });

  await test('company page blocked by /company/ URL even when type is missing', () => {
    assert.strictEqual(G.isCompanyAuthor({ url: 'https://www.linkedin.com/company/high-pay-centre/' }), true);
  });

  await test('school and showcase pages blocked too', () => {
    assert.strictEqual(G.isCompanyAuthor({ url: 'https://www.linkedin.com/school/university-of-salford/' }), true);
    assert.strictEqual(G.isCompanyAuthor({ url: 'https://www.linkedin.com/showcase/acme-cloud/' }), true);
  });

  await test('real person survives', () => {
    assert.strictEqual(G.isCompanyAuthor({ type: 'PERSON', url: 'https://www.linkedin.com/in/armando-zuccali' }), false);
  });

  await test('person with a business-y name is NOT blocked (type wins over vibes)', () => {
    // "ST Real Estate" is a PERSON profile used as a business front. Still a
    // human who can accept a connection, so it must survive the block.
    assert.strictEqual(G.isCompanyAuthor({ type: 'PERSON', url: 'https://www.linkedin.com/in/st-real-estate-184140315' }), false);
  });

  await test('HOPPER LEFTOVER: company caught at fire time from linkedinUrl alone', () => {
    // The hopper is stocked a day ahead, so items resolved BEFORE the gate
    // existed still carry company pages. At fire time all we hold is
    // {postUrl, name, pool, linkedinUrl} — no author.type — so the URL check
    // has to stand on its own. Caught by the 2026-07-22 VPS dry run
    // ("The Property Experts" fired straight out of the pre-gate hopper).
    assert.strictEqual(G.isCompanyAuthor({ url: 'https://www.linkedin.com/company/the-property-experts/' }), true);
    assert.strictEqual(G.isCompanyAuthor({ url: 'https://www.linkedin.com/in/armando-zuccali' }), false);
    assert.strictEqual(G.isCompanyAuthor({ url: '' }), false);
  });

  await test('missing author does not throw', () => {
    assert.strictEqual(G.isCompanyAuthor(null), false);
    assert.strictEqual(G.isCompanyAuthor(undefined), false);
    assert.strictEqual(G.isCompanyAuthor({}), false);
  });

  // ============ icpVerdict: SHADOW scoring, never blocks yet ============

  await test('ideal lead passes: UK founder, healthy following', () => {
    const v = G.icpVerdict({ countryCode: 'gb', followers: 28329, headline: 'Founder & CEO at Gag London Equity Capital Ltd' });
    assert.strictEqual(v.pass, true);
    assert.deepStrictEqual(v.reasons, []);
  });

  await test('RECALL GUARD: profession noun counts as decision-maker (Ellis Bennett case)', () => {
    // His headline carries no C-suite word. A title-only regex rejected him,
    // and he is close to a perfect lead: "The accountant for scaling UK agencies".
    const v = G.icpVerdict({ countryCode: 'gb', followers: 21663, headline: 'The accountant for scaling UK agencies | FCCA | Profit margins' });
    assert.strictEqual(v.pass, true, 'expected pass, got reasons: ' + v.reasons.join(','));
  });

  await test('industry alone does NOT confer seniority (sector != decision-maker)', () => {
    // Working in "Marketing & Advertising" says nothing about whether this
    // person can sign a cheque. Sector is a separate dial, not a seniority proxy.
    const v = G.icpVerdict({ countryCode: 'gb', followers: 4885, headline: 'Building things', industry: 'Marketing & Advertising' });
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.includes('not-decision-maker'), v.reasons.join(','));
  });

  await test('industry still helps when it carries a role word (e.g. Accounting)', () => {
    const v = G.icpVerdict({ countryCode: 'gb', followers: 4885, headline: 'Helping agencies keep more profit', industry: 'Accounting' });
    assert.strictEqual(v.pass, true, v.reasons.join(','));
  });

  await test('non-UK rejected with the country in the reason', () => {
    const v = G.icpVerdict({ countryCode: 'in', followers: 931, headline: 'Freelance Video Editor & Motion Graphics Designer' });
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.includes('country=in'), v.reasons.join(','));
  });

  await test('unknown country rejected rather than assumed UK', () => {
    const v = G.icpVerdict({ followers: 5000, headline: 'Founder' });
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.includes('country=?'), v.reasons.join(','));
  });

  // ============ multi-country expansion (Kobi 2026-07-29) ============

  const MULTI = { countriesAllow: ['gb', 'no', 'au', 'nz', 'us', 'ca'], countriesEnglishOnly: ['se', 'fi', 'dk', 'pt'] };

  await test('full-accept countries pass regardless of post language (US, Canada, Norway, AU, NZ)', () => {
    for (const cc of ['us', 'ca', 'no', 'au', 'nz', 'gb']) {
      const v = G.icpVerdict({ countryCode: cc, followers: 5000, headline: 'Founder & CEO' }, MULTI);
      assert.strictEqual(v.pass, true, `${cc} should pass: ${v.reasons.join(',')}`);
    }
  });

  await test('English-only country PASSES with an English headline (Swedish founder writing in English)', () => {
    const v = G.icpVerdict({ countryCode: 'se', followers: 5000, headline: 'Founder helping B2B brands with growth' }, MULTI);
    assert.strictEqual(v.pass, true, v.reasons.join(','));
  });

  await test('English-only country REJECTED when the headline is not English', () => {
    // "Grundare | marknadsföring och tillväxt" = Swedish; off-ICP for an English-only service.
    const v = G.icpVerdict({ countryCode: 'se', followers: 5000, headline: 'Grundare | marknadsföring och tillväxt', industry: 'Marketing & Advertising' }, MULTI);
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.some((r) => r.startsWith('country=se')), v.reasons.join(','));
  });

  await test('industry (always English from LinkedIn) does NOT smuggle a non-English profile through', () => {
    // Finnish headline, English industry taxonomy — must still reject.
    const v = G.icpVerdict({ countryCode: 'fi', followers: 9000, headline: 'Perustaja ja toimitusjohtaja', industry: 'Marketing & Advertising' }, MULTI);
    assert.strictEqual(v.pass, false, v.reasons.join(','));
  });

  await test('country outside both lists is still rejected (e.g. India)', () => {
    const v = G.icpVerdict({ countryCode: 'in', followers: 9000, headline: 'Founder and CEO' }, MULTI);
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.includes('country=in'), v.reasons.join(','));
  });

  await test('country reason still maps to the "country" dial for blocking', () => {
    assert.strictEqual(G.dialOf('country=se(non-en)'), 'country');
    assert.strictEqual(G.dialOf('country=in'), 'country');
  });

  await test('isLikelyEnglish: English yes, Nordic no', () => {
    assert.strictEqual(G.isLikelyEnglish('The founder helping agencies with growth'), true);
    assert.strictEqual(G.isLikelyEnglish('Grundare och marknadschef'), false);
    assert.strictEqual(G.isLikelyEnglish(''), false);
  });

  await test('legacy single-country config still works (country: "gb")', () => {
    const v = G.icpVerdict({ countryCode: 'us', followers: 5000, headline: 'Founder' }, { country: 'gb', countriesAllow: undefined, countriesEnglishOnly: [] });
    assert.strictEqual(v.pass, false, 'us should reject under legacy gb-only');
    assert.ok(v.reasons.includes('country=us'), v.reasons.join(','));
  });

  await test('ghost pages rejected on follower floor', () => {
    const v = G.icpVerdict({ countryCode: 'gb', followers: 2, headline: 'Director' });
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.some(r => r.startsWith('followers<')), v.reasons.join(','));
  });

  await test('service boundary: PR roles excluded (remote/digital only, not a PR person)', () => {
    const v = G.icpVerdict({ countryCode: 'gb', followers: 9000, headline: 'Public Relations Director at Brand Co' });
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.includes('excluded-role'), v.reasons.join(','));
  });

  await test('excluded-role beats decision-maker when both match', () => {
    const v = G.icpVerdict({ countryCode: 'gb', followers: 9000, headline: 'Freelance Video Editor | Director of my own thing' });
    assert.deepStrictEqual(v.reasons, ['excluded-role']);
  });

  await test('non-decision-maker rejected (the H&S manager case)', () => {
    const v = G.icpVerdict({ countryCode: 'gb', followers: 800, headline: 'Health And Safety Manager @ FI Facilities' });
    assert.strictEqual(v.pass, false);
    assert.ok(v.reasons.includes('excluded-role') || v.reasons.includes('not-decision-maker'), v.reasons.join(','));
  });

  await test('multiple failures are all reported, for tuning the dials', () => {
    const v = G.icpVerdict({ countryCode: 'pk', followers: 5, headline: 'Student' });
    assert.ok(v.reasons.length >= 2, 'expected several reasons, got: ' + v.reasons.join(','));
  });

  await test('minFollowers is configurable', () => {
    const strict = G.icpVerdict({ countryCode: 'gb', followers: 400, headline: 'Founder' }, { minFollowers: 1000 });
    assert.strictEqual(strict.pass, false);
    const loose = G.icpVerdict({ countryCode: 'gb', followers: 400, headline: 'Founder' }, { minFollowers: 100 });
    assert.strictEqual(loose.pass, true);
  });

  // ============ shadow mode contract: scoring must never block ============

  await test('shouldBlock only ever blocks on signals named in gateBlockOn', () => {
    const verdict = { pass: false, reasons: ['country=in', 'not-decision-maker'] };
    // Stage 1: nothing shadow-scored is blocking yet.
    assert.strictEqual(G.shouldBlock(verdict, { gateBlockOn: [] }), false);
    // Stage 2 (when Kobi flips it): country becomes blocking.
    assert.strictEqual(G.shouldBlock(verdict, { gateBlockOn: ['country'] }), true);
    // A signal that did not fire must not block.
    assert.strictEqual(G.shouldBlock(verdict, { gateBlockOn: ['followers'] }), false);
  });

  await test('shouldBlock defaults to shadow mode when config is absent', () => {
    assert.strictEqual(G.shouldBlock({ pass: false, reasons: ['country=in'] }, {}), false);
    assert.strictEqual(G.shouldBlock({ pass: false, reasons: ['country=in'] }), false);
  });

  await test('a passing verdict never blocks', () => {
    assert.strictEqual(G.shouldBlock({ pass: true, reasons: [] }, { gateBlockOn: ['country', 'followers'] }), false);
  });

  console.log(`\n${passed} passed`);
})();
