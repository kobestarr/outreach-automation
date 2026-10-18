// tests/finder-route.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { routeFor } = require('../shared/outreach-core/campaigns/finder-route');
const { normalise } = require('../shared/outreach-core/csv/normalise');

const lead = (email, ref) => ({ email, ref });
const st = (status, confidence = '', email = 'a@acme.co.uk') => lead(email, { email_status: status, email_confidence: confidence });

test('main: found, found_flagged, scraped_owner at any confidence', () => {
  for (const s of ['found', 'found_flagged', 'scraped_owner']) {
    for (const c of ['', 'high', 'medium', 'low']) assert.strictEqual(routeFor(st(s, c)).route, 'main', `${s}/${c}`);
  }
});

test('catch-all and Icypeas finds: high is main, low is probable, anything else fails closed', () => {
  for (const s of ['catch_all_found', 'icypeas_found']) {
    assert.strictEqual(routeFor(st(s, 'high')).route, 'main');
    assert.strictEqual(routeFor(st(s, 'low')).route, 'probable');
    assert.strictEqual(routeFor(st(s, '')).route, 'excluded');
    assert.strictEqual(routeFor(st(s, 'medium')).route, 'excluded');
  }
});

test('inbox: found_generic, scraped_role, scraped_staff', () => {
  for (const s of ['found_generic', 'scraped_role', 'scraped_staff']) assert.strictEqual(routeFor(st(s, 'medium')).route, 'inbox', s);
});

test('everything else is excluded with the status in the reason', () => {
  for (const s of ['unverifiable', 'left_company', 'catch_all_unresolved', 'not_found', 'suppressed', 'error', 'skipped', 'not_run', 'retry_later', 'no_mx', 'bad_input', 'something_new']) {
    const r = routeFor(st(s, 'high'));
    assert.strictEqual(r.route, 'excluded', s);
    assert.match(r.reason, new RegExp(s));
  }
});

test('an empty email is always excluded, whatever the status', () => {
  for (const s of ['found', 'found_generic', 'scraped_owner']) assert.strictEqual(routeFor(st(s, 'high', '')).route, 'excluded');
  assert.strictEqual(routeFor(lead('', {})).route, 'excluded');
  assert.strictEqual(routeFor(lead('   ', { email_status: 'found' })).route, 'excluded');
});

test('legacy file (no email_status column at all) routes to main, behaviour unchanged', () => {
  const r = routeFor(lead('a@acme.co.uk', { town: 'Sale' }));
  assert.strictEqual(r.route, 'main');
  assert.strictEqual(r.reason, 'legacy');
  assert.strictEqual(routeFor(lead('a@acme.co.uk', undefined)).route, 'main');
});

test('fail closed: the column exists but the value is blank, so excluded', () => {
  const r = routeFor(lead('a@acme.co.uk', { email_status: '' }));
  assert.strictEqual(r.route, 'excluded');
  assert.match(r.reason, /blank/);
  assert.strictEqual(routeFor(lead('a@acme.co.uk', { email_status: '   ' })).route, 'excluded');
});

test('tolerates case and spaces', () => {
  assert.strictEqual(routeFor(lead('a@acme.co.uk', { email_status: ' Found ', email_confidence: ' HIGH ' })).route, 'main');
  assert.strictEqual(routeFor(lead('a@acme.co.uk', { email_status: 'ICYPEAS_FOUND', email_confidence: 'Low' })).route, 'probable');
});

test('email_suggested is never read: a suggestion cannot rescue an excluded row', () => {
  const r = routeFor(lead('', { email_status: 'unverifiable', email_suggested: 'anthony@acme.co.uk' }));
  assert.strictEqual(r.route, 'excluded');
  const r2 = routeFor(lead('a@acme.co.uk', { email_status: 'unverifiable', email_suggested: 'anthony@acme.co.uk' }));
  assert.strictEqual(r2.route, 'excluded');
});

test('works on real normalise() output: unknown columns land in lead.ref', () => {
  const rows = [['first_name', 'email', 'company', 'email_status', 'email_confidence'], ['Ann', 'ann@acme.co.uk', 'Acme', 'catch_all_found', 'low'], ['Bob', 'bob@acme.co.uk', 'Bob', '', '']];
  const { leads } = normalise(rows);
  assert.strictEqual(routeFor(leads[0]).route, 'probable');
  assert.strictEqual(routeFor(leads[1]).route, 'excluded');
  const legacy = normalise([['first_name', 'email', 'company'], ['Ann', 'ann@acme.co.uk', 'Acme']]).leads[0];
  assert.strictEqual(routeFor(legacy).route, 'main');
});
