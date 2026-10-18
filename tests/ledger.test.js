const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { readLedger, appendLedger } = require('../shared/outreach-core/csv/ledger');

function tmpFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), 'sent-ledger.txt'); }

test('readLedger returns empty set for missing file', () => {
  assert.strictEqual(readLedger(tmpFile()).size, 0);
});

test('appendLedger then readLedger round-trips, lowercased and deduped', () => {
  const f = tmpFile();
  appendLedger(f, ['A@X.com', 'b@y.com']);
  appendLedger(f, ['a@x.com', 'c@z.com']); // a@x.com already there -> not duplicated
  const set = readLedger(f);
  assert.deepStrictEqual([...set].sort(), ['a@x.com', 'b@y.com', 'c@z.com']);
  const lines = fs.readFileSync(f, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 3); // no duplicate line written
});

test('readLedger: a missing file is empty only when not required (dry run); required throws', () => {
  const { readLedger } = require('../shared/outreach-core/csv/ledger');
  assert.strictEqual(readLedger('/nonexistent/sent-ledger.txt').size, 0);
  assert.throws(() => readLedger('/nonexistent/sent-ledger.txt', { required: true }), /ledger not found/);
});
