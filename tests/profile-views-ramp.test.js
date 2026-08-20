// tests/profile-views-ramp.test.js
// The daily cap is NOT the binding constraint. Our account reads
// stPersonProfileViews daily 200 but weekly 560 ENABLED, and 560/7 = 80 exactly,
// so there is zero slack. A naive daily ramp past 80 spends the week's budget by
// Wednesday and then sits dead, which reads as a broken engine.
const assert = require('assert');
const R = require('../profile-views-ramp.js');
const { DEFAULT_CONFIG } = require('../profile-views-config.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, rampStartDate: '2026-09-01', ...over });
const blank = () => ({ history: {}, observedLimit: null, rampFrozen: false, viewed: {} });

(async () => {
  await test('day 0 fires the base', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-09-01'), 10);
  });

  await test('day 1 adds one step', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-09-02'), 15);
  });

  await test('day 14 reaches the 80 ceiling exactly', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-09-15'), 80);
  });

  await test('day 30 holds at the ceiling, does not keep climbing', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-10-01'), 80);
  });

  await test('a date before the ramp start clamps to the base, never negative', () => {
    assert.strictEqual(R.dailyCap(cfg(), blank(), '2026-08-20'), 10);
  });

  await test('hardMax clamps a mis-edited ceiling', () => {
    const c = cfg({ ceiling: 5000, step: 1000 });
    assert.strictEqual(R.dailyCap(c, blank(), '2026-09-15'), c.hardMax);
  });

  await test('recordLimitHit freezes the ramp and holds 10% below the observed number', () => {
    const s = blank();
    R.recordLimitHit(s, 120);
    assert.strictEqual(s.observedLimit, 120);
    assert.strictEqual(s.rampFrozen, true);
    assert.strictEqual(R.dailyCap(cfg(), s, '2026-10-01'), 108);
  });

  await test('a frozen ramp never rises again even far in the future', () => {
    const s = blank();
    R.recordLimitHit(s, 100);
    assert.strictEqual(R.dailyCap(cfg(), s, '2027-01-01'), 90);
  });

  await test('an empty history leaves the whole weekly budget', () => {
    assert.strictEqual(R.weeklyRemaining(cfg(), blank(), '2026-09-15'), 560);
  });

  await test('the trailing 7 days INCLUDING today are counted', () => {
    const s = blank();
    for (const d of ['2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14']) s.history[d] = 80;
    s.history['2026-09-15'] = 20;
    assert.strictEqual(R.weeklyRemaining(cfg(), s, '2026-09-15'), 560 - 500);
  });

  await test('days older than 7 fall out of the window', () => {
    const s = blank();
    s.history['2026-09-01'] = 500;
    assert.strictEqual(R.weeklyRemaining(cfg(), s, '2026-09-15'), 560);
  });

  await test('weeklyRemaining never goes negative', () => {
    const s = blank();
    s.history['2026-09-15'] = 9999;
    assert.strictEqual(R.weeklyRemaining(cfg(), s, '2026-09-15'), 0);
  });

  await test('effectiveCap is the daily cap when the week has room', () => {
    assert.strictEqual(R.effectiveCap(cfg(), blank(), '2026-09-15'), 80);
  });

  await test('effectiveCap is cut by the weekly budget when the week is nearly spent', () => {
    const s = blank();
    for (const d of ['2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14']) s.history[d] = 90;
    assert.strictEqual(R.effectiveCap(cfg(), s, '2026-09-15'), 20);
  });

  await test('effectiveCap is 0 once the weekly budget is gone', () => {
    const s = blank();
    for (const d of ['2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14']) s.history[d] = 100;
    assert.strictEqual(R.effectiveCap(cfg(), s, '2026-09-15'), 0);
  });

  await test('the full 14-day ramp never breaches the weekly budget', () => {
    const s = blank();
    const start = Date.parse('2026-09-01T00:00:00Z');
    const iso = (d) => new Date(start + d * 864e5).toISOString().slice(0, 10);
    for (let d = 0; d < 21; d++) {
      const day = iso(d);
      const cap = R.effectiveCap(cfg(), s, day);
      R.recordFires(s, day, cap);
      assert.ok(R.weeklyRemaining(cfg(), s, day) >= 0, `week breached on ${day}`);
    }
    const wk = (days) => days.reduce((a, d) => a + (s.history[d] || 0), 0);
    assert.strictEqual(wk([0,1,2,3,4,5,6].map(iso)), 175);
    assert.strictEqual(wk([7,8,9,10,11,12,13].map(iso)), 420);
    assert.strictEqual(wk([14,15,16,17,18,19,20].map(iso)), 560);
  });

  await test('recordFires accumulates within a day', () => {
    const s = blank();
    R.recordFires(s, '2026-09-15', 3);
    R.recordFires(s, '2026-09-15', 4);
    assert.strictEqual(s.history['2026-09-15'], 7);
  });

  console.log(`\n${passed} passed`);
})();
