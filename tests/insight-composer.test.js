// tests/insight-composer.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { composeInsights, fillTemplate } = require('../shared/outreach-core/content-generation/insight-composer');

const lead = { first_name: 'Sarah', category: 'Accountant', town: 'Stockport', company_name: 'Acme' };

test('fills placeholders, lowercasing category', () => {
  const s = fillTemplate('a good {category} in {town}', lead);
  assert.strictEqual(s, 'a good accountant in Stockport');
});

test('throws on unresolved placeholder (missing lead field)', () => {
  assert.throws(() => fillTemplate('needs {signal}', lead), /unresolved placeholder/i);
});

test('rejects em dashes in composed output', () => {
  assert.throws(() => fillTemplate('bad — dash', lead), /em dash/i);
});

test('composeInsights returns one value per carrier, empty carriers = {}', () => {
  const out = composeInsights(lead, { last_name: 'ask for a good {category} in {town}' });
  assert.deepStrictEqual(Object.keys(out), ['last_name']);
  assert.strictEqual(out.last_name, 'ask for a good accountant in Stockport');
  assert.deepStrictEqual(composeInsights(lead, {}), {});
});
