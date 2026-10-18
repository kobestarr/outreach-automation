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

// ---------- chooseOwnerEmail (status-driven; spec precedence) ----------

const pickOf = (email, rule) => ({ email, rule, guesses: [], alternatives: [] });
const NONE = pickOf(null, 'none');
const fr = (status, email, confidence = '', extra = {}) => ({ status, email, confidence, suggested_email: '', ...extra });
const choose = (pick, finderResult) => E.chooseOwnerEmail({ pick, finderResult });

test('1. a scraped owner address wins over everything and is labelled scraped_owner', () => {
  for (const rule of ['owner-match', 'owner-freemail']) {
    const r = choose(pickOf('tony@acme.co.uk', rule), fr('found', 'anthony.millar@acme.co.uk', 'high'));
    assert.strictEqual(r.email, 'tony@acme.co.uk');
    assert.strictEqual(r.email_rule, rule);
    assert.strictEqual(r.email_source, 'scraped');
    assert.strictEqual(r.email_status, 'scraped_owner');
  }
});

test('2. a finder personal address beats a scraped role inbox (found, found_flagged, high-confidence catch-all and Icypeas)', () => {
  const role = pickOf('info@acme.co.uk', 'role');
  for (const [status, conf] of [['found', 'high'], ['found_flagged', 'medium'], ['catch_all_found', 'high'], ['icypeas_found', 'high']]) {
    const r = choose(role, fr(status, 'anthony@acme.co.uk', conf));
    assert.strictEqual(r.email, 'anthony@acme.co.uk', status);
    assert.strictEqual(r.email_rule, 'finder-found');
    assert.strictEqual(r.email_source, 'finder');
    assert.strictEqual(r.email_status, status);
    assert.strictEqual(r.email_confidence, conf);
  }
});

test('3. a scraped role inbox beats a finder generic inbox', () => {
  const r = choose(pickOf('enquiries@acme.co.uk', 'role'), fr('found_generic', 'info@acme.co.uk', 'medium'));
  assert.strictEqual(r.email, 'enquiries@acme.co.uk');
  assert.strictEqual(r.email_status, 'scraped_role');
  assert.strictEqual(r.email_source, 'scraped');
});

test('4. a finder generic inbox beats a scraped staff address', () => {
  const r = choose(pickOf('sarah@acme.co.uk', 'staff'), fr('found_generic', 'info@acme.co.uk', 'medium'));
  assert.strictEqual(r.email, 'info@acme.co.uk');
  assert.strictEqual(r.email_rule, 'finder-generic');
  assert.strictEqual(r.email_status, 'found_generic');
});

test('5. a scraped staff address beats an Icypeas probable find', () => {
  for (const status of ['catch_all_found', 'icypeas_found']) {
    const r = choose(pickOf('sarah@acme.co.uk', 'staff'), fr(status, 'anthony@acme.co.uk', 'low'));
    assert.strictEqual(r.email, 'sarah@acme.co.uk');
    assert.strictEqual(r.email_status, 'scraped_staff');
  }
});

test('6. a probable find is chosen when it is all there is, with low confidence kept for routing', () => {
  const r = choose(NONE, fr('icypeas_found', 'anthony@acme.co.uk', 'low'));
  assert.strictEqual(r.email, 'anthony@acme.co.uk');
  assert.strictEqual(r.email_status, 'icypeas_found');
  assert.strictEqual(r.email_confidence, 'low');
  assert.strictEqual(r.email_rule, 'finder-found');
});

test('a catch-all find with a blank confidence is not trusted', () => {
  const r = choose(NONE, fr('catch_all_found', 'anthony@acme.co.uk', ''));
  assert.strictEqual(r.email, '');
});

