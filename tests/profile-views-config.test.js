// tests/profile-views-config.test.js
// Pins the trap from HANDOVER-2026-08-20-credit-burn.md section 2.1: the JSON
// config spreads OVER the JS defaults and WINS. Patching DEFAULT_CONFIG alone
// is inert for any key present in the JSON. That cost an 18,500-credit pack,
// so it is a test here, not a comment.
const assert = require('assert');
const C = require('../profile-views-config.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

(async () => {
  await test('JSON overrides the JS default (the section 2.1 trap)', () => {
    const cfg = C.loadConfig(() => ({ ceiling: 999 }), 'ignored.json');
    assert.strictEqual(cfg.ceiling, 999, 'JSON must win over DEFAULT_CONFIG');
  });

  await test('keys absent from the JSON fall back to the JS default', () => {
    const cfg = C.loadConfig(() => ({ ceiling: 999 }), 'ignored.json');
    assert.strictEqual(cfg.base, C.DEFAULT_CONFIG.base);
    assert.strictEqual(cfg.step, C.DEFAULT_CONFIG.step);
  });

  await test('a missing JSON file yields the pure defaults', () => {
    const cfg = C.loadConfig(() => ({}), 'missing.json');
    assert.deepStrictEqual(cfg, C.DEFAULT_CONFIG);
  });

  await test('defaults encode the agreed ramp: 10 +5 to 80, weekly 560', () => {
    assert.strictEqual(C.DEFAULT_CONFIG.base, 10);
    assert.strictEqual(C.DEFAULT_CONFIG.step, 5);
    assert.strictEqual(C.DEFAULT_CONFIG.ceiling, 80);
    assert.strictEqual(C.DEFAULT_CONFIG.weeklyBudget, 560);
    assert.strictEqual(C.DEFAULT_CONFIG.hardMax, 200);
  });

  await test('Renidly spend is structurally zero', () => {
    assert.strictEqual(C.DEFAULT_CONFIG.renidlyCallBudget, 0);
  });

  console.log(`\n${passed} passed`);
})();
