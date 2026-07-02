// tests/dedup.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { dedupe } = require('../shared/outreach-core/csv/dedup');

const L = e => ({ email: e });

test('removes within-file duplicates keeping first', () => {
  const { kept, skipped } = dedupe([L('a@x.com'), L('a@x.com'), L('b@x.com')], new Set(), new Set());
  assert.deepStrictEqual(kept.map(l => l.email), ['a@x.com', 'b@x.com']);
  assert.strictEqual(skipped[0].reason, 'dupe_in_file');
});

test('skips emails in the ledger', () => {
  const { kept, skipped } = dedupe([L('a@x.com'), L('b@x.com')], new Set(['a@x.com']), new Set());
  assert.deepStrictEqual(kept.map(l => l.email), ['b@x.com']);
  assert.strictEqual(skipped[0].reason, 'in_ledger');
});

test('skips emails already in target sheet', () => {
  const { kept, skipped } = dedupe([L('a@x.com')], new Set(), new Set(['a@x.com']));
  assert.strictEqual(kept.length, 0);
  assert.strictEqual(skipped[0].reason, 'in_sheet');
});

test('comparison is case-insensitive', () => {
  const { kept } = dedupe([L('A@X.com')], new Set(['a@x.com']), new Set());
  assert.strictEqual(kept.length, 0);
});
