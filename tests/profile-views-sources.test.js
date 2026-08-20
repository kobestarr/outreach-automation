// tests/profile-views-sources.test.js
// Pure helpers in daily-profile-views.js. The resolve cache holds usernames in
// BOTH decoded (emoji) and percent-encoded form, so building a profile URL by
// string interpolation emits either a raw-unicode path or a double-encoded one.
const assert = require('assert');
const E = require('../daily-profile-views.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const PCT = '%f0%9f%8e%99-jake-warren-%f0%9f%8e%a7-04831489';
const RAW = '\u{1F399}-jake-warren';

(async () => {
  await test('a plain username passes through untouched', () => {
    assert.strictEqual(E.profileUrlFor('plain-name'), 'https://www.linkedin.com/in/plain-name');
  });

  await test('an already percent-encoded key is not double-encoded', () => {
    const url = E.profileUrlFor(PCT);
    assert.ok(!url.includes('%25'), 'must not contain %25, that is a double-encoded percent');
  });

  await test('a raw-unicode key is encoded, never emitted raw', () => {
    const url = E.profileUrlFor(RAW);
    assert.ok(!/[^\x00-\x7F]/.test(url), 'URL must be pure ASCII');
    assert.ok(url.includes('jake-warren'));
  });

  await test('profileUrlFor round-trips through usernameOf', () => {
    for (const u of ['plain-name', PCT, RAW, 'o-brien-123']) {
      assert.strictEqual(E.profileUrlFor(u), E.profileUrlFor(E.usernameOf(E.profileUrlFor(u))), `unstable for ${u}`);
    }
  });

  await test('usernameOf survives a malformed percent sequence without throwing', () => {
    assert.strictEqual(E.usernameOf('https://www.linkedin.com/in/100%-committed'), '100%-committed');
  });

  await test('usernameOf returns null for a non-profile URL', () => {
    assert.strictEqual(E.usernameOf('https://www.linkedin.com/company/acme/'), null);
    assert.strictEqual(E.usernameOf(''), null);
    assert.strictEqual(E.usernameOf(null), null);
  });

  await test('buildCandidates labels post authors as views-active and cache as views-cache', () => {
    const cache = { alice: {}, bob: {} };
    const posted = new Map([['alice', 1700000000000]]);
    const out = E.buildCandidates(cache, posted);
    const byName = Object.fromEntries(out.map((c) => [c.username, c]));
    assert.strictEqual(byName.alice.pool, 'views-active', 'a post author claims views-active');
    assert.strictEqual(byName.alice.lastPostedAt, 1700000000000);
    assert.strictEqual(byName.bob.pool, 'views-cache');
    assert.strictEqual(byName.bob.lastPostedAt, null);
  });

  await test('buildCandidates never emits the same person twice', () => {
    const out = E.buildCandidates({ alice: {} }, new Map([['alice', 1]]));
    assert.strictEqual(out.filter((c) => c.username === 'alice').length, 1);
  });

  console.log(`\n${passed} passed`);
})();
