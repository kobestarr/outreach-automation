// tests/profile-views-targeting.test.js
// Views target a PERSON, not a post, so every constraint that shaped the likes
// engine disappears. Posts are used only as a RECENCY signal for ordering:
// 194,380 banked posts collapse to 5,071 authors of whom only 129 are not
// already in the cache, so post-first discovery buys nothing here.
//
// Deliberate departure from the PRD: we exclude only KNOWN gate fails and let
// UNKNOWNS through, because st.openPersonPage returns the full profile for free,
// so a view of an unknown is a free lookup that improves every later decision.
const assert = require('assert');
const T = require('../profile-views-targeting.js');
const GATE = require('../reaction-icp-gate.js');
const { DEFAULT_CONFIG } = require('../profile-views-config.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const NOW = Date.parse('2026-09-15T12:00:00Z');
const daysAgo = (n) => NOW - n * 864e5;

const PASS_PROFILE = { countryCode: 'GB', followers: 5000, headline: 'Founder at Acme', industry: '' };
const FAIL_PROFILE = { countryCode: 'IN', followers: 5000, headline: 'Founder at Acme', industry: '' };

const ctx = (over = {}) => ({
  cfg: { ...DEFAULT_CONFIG, gateBlockOn: ['country', 'followers', 'not-decision-maker', 'excluded-role'] },
  state: { viewed: {}, history: {} },
  firstDegree: new Set(),
  blocklist: new Set(),
  cache: {},
  gate: GATE,
  nowMs: NOW,
  ...over,
});

const cand = (over = {}) => ({
  username: 'someone',
  linkedinUrl: 'https://www.linkedin.com/in/someone',
  pool: 'views-cache',
  lastPostedAt: null,
  ...over,
});

(async () => {
  await test('1st-degree connections are excluded', () => {
    assert.strictEqual(T.scoreOf(cand(), ctx({ firstDegree: new Set(['someone']) })), null);
  });

  await test('blocklisted people are excluded', () => {
    assert.strictEqual(T.scoreOf(cand(), ctx({ blocklist: new Set(['someone']) })), null);
  });

  await test('company pages are excluded', () => {
    const company = cand({ username: 'acme', linkedinUrl: 'https://www.linkedin.com/company/acme/' });
    assert.strictEqual(T.scoreOf(company, ctx()), null);
  });

  await test('a KNOWN gate fail is excluded', () => {
    assert.strictEqual(T.scoreOf(cand(), ctx({ cache: { someone: { profile: FAIL_PROFILE } } })), null);
  });

  await test('an UNKNOWN profile is NOT excluded, because the view enriches for free', () => {
    assert.ok(T.scoreOf(cand(), ctx()) > 0);
  });

  await test('an unresolved cache entry counts as unknown, not as a fail', () => {
    assert.ok(T.scoreOf(cand(), ctx({ cache: { someone: { profile: { unresolved: true } } } })) > 0);
  });

  await test('someone viewed inside the cooldown is excluded', () => {
    const c = ctx({ state: { viewed: { someone: new Date(daysAgo(5)).toISOString() }, history: {} } });
    assert.strictEqual(T.scoreOf(cand(), c), null);
  });

  await test('someone viewed beyond the 30 day cooldown is eligible again', () => {
    const c = ctx({ state: { viewed: { someone: new Date(daysAgo(31)).toISOString() }, history: {} } });
    assert.ok(T.scoreOf(cand(), c) > 0);
  });

  await test('cached PASS + recently active outranks cached PASS + dormant', () => {
    const c = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    assert.ok(T.scoreOf(cand({ lastPostedAt: daysAgo(3) }), c) > T.scoreOf(cand({ lastPostedAt: daysAgo(200) }), c));
  });

  await test('unknown + active outranks cached PASS + dormant', () => {
    const known = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    assert.ok(T.scoreOf(cand({ lastPostedAt: daysAgo(2) }), ctx()) > T.scoreOf(cand({ lastPostedAt: daysAgo(300) }), known));
  });

  await test('cached PASS + dormant outranks unknown + dormant', () => {
    const known = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    assert.ok(T.scoreOf(cand({ lastPostedAt: daysAgo(300) }), known) > T.scoreOf(cand({ lastPostedAt: daysAgo(300) }), ctx()));
  });

  await test('a post older than activeWithinDays does not count as active', () => {
    const c = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    assert.ok(T.scoreOf(cand({ lastPostedAt: daysAgo(13) }), c) > T.scoreOf(cand({ lastPostedAt: daysAgo(15) }), c));
  });

  await test('never posted is scored, not excluded', () => {
    assert.ok(T.scoreOf(cand({ lastPostedAt: null }), ctx({ cache: { someone: { profile: PASS_PROFILE } } })) > 0);
  });

  await test('the recency bonus can never lift a candidate out of its band', () => {
    const known = ctx({ cache: { someone: { profile: PASS_PROFILE } } });
    const passDormantFresh = T.scoreOf(cand({ lastPostedAt: daysAgo(15) }), known);
    const unknownActiveOld = T.scoreOf(cand({ lastPostedAt: daysAgo(13) }), ctx());
    assert.ok(unknownActiveOld > passDormantFresh, 'unknown+active band must stay above pass+dormant band');
  });

  await test('buildQueue drops excluded candidates and sorts by score descending', () => {
    const c = ctx({
      firstDegree: new Set(['friend']),
      cache: { good: { profile: PASS_PROFILE }, bad: { profile: FAIL_PROFILE } },
    });
    const q = T.buildQueue([
      cand({ username: 'friend', linkedinUrl: 'https://www.linkedin.com/in/friend' }),
      cand({ username: 'bad', linkedinUrl: 'https://www.linkedin.com/in/bad' }),
      cand({ username: 'stranger', linkedinUrl: 'https://www.linkedin.com/in/stranger', lastPostedAt: daysAgo(1) }),
      cand({ username: 'good', linkedinUrl: 'https://www.linkedin.com/in/good', lastPostedAt: daysAgo(1) }),
    ], c);
    assert.deepStrictEqual(q.map((x) => x.username), ['good', 'stranger']);
    assert.ok(q[0].score >= q[1].score);
  });

  await test('buildQueue dedupes by username, keeping the higher-scoring entry', () => {
    const c = ctx({ cache: { dup: { profile: PASS_PROFILE } } });
    const q = T.buildQueue([
      cand({ username: 'dup', linkedinUrl: 'https://www.linkedin.com/in/dup', pool: 'views-ksd', lastPostedAt: null }),
      cand({ username: 'dup', linkedinUrl: 'https://www.linkedin.com/in/dup', pool: 'views-active', lastPostedAt: daysAgo(1) }),
    ], c);
    assert.strictEqual(q.length, 1);
    assert.strictEqual(q[0].pool, 'views-active');
  });

  await test('buildQueue annotates each survivor with its score', () => {
    assert.strictEqual(typeof T.buildQueue([cand()], ctx())[0].score, 'number');
  });

  await test('buildQueue preserves the pool label for attribution', () => {
    const q = T.buildQueue([cand({ pool: 'views-press' })], ctx());
    assert.strictEqual(q[0].pool, 'views-press');
  });

  console.log(`\n${passed} passed`);
})();