test('7. nothing: a scraped non-owner freemail is dropped, status reports why', () => {
  const r = choose(pickOf('bob@gmail.com', 'freemail'), fr('not_found', ''));
  assert.strictEqual(r.email, '');
  assert.strictEqual(r.email_status, 'not_found');
  assert.strictEqual(r.email_source, '');
  assert.strictEqual(choose(pickOf('bob@gmail.com', 'freemail'), null).email, '');
});

test('left_company has an email but is never chosen', () => {
  const r = choose(NONE, fr('left_company', 'anthony@acme.co.uk', 'low'));
  assert.strictEqual(r.email, '');
  assert.strictEqual(r.email_status, 'left_company');
});

test('left_company falls back to a scraped role inbox, not the disabled address', () => {
  const r = choose(pickOf('info@acme.co.uk', 'role'), fr('left_company', 'anthony@acme.co.uk', 'low'));
  assert.strictEqual(r.email, 'info@acme.co.uk');
  assert.strictEqual(r.email_status, 'scraped_role');
});

test('suppressed removes the row entirely, even with a scraped role or staff address at that firm', () => {
  for (const rule of ['role', 'staff', 'owner-match']) {
    const r = choose(pickOf('x@acme.co.uk', rule), fr('suppressed', ''));
    assert.strictEqual(r.email, '', rule);
    assert.strictEqual(r.email_status, 'suppressed');
  }
});

test('a finder error keeps a valid scraped role address as scraped_role', () => {
  for (const status of ['error', 'skipped', 'not_run', 'retry_later']) {
    const r = choose(pickOf('info@acme.co.uk', 'role'), fr(status, ''));
    assert.strictEqual(r.email, 'info@acme.co.uk', status);
    assert.strictEqual(r.email_status, 'scraped_role');
  }
  const none = choose(NONE, fr('error', ''));
  assert.strictEqual(none.email, '');
  assert.strictEqual(none.email_status, 'error');
});

test('email_suggested is copied from the finder and never becomes the email', () => {
  const r = choose(NONE, fr('unverifiable', '', 'low', { suggested_email: 'anthony@acme.co.uk' }));
  assert.strictEqual(r.email, '');
  assert.strictEqual(r.email_suggested, 'anthony@acme.co.uk');
  assert.strictEqual(r.email_status, 'unverifiable');
  const withPick = choose(pickOf('info@acme.co.uk', 'role'), fr('unverifiable', '', 'low', { suggested_email: 'anthony@acme.co.uk' }));
  assert.strictEqual(withPick.email, 'info@acme.co.uk');
  assert.strictEqual(withPick.email_suggested, 'anthony@acme.co.uk');
});

test('no finder result and a scraped pick: scraped statuses by rule', () => {
  assert.strictEqual(choose(pickOf('info@acme.co.uk', 'role'), null).email_status, 'scraped_role');
  assert.strictEqual(choose(pickOf('sarah@acme.co.uk', 'staff'), null).email_status, 'scraped_staff');
  assert.strictEqual(choose(pickOf('t@gmail.com', 'owner-freemail'), undefined).email_status, 'scraped_owner');
});

test('a finder status with an empty email is never chosen', () => {
  assert.strictEqual(choose(NONE, fr('found', '', 'high')).email, '');
  assert.strictEqual(choose(NONE, fr('found_generic', '', 'medium')).email, '');
});

test('resolveOwnerEmail stays exported', () => {
  assert.strictEqual(typeof E.resolveOwnerEmail, 'function');
  assert.strictEqual(typeof E.pickBestEmail, 'function');
});

test('isFreemailDomain: real free providers yes, a company subdomain starting mail. no', () => {
  for (const d of ['gmail.com', 'hotmail.co.uk', 'btinternet.com', 'yahoo.co.uk', 'Outlook.com', 'mail.com']) assert.strictEqual(E.isFreemailDomain(d), true, d);
  for (const d of ['mail.acme.co.uk', 'acme.co.uk', 'gmail.acme.com', '']) assert.strictEqual(E.isFreemailDomain(d), false, d);
});
