// tests/linkedapi-limits.test.js
// limits.getUsage is FREE and authoritative in a way our own counter is not: a
// manual LinkedIn session, or Prosp, also consumes the same quota and the engine
// would never know. Payload shape captured live 2026-08-20.
const assert = require('assert');
const L = require('../linkedapi-limits.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

// Real payload, trimmed to the categories that matter.
const LIVE = {
  success: true,
  result: {
    usage: [
      { category: 'stPersonProfileViews', period: 'daily',   currentUsage: 1, maxValue: 200, isEnabled: true },
      { category: 'stPersonProfileViews', period: 'weekly',  currentUsage: 1, maxValue: 560, isEnabled: true },
      { category: 'stPersonProfileViews', period: 'monthly', currentUsage: 1, maxValue: 2400, isEnabled: false },
      { category: 'stReactions',          period: 'daily',   currentUsage: 83, maxValue: 200, isEnabled: true },
    ],
  },
};

(async () => {
  await test('parseUsage pulls the daily and weekly rows for the category', () => {
    const u = L.parseUsage(LIVE, 'stPersonProfileViews');
    assert.deepStrictEqual(u.daily, { used: 1, max: 200, enabled: true });
    assert.deepStrictEqual(u.weekly, { used: 1, max: 560, enabled: true });
  });

  await test('parseUsage ignores other categories', () => {
    assert.notStrictEqual(L.parseUsage(LIVE, 'stPersonProfileViews').daily.used, 83);
  });

  await test('parseUsage returns nulls for an unknown category', () => {
    const u = L.parseUsage(LIVE, 'nvMessages');
    assert.strictEqual(u.daily, null);
    assert.strictEqual(u.weekly, null);
  });

  await test('parseUsage survives a malformed payload', () => {
    assert.deepStrictEqual(L.parseUsage({}, 'stPersonProfileViews'), { daily: null, weekly: null });
    assert.deepStrictEqual(L.parseUsage(null, 'stPersonProfileViews'), { daily: null, weekly: null });
  });

  await test('shouldStop is false with headroom', () => {
    assert.deepStrictEqual(L.shouldStop(L.parseUsage(LIVE, 'stPersonProfileViews')), { stop: false, reason: null });
  });

  await test('shouldStop is true when the daily quota is spent', () => {
    const r = L.shouldStop({ daily: { used: 200, max: 200, enabled: true }, weekly: { used: 300, max: 560, enabled: true } });
    assert.strictEqual(r.stop, true);
    assert.ok(/daily/.test(r.reason));
  });

  await test('shouldStop is true when the WEEKLY quota is spent even if daily has room', () => {
    const r = L.shouldStop({ daily: { used: 10, max: 200, enabled: true }, weekly: { used: 560, max: 560, enabled: true } });
    assert.strictEqual(r.stop, true);
    assert.ok(/weekly/.test(r.reason));
  });

  await test('a DISABLED period is ignored', () => {
    assert.strictEqual(L.shouldStop({ daily: { used: 999, max: 200, enabled: false }, weekly: { used: 1, max: 560, enabled: true } }).stop, false);
  });

  await test('unknown usage does not stop the run (fail open, the ramp cap still binds)', () => {
    assert.strictEqual(L.shouldStop({ daily: null, weekly: null }).stop, false);
  });

  await test('remaining() reports the tightest enabled headroom', () => {
    assert.strictEqual(L.remaining({ daily: { used: 10, max: 200, enabled: true }, weekly: { used: 550, max: 560, enabled: true } }), 10);
    assert.strictEqual(L.remaining({ daily: { used: 195, max: 200, enabled: true }, weekly: { used: 1, max: 560, enabled: true } }), 5);
    assert.strictEqual(L.remaining({ daily: null, weekly: null }), Infinity);
  });

  await test('getUsage posts to the right path with the accountId', async () => {
    const calls = [];
    const post = async (p, b) => { calls.push([p, b]); return { status: 201, json: LIVE }; };
    const u = await L.getUsage(post, 'acc-123', 'stPersonProfileViews');
    assert.deepStrictEqual(calls[0][0], '/admin/limits.getUsage');
    assert.deepStrictEqual(calls[0][1], { accountId: 'acc-123' });
    assert.strictEqual(u.weekly.max, 560);
  });

  await test('getUsage returns nulls rather than throwing on a transport failure', async () => {
    const post = async () => { throw new Error('ECONNRESET'); };
    assert.deepStrictEqual(await L.getUsage(post, 'acc-123', 'stPersonProfileViews'), { daily: null, weekly: null });
  });

  console.log(`\n${passed} passed`);
})();
