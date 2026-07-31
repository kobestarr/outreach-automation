// tests/reaction-attribution.test.js
// Closing the loop: someone we LIKED later sends us an invite (the Armando
// Zuccali case, 2026-07-22 — liked 16:22, invite the same evening). Attribute
// it, so we learn which pool actually converts before scaling to 400/day.
const assert = require('assert');
const A = require('../reaction-attribution.js');

let passed = 0;
const test = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('  ok -', name); })
  .catch(e => { console.error('  FAIL -', name, '\n   ', e.message); process.exitCode = 1; });

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

(async () => {
  // ================= attribute() =================

  await test('invite from someone we liked is attributed, with days-to-connect', () => {
    const now = Date.parse('2026-07-22T20:00:00Z');
    const persons = { 'armando-zuccali': iso(now - 4 * 3600e3) };
    const invites = [{ name: 'Armando Zuccali', publicUrl: 'https://www.linkedin.com/in/armando-zuccali' }];
    const r = A.attribute(invites, persons, { now });
    assert.strictEqual(r.attributed.length, 1);
    assert.strictEqual(r.attributed[0].username, 'armando-zuccali');
    assert.strictEqual(r.attributed[0].daysToConnect, 0);
    assert.strictEqual(r.unattributed.length, 0);
  });

  await test('invite from someone we never liked is NOT attributed', () => {
    const now = Date.now();
    const r = A.attribute([{ name: 'Random Person', publicUrl: 'https://www.linkedin.com/in/random-person' }], {}, { now });
    assert.strictEqual(r.attributed.length, 0);
    assert.strictEqual(r.unattributed.length, 1);
    assert.strictEqual(r.unattributed[0].name, 'Random Person');
  });

  await test('a like older than the window does not get the credit', () => {
    const now = Date.parse('2026-08-30T09:00:00Z');
    const persons = { 'old-contact': iso(now - 60 * DAY) };
    const r = A.attribute([{ name: 'Old Contact', publicUrl: 'https://www.linkedin.com/in/old-contact' }], persons, { now, windowDays: 21 });
    assert.strictEqual(r.attributed.length, 0, 'a 60-day-old like must not claim credit');
    assert.strictEqual(r.unattributed.length, 1);
  });

  await test('window boundary is inclusive at exactly N days', () => {
    const now = Date.parse('2026-08-12T09:00:00Z');
    const persons = { 'edge-case': iso(now - 21 * DAY) };
    const r = A.attribute([{ name: 'Edge Case', publicUrl: 'https://www.linkedin.com/in/edge-case' }], persons, { now, windowDays: 21 });
    assert.strictEqual(r.attributed.length, 1);
    assert.strictEqual(r.attributed[0].daysToConnect, 21);
  });

  await test('username matching is case-insensitive and ignores URL noise', () => {
    const now = Date.now();
    const persons = { 'armando-zuccali': iso(now - DAY) };
    const invites = [{ name: 'Armando Zuccali', publicUrl: 'https://WWW.linkedin.com/in/Armando-Zuccali/?trk=feed' }];
    assert.strictEqual(A.attribute(invites, persons, { now }).attributed.length, 1);
  });

  await test('invite with no usable profile URL is reported, never crashes', () => {
    const r = A.attribute([{ name: 'Ghost' }, null], { x: new Date().toISOString() }, { now: Date.now() });
    assert.strictEqual(r.attributed.length, 0);
    assert.strictEqual(r.unattributed.length, 1);
  });

  await test('pool and keyword are carried through from the fire-time record', () => {
    const now = Date.now();
    const persons = { 'ellisbennett1': iso(now - 2 * DAY) };
    const meta = { ellisbennett1: { pool: 'search', keyword: 'UK agency owner' } };
    const r = A.attribute([{ name: 'Ellis Bennett FCCA', publicUrl: 'https://www.linkedin.com/in/ellisbennett1' }], persons, { now, meta });
    assert.strictEqual(r.attributed[0].pool, 'search');
    assert.strictEqual(r.attributed[0].keyword, 'UK agency owner');
  });

  await test('per-pool conversion counts are produced (the number that decides the 400/day mix)', () => {
    const now = Date.now();
    const persons = { a: iso(now - DAY), b: iso(now - DAY), c: iso(now - DAY) };
    const meta = { a: { pool: 'search' }, b: { pool: 'search' }, c: { pool: 'ksd' } };
    const invites = ['a', 'b', 'c'].map((u) => ({ name: u, publicUrl: 'https://www.linkedin.com/in/' + u }));
    const r = A.attribute(invites, persons, { now, meta });
    assert.deepStrictEqual(r.byPool, { search: 2, ksd: 1 });
  });

  // ================= diffConnections() =================
  // Pending invites vanish the moment they are accepted. Armando Zuccali was
  // already 1st-degree by the time we polled on 2026-07-22, so the invite list
  // was empty and he scored zero. New-connection diffing is what catches him.

  await test('newly appeared connections are detected', () => {
    const before = ['old-mate', 'existing-contact'];
    const after = ['old-mate', 'existing-contact', 'armando-zuccali'];
    assert.deepStrictEqual(A.diffConnections(before, after), ['armando-zuccali']);
  });

  await test('no snapshot yet means no false "everyone just connected" spike', () => {
    // First ever run: treat the whole list as the baseline, not 1,870 new leads.
    assert.deepStrictEqual(A.diffConnections([], ['a', 'b', 'c']), []);
    assert.deepStrictEqual(A.diffConnections(null, ['a', 'b']), []);
  });

  await test('removed connections do not appear as new', () => {
    assert.deepStrictEqual(A.diffConnections(['a', 'b'], ['a']), []);
  });

  await test('diff is case-insensitive', () => {
    assert.deepStrictEqual(A.diffConnections(['Armando-Zuccali'], ['armando-zuccali']), []);
  });

  await test('accepted connection is attributed just like an invite, tagged by source', () => {
    const now = Date.parse('2026-07-22T20:00:00Z');
    const persons = { 'armando-zuccali': iso(now - 4 * 3600e3) };
    const meta = { 'armando-zuccali': { pool: 'search', keyword: 'UK agency owner' } };
    const r = A.attribute(
      [{ name: 'armando-zuccali', publicUrl: 'https://www.linkedin.com/in/armando-zuccali' }],
      persons, { now, meta, source: 'connection' }
    );
    assert.strictEqual(r.attributed.length, 1);
    assert.strictEqual(r.attributed[0].source, 'connection');
    assert.strictEqual(r.attributed[0].pool, 'search');
  });

  await test('source defaults to invite when not specified', () => {
    const now = Date.now();
    const r = A.attribute([{ name: 'x', publicUrl: 'https://www.linkedin.com/in/x' }], { x: iso(now - 1000) }, { now });
    assert.strictEqual(r.attributed[0].source, 'invite');
  });

  // ================= mergeLedger() =================

  await test('ledger is idempotent: re-running the same day adds nothing', () => {
    const existing = [{ username: 'armando-zuccali', invitedAt: '2026-07-22T20:00:00.000Z' }];
    const merged = A.mergeLedger(existing, [{ username: 'armando-zuccali', invitedAt: '2026-07-23T20:00:00.000Z' }]);
    assert.strictEqual(merged.length, 1, 'same person must not be double-counted on a later run');
    assert.strictEqual(merged[0].invitedAt, '2026-07-22T20:00:00.000Z', 'first sighting wins');
  });

  await test('ledger appends genuinely new people', () => {
    const merged = A.mergeLedger([{ username: 'a' }], [{ username: 'b' }, { username: 'c' }]);
    assert.deepStrictEqual(merged.map((r) => r.username), ['a', 'b', 'c']);
  });

  await test('pending Prosp pushes are the un-pushed entries only', () => {
    const ledger = [
      { username: 'a', pushedToProsp: true },
      { username: 'b' },
      { username: 'c', pushedToProsp: false },
    ];
    assert.deepStrictEqual(A.pendingProspPush(ledger).map((r) => r.username), ['b', 'c']);
  });

  await test('pendingProspPush is empty when everything is already pushed', () => {
    assert.deepStrictEqual(A.pendingProspPush([{ username: 'a', pushedToProsp: true }]), []);
  });

  console.log(`\n${passed} passed`);
})();
