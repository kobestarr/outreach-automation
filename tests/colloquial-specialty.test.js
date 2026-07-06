// tests/colloquial-specialty.test.js
const assert = require('assert');
const { colloquialSpecialtyPlural, resolveAll } = require('../shared/outreach-core/enrichment/colloquial-specialty.js');

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log('  ok -', name); } catch (e) { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; } };

test('plain consultant cardiologist', () =>
  assert.strictEqual(colloquialSpecialtyPlural('Consultant Cardiologist'), 'cardiologists'));

test('electrophysiologist beats base cardiologist (specificity order)', () =>
  assert.strictEqual(colloquialSpecialtyPlural('Consultant Cardiologist And Electrophysiologist'), 'heart rhythm specialists'));

test('heart failure variant', () =>
  assert.strictEqual(colloquialSpecialtyPlural('Consultant Cardiologist And Honorary Professor - Scottish National Advanced Heart Failure Service'), 'heart failure specialists'));

test('title noise (professor/lecturer prefixes) still maps', () =>
  assert.strictEqual(colloquialSpecialtyPlural('Clinical Senior Lecturer And Honorary Consultant Cardiologist'), 'cardiologists'));

test('case-insensitive', () =>
  assert.strictEqual(colloquialSpecialtyPlural('CONSULTANT CARDIOLOGIST'), 'cardiologists'));

test('paediatric neurosurgeon -> patient phrase', () =>
  assert.strictEqual(colloquialSpecialtyPlural('Consultant Paediatric Neurosurgeon'), "children's brain surgeons"));

test('unknown title -> null', () =>
  assert.strictEqual(colloquialSpecialtyPlural('Chief Happiness Officer'), null));

test('empty/undefined -> null', () => {
  assert.strictEqual(colloquialSpecialtyPlural(''), null);
  assert.strictEqual(colloquialSpecialtyPlural(undefined), null);
});

test('resolveAll surfaces unmapped and applies fallback', () => {
  const { byTitle, unmapped } = resolveAll(['Consultant Cardiologist', 'Space Wizard'], { fallback: 'consultants' });
  assert.strictEqual(byTitle['Consultant Cardiologist'], 'cardiologists');
  assert.strictEqual(byTitle['Space Wizard'], 'consultants');
  assert.deepStrictEqual(unmapped, ['Space Wizard']);
});

test('resolveAll without fallback leaves unmapped out of byTitle', () => {
  const { byTitle, unmapped } = resolveAll(['Space Wizard']);
  assert.strictEqual(byTitle['Space Wizard'], undefined);
  assert.deepStrictEqual(unmapped, ['Space Wizard']);
});

console.log(`\n${passed} passed`);
