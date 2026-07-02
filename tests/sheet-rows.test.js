// tests/sheet-rows.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildHeader, buildRow, MAILEAD_LABELS } = require('../shared/outreach-core/campaigns/sheet-rows');

const lead = {
  first_name: 'Sarah', last_name: 'Jones', email: 's@x.com', company_name: 'Acme',
  category: 'accountant', town: 'Stockport', website: 'https://a.com', linkedin_url: 'https://li.com/sj',
  ref: { Industries: 'Health' }, reoonStatus: 'safe', reoonScore: '98', reoonSafe: '1',
};

test('header = reference block then Mailead block, extras included', () => {
  const h = buildHeader(['Industries'], ['last_name']);
  assert.deepStrictEqual(h, [
    'first_name', 'last_name', 'email', 'company_name', 'category', 'town', 'website', 'linkedin_url',
    'reoonStatus', 'reoonScore', 'reoonSafe', 'Industries',
    'First Name', 'Last Name', 'Email', 'Company Name',
  ]);
});

test('carrier value lands in the Mailead column; real value stays in reference', () => {
  const h = buildHeader(['Industries'], ['last_name']);
  const row = buildRow(lead, h, { last_name: 'the insight text' });
  const get = name => row[h.indexOf(name)];
  assert.strictEqual(get('last_name'), 'Jones');          // reference: real surname
  assert.strictEqual(get('Last Name'), 'the insight text'); // Mailead: injected
  assert.strictEqual(get('First Name'), 'Sarah');
  assert.strictEqual(get('Email'), 's@x.com');
  assert.strictEqual(get('Company Name'), 'Acme');
  assert.strictEqual(get('Industries'), 'Health');
});

test('no carriers -> Mailead Last Name carries the real surname', () => {
  const h = buildHeader([], []);
  const row = buildRow(lead, h, {});
  assert.strictEqual(row[h.indexOf('Last Name')], 'Jones');
});

test('extra carrier adds its Title Case Mailead column', () => {
  const h = buildHeader([], ['last_name', 'linkedin_url']);
  assert.ok(h.includes('Linkedin Url'));
  const row = buildRow(lead, h, { last_name: 'i1', linkedin_url: 'i2' });
  assert.strictEqual(row[h.indexOf('Linkedin Url')], 'i2');
  assert.strictEqual(row[h.indexOf('linkedin_url')], 'https://li.com/sj'); // original preserved
});

test('extra ref column colliding with a Mailead label is prefixed and preserved', () => {
  const h = buildHeader(['Email'], ['last_name']);
  assert.ok(h.includes('ref_Email'));
  const collideLead = { ...lead, ref: { Email: 'raw-scraped@x.com' } };
  const row = buildRow(collideLead, h, { last_name: 'insight' });
  assert.strictEqual(row[h.indexOf('ref_Email')], 'raw-scraped@x.com'); // preserved
  assert.strictEqual(row[h.indexOf('Email')], 's@x.com'); // Mailead block intact
});

test('unknown carrier field with no Mailead label throws', () => {
  assert.throws(() => buildHeader([], ['nonexistent_field']), /no Mailead label/);
});
