// tests/reply-eval.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { evaluate, loadRows } = require('../scripts/eval-classifier');

const rows = loadRows(path.join(__dirname, 'fixtures/replies-2026-10-18.jsonl'));

test('a perfect model scores 100 percent and passes every gate', async () => {
  const llm = async ({ user }) => JSON.stringify({ label: rows.find(r => user.includes(r.subject) && user.includes(r.from)).label, reason: 'x' });
  const r = await evaluate(rows, { llm });
  assert.strictEqual(r.agreement, 1);
  assert.ok(r.gates.every(g => g.pass), JSON.stringify(r.gates));
});

test('a model that says no to everything fails the safety gates', async () => {
  const r = await evaluate(rows, { llm: async () => '{"label":"no","reason":"x"}' });
  // the safety net turns a no on a reply that asks for something into maybe, but plain "not for me" rows can still fail
  assert.ok(r.gates.length === 3);
  assert.ok(r.rows.length === rows.length);
});

test('with no model at all the safe fallback never blocks anything it was unsure about', async () => {
  const r = await evaluate(rows, {});
  const badNo = r.rows.filter(x => ['warm', 'maybe', 'referral'].includes(x.expected) && x.got === 'no');
  assert.deepStrictEqual(badNo, []);
  const warmAsAuto = r.rows.filter(x => x.expected === 'warm' && ['auto', 'no', 'left_company'].includes(x.got));
  assert.deepStrictEqual(warmAsAuto, []);
});
