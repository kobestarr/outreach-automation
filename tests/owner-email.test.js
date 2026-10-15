// tests/owner-email.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../shared/outreach-core/enrichment/owner-email');

const owner = { first: 'Anthony', last: 'Millar' };

// ---------- pickBestEmail ----------

test('nickname match beats a role inbox: tony@ is Anthony (the Great Grounds case)', () => {
  const r = E.pickBestEmail({ emails: ['enquiries@greatgrounds.co.uk', 'tony@greatgrounds.co.uk'], website: 'https://www.greatgrounds.co.uk', owner });
  assert.strictEqual(r.email, 'tony@greatgrounds.co.uk');
  assert.strictEqual(r.rule, 'owner-match');
});

test('owner patterns on the own domain: first.last, flast, last', () => {
  const site = 'https://acme.co.uk';
  assert.strictEqual(E.pickBestEmail({ emails: ['info@acme.co.uk', 'anthony.millar@acme.co.uk'], website: site, owner }).rule, 'owner-match');
  assert.strictEqual(E.pickBestEmail({ emails: ['amillar@acme.co.uk', 'info@acme.co.uk'], website: site, owner }).email, 'amillar@acme.co.uk');
  assert.strictEqual(E.pickBestEmail({ emails: ['millar@acme.co.uk'], website: site, owner }).rule, 'owner-match');
});

test('owner on a free mailbox counts (common for trades)', () => {
  const r = E.pickBestEmail({ emails: ['info@acme.co.uk', 'tony.millar@gmail.com'], website: 'acme.co.uk', owner });
  assert.strictEqual(r.email, 'tony.millar@gmail.com');
  assert.strictEqual(r.rule, 'owner-freemail');
});

test('role inbox on own domain is the fallback, with owner guesses offered', () => {
  const r = E.pickBestEmail({ emails: ['info@acme.co.uk'], website: 'www.acme.co.uk', owner });
  assert.strictEqual(r.email, 'info@acme.co.uk');
  assert.strictEqual(r.rule, 'role');
  assert.deepStrictEqual(r.guesses.slice(0, 3), ['anthony@acme.co.uk', 'anthony.millar@acme.co.uk', 'amillar@acme.co.uk']);
});

test('a staff member\'s email ranks below the role inbox', () => {
  const r = E.pickBestEmail({ emails: ['sarah@acme.co.uk', 'info@acme.co.uk'], website: 'acme.co.uk', owner });
  assert.strictEqual(r.email, 'info@acme.co.uk');
});

test('third-party and junk addresses are never chosen', () => {
  const r = E.pickBestEmail({ emails: ['abc123@sentry.io', 'noreply@acme.co.uk', 'support@wix.com', 'info@acme.co.uk'], website: 'acme.co.uk', owner });
  assert.strictEqual(r.email, 'info@acme.co.uk');
  const none = E.pickBestEmail({ emails: ['x@sentry.wixpress.com'], website: 'acme.co.uk', owner });
  assert.strictEqual(none.email, null);
});

test('a domain with a different TLD from the site still counts as own domain (reddish-joinery.co.uk vs reddishjoinery.com)', () => {
  const r = E.pickBestEmail({ emails: ['sales@reddishjoinery.com'], website: 'https://www.reddish-joinery.co.uk', owner: { first: 'Lee', last: 'Parrott' } });
  assert.strictEqual(r.rule, 'role');
});

test('no website domain: guesses are empty, never invented', () => {
  const r = E.pickBestEmail({ emails: [], website: '', owner });
  assert.strictEqual(r.email, null);
  assert.deepStrictEqual(r.guesses, []);
});

// ---------- resolveOwnerEmail (Reoon injected) ----------

test('a guess is only used when Reoon says safe; catch-all never confirms a guess', async () => {
  const verify = async es => es.map(e => ({ email: e, status: e.startsWith('anthony.millar@') ? 'safe' : 'catch_all' }));
  const r = await E.resolveOwnerEmail({ emails: ['info@acme.co.uk'], website: 'acme.co.uk', owner }, { verify });
  assert.strictEqual(r.email, 'anthony.millar@acme.co.uk');
  assert.strictEqual(r.rule, 'owner-guess-verified');
  const cc = await E.resolveOwnerEmail({ emails: ['info@acme.co.uk'], website: 'acme.co.uk', owner }, { verify: async es => es.map(e => ({ email: e, status: 'catch_all' })) });
  assert.strictEqual(cc.email, 'info@acme.co.uk');
  assert.strictEqual(cc.rule, 'role');
});

test('no verify calls when the owner is already matched', async () => {
  let called = false;
  const r = await E.resolveOwnerEmail({ emails: ['tony@greatgrounds.co.uk'], website: 'greatgrounds.co.uk', owner }, { verify: async () => { called = true; return []; } });
  assert.strictEqual(called, false);
  assert.strictEqual(r.rule, 'owner-match');
});

// ---------- decodeObfuscated ----------

test('decodes Cloudflare-protected emails', () => {
  // "info@acme.co.uk" encoded with key 0x42
  const key = 0x42, plain = 'info@acme.co.uk';
  const hex = key.toString(16).padStart(2, '0') + [...plain].map(c => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
  assert.deepStrictEqual(E.decodeObfuscated(`<a href="/cdn-cgi/l/email-protection" data-cfemail="${hex}">[email&#160;protected]</a>`), ['info@acme.co.uk']);
});

test('decodes [at] / (at) / entity / url-encoded forms', () => {
  const out = E.decodeObfuscated('Email tony [at] greatgrounds [dot] co.uk or sales(at)acme.co.uk, bob&#64;acme.co.uk, <a href="mailto:jo%40acme.co.uk?subject=Hi">');
  assert.deepStrictEqual(out.sort(), ['bob@acme.co.uk', 'jo@acme.co.uk', 'sales@acme.co.uk', 'tony@greatgrounds.co.uk']);
});
