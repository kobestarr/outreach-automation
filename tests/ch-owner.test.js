// tests/ch-owner.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const O = require('../shared/outreach-core/enrichment/ch-owner');

// ---------- parseChName ----------

test('Companies House "SURNAME, Forenames" becomes First / Last, title-cased', () => {
  assert.deepStrictEqual(O.parseChName('WOOD, David John'), { first: 'David', last: 'Wood', full: 'David Wood' });
});

test('handles Mc/Mac, O\', hyphens and lowercase input', () => {
  assert.strictEqual(O.parseChName('MCDONALD, Ian').last, 'McDonald');
  assert.strictEqual(O.parseChName("O'BRIEN, sean").full, "Sean O'Brien");
  assert.strictEqual(O.parseChName('SMITH-JONES, MARY-ANN').full, 'Mary-Ann Smith-Jones');
});

test('strips honorifics that sometimes appear in the forenames', () => {
  assert.strictEqual(O.parseChName('PATEL, Dr Anil Kumar').first, 'Anil');
  assert.strictEqual(O.parseChName('JONES, Mrs Susan').first, 'Susan');
});

test('a name without a comma is treated as "First Last"', () => {
  assert.deepStrictEqual(O.parseChName('Peter Brown'), { first: 'Peter', last: 'Brown', full: 'Peter Brown' });
});

test('empty or junk input returns null', () => {
  assert.strictEqual(O.parseChName(''), null);
  assert.strictEqual(O.parseChName(null), null);
  assert.strictEqual(O.parseChName('SMITH,'), null);
});

// ---------- pickOwner ----------

const off = (name, role, appointed, resigned) => ({ name, officer_role: role, appointed_on: appointed, ...(resigned ? { resigned_on: resigned } : {}) });

test('never picks a resigned director (the old filter bug)', () => {
  const r = O.pickOwner([
    off('OLD, Mark', 'director', '2005-01-01', '2019-06-30'),
    off('NEW, Sarah', 'director', '2019-07-01'),
  ]);
  assert.strictEqual(r.first, 'Sarah');
});

test('picks the longest-serving active director and counts the others', () => {
  const r = O.pickOwner([
    off('LATE, Tom', 'director', '2021-03-01'),
    off('FOUNDER, Anne', 'director', '2009-05-12'),
    off('SEC, Bob', 'secretary', '2001-01-01'),
  ]);
  assert.strictEqual(r.first, 'Anne');
  assert.strictEqual(r.appointed_on, '2009-05-12');
  assert.strictEqual(r.other_directors, 1);
});

test('ignores corporate officers and secretaries; accepts LLP members', () => {
  assert.strictEqual(O.pickOwner([off('HOLDCO LIMITED', 'corporate-director', '2000-01-01'), off('SEC, Bob', 'secretary', '2000-01-01')]), null);
  assert.strictEqual(O.pickOwner([off('PARTNER, Jane', 'llp-designated-member', '2015-01-01')]).first, 'Jane');
});

test('no usable officers returns null', () => {
  assert.strictEqual(O.pickOwner([]), null);
  assert.strictEqual(O.pickOwner(null), null);
});

// ---------- lookupOwner (I/O injected) ----------

test('lookupOwner pads the company number and fetches active officers only', async () => {
  const calls = [];
  const fetchJson = async p => { calls.push(p); return { items: [off('WOOD, David', 'director', '2010-01-01')] }; };
  const r = await O.lookupOwner('1234567', { fetchJson });
  assert.strictEqual(r.first, 'David');
  assert.deepStrictEqual(calls, ['/company/01234567/officers?register_view=false&items_per_page=100']);
});

test('lookupOwner never throws: an API error comes back as an error result', async () => {
  const r = await O.lookupOwner('SC123456', { fetchJson: async () => { throw new Error('timeout'); } });
  assert.strictEqual(r.error, 'timeout');
  assert.strictEqual(r.first, undefined);
});
