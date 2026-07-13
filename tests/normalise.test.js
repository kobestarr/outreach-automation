// tests/normalise.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalise, CANONICAL } = require('../shared/outreach-core/csv/normalise');

const HDR = ['Decision Maker First Name', 'Decision Maker Last Name', 'Decision Maker Email', 'Organization Name', 'City', 'Website', 'Decision Maker LinkedIn URL', 'Industries'];
const ROW = ['Sarah', 'Jones', ' Sarah.Jones@Acme.COM ', 'Acme Ltd', 'Wilmslow', 'https://acme.com', 'https://linkedin.com/in/sj', 'Health Care'];

test('maps aliased headers to canonical fields', () => {
  const { leads } = normalise([HDR, ROW]);
  const l = leads[0];
  assert.strictEqual(l.first_name, 'Sarah');
  assert.strictEqual(l.last_name, 'Jones');
  assert.strictEqual(l.email, 'sarah.jones@acme.com'); // lowercased + trimmed
  assert.strictEqual(l.company_name, 'Acme Ltd');
  assert.strictEqual(l.town, 'Wilmslow');
  assert.strictEqual(l.website, 'https://acme.com');
  assert.strictEqual(l.linkedin_url, 'https://linkedin.com/in/sj');
});

test('keeps unmapped columns in ref', () => {
  const { leads } = normalise([HDR, ROW]);
  assert.strictEqual(leads[0].ref['Industries'], 'Health Care');
});

test('already-canonical headers pass through', () => {
  const { leads } = normalise([['first_name', 'email', 'company', 'category', 'town'], ['Pete', 'p@x.co', 'Bevan & Co', 'accountant', 'Bramhall']]);
  assert.strictEqual(leads[0].company_name, 'Bevan & Co'); // company -> company_name
  assert.strictEqual(leads[0].category, 'accountant');
});

test('drops rows with invalid email, reports them', () => {
  const { leads, skipped } = normalise([['email', 'first_name'], ['not-an-email', 'X'], ['ok@x.com', 'Y']]);
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(skipped.length, 1);
  assert.strictEqual(skipped[0].reason, 'invalid_email');
});

test('single-column email CSV is processed, not silently dropped', () => {
  const { leads, skipped } = normalise([['email'], ['ok@x.com'], ['also@y.com']]);
  assert.strictEqual(leads.length, 2);
  assert.strictEqual(skipped.length, 0);
});

test('genuinely blank lines are ignored without a skip record', () => {
  const { leads, skipped } = normalise([['email', 'first_name'], ['', ''], ['ok@x.com', 'A']]);
  assert.strictEqual(leads.length, 1);
  assert.strictEqual(skipped.length, 0);
});

test('insight column maps to canonical insight field (carrier templates can use {insight})', () => {
  const { leads } = normalise([['email', 'first_name', 'insight'], ['a@x.com', 'Al', 'I asked ChatGPT this week. You were not on the list']]);
  assert.strictEqual(leads[0].insight, 'I asked ChatGPT this week. You were not on the list');
});
