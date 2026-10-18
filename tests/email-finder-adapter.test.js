// tests/email-finder-adapter.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const A = require('../shared/outreach-core/enrichment/email-finder-adapter');

const HOME = '/home/kobi';
const KT = path.join(HOME, 'Development/One Hour Vibe Coder/kobestarr-tools');
const WT = path.join(KT, '.worktrees/email-finder/engines/email-finder');
const MAIN = path.join(KT, 'engines/email-finder');

const existsIn = (...dirs) => p => dirs.some(d => [path.join(d, 'cli.js'), path.join(d, 'node_modules'), d].includes(p));

test('EMAIL_FINDER_HOME wins, then the worktree, then engines/', () => {
  const loaded = [];
  const req = p => { loaded.push(p); return { createEmailFinder: () => ({}) }; };
  A.loadFinderLib({ env: { EMAIL_FINDER_HOME: '/custom/ef' }, home: HOME, exists: existsIn('/custom/ef', WT, MAIN), req });
  A.loadFinderLib({ env: {}, home: HOME, exists: existsIn(WT, MAIN), req });
  A.loadFinderLib({ env: {}, home: HOME, exists: existsIn(MAIN), req });
  assert.deepStrictEqual(loaded, [path.join('/custom/ef', 'index.js'), path.join(WT, 'index.js'), path.join(MAIN, 'index.js')]);
});

test('a directory without cli.js or without node_modules is skipped', () => {
  const loaded = [];
  const req = p => { loaded.push(p); return {}; };
  const exists = p => p === path.join(WT, 'cli.js') /* no node_modules in WT */ || [path.join(MAIN, 'cli.js'), path.join(MAIN, 'node_modules')].includes(p);
  A.loadFinderLib({ env: {}, home: HOME, exists, req });
  assert.deepStrictEqual(loaded, [path.join(MAIN, 'index.js')]);
});

test('when nothing is found the error names every path tried', () => {
  assert.throws(() => A.loadFinderLib({ env: { EMAIL_FINDER_HOME: '/custom/ef' }, home: HOME, exists: () => false, req: () => ({}) }), e => {
    for (const p of ['/custom/ef', WT, MAIN]) assert.ok(e.message.includes(p), `missing ${p} in: ${e.message}`);
    return true;
  });
});

function fakeLib(balance = { daily: 1500, instant: 99999 }) {
  const calls = { created: [], closed: 0 };
  return {
    calls,
    createEmailFinder: opts => { calls.created.push(opts); return { balance: async () => balance, close: () => { calls.closed++; }, findMany: async () => ({}) }; },
  };
}

test('openFinder forces useReserve false even when asked for true', () => {
  const lib = fakeLib();
  A.openFinder({ lib, maxCredits: 100, maxIcypeas: 5, useReserve: true });
  assert.strictEqual(lib.calls.created[0].useReserve, false);
  assert.strictEqual(lib.calls.created[0].maxCredits, 100);
  assert.strictEqual(lib.calls.created[0].maxIcypeas, 5);
});

test('a missing, null, NaN or negative maxIcypeas becomes 0', () => {
  for (const v of [undefined, null, NaN, -3, 'abc']) {
    const lib = fakeLib();
    A.openFinder({ lib, maxIcypeas: v });
    assert.strictEqual(lib.calls.created[0].maxIcypeas, 0, String(v));
  }
});

test('defaultMaxCredits is the daily balance minus headroom and never below zero', () => {
  assert.strictEqual(A.defaultMaxCredits({ daily: 2100, instant: 347000 }), 1800);
  assert.strictEqual(A.defaultMaxCredits({ daily: 2100 }, 100), 2000);
  assert.strictEqual(A.defaultMaxCredits({ daily: 200 }), 0);
  assert.strictEqual(A.defaultMaxCredits({}), 0);
  assert.strictEqual(A.defaultMaxCredits(null), 0);
});

test('openFinderBounded probes the balance once, closes the probe, then opens with the computed cap', async () => {
  const lib = fakeLib({ daily: 1500, instant: 5 });
  const f = await A.openFinderBounded({ lib });
  assert.strictEqual(lib.calls.created.length, 2);
  assert.strictEqual(lib.calls.closed, 1);
  assert.strictEqual(lib.calls.created[1].maxCredits, 1200);
  assert.strictEqual(lib.calls.created[1].useReserve, false);
  assert.strictEqual(lib.calls.created[1].maxIcypeas, 0);
  assert.strictEqual(typeof f.findMany, 'function');
});

test('an explicit maxCredits skips the probe, including an explicit zero', async () => {
  const lib = fakeLib();
  await A.openFinderBounded({ lib, maxCredits: 0 });
  assert.strictEqual(lib.calls.created.length, 1);
  assert.strictEqual(lib.calls.created[0].maxCredits, 0);
});
