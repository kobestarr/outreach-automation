#!/usr/bin/env node
/**
 * Score the reply classifier against the hand-labelled fixture (tests/fixtures/replies-2026-10-18.jsonl).
 *   node scripts/eval-classifier.js                real Haiku (costs a few pence, reads ~/.credentials/api-keys.json)
 *   node scripts/eval-classifier.js --deterministic   rules only, no network (undecided rows fall back to "maybe")
 * Gates: >= 95% agreement; every warm row labelled warm; zero warm/maybe/referral rows labelled no.
 */
const fs = require('fs');
const path = require('path');
const { classifyReply } = require('../shared/outreach-core/replies/classify');

const FIXTURES = ['replies-2026-10-18.jsonl', 'replies-must-not-block.jsonl'].map(f => path.join(__dirname, '..', 'tests', 'fixtures', f));
const loadRows = f => fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));

async function evaluate(rows, { llm } = {}) {
  const out = [];
  for (const r of rows) {
    const c = await classifyReply({ subject: r.subject, body: r.body, from: r.from, cc: r.cc, auto_submitted: r.auto_submitted, precedence: r.precedence }, { llm });
    out.push({ from: r.from, subject: r.subject, expected: r.label, got: c.label, reason: c.reason, fallback: !!c.fallback });
  }
  const agree = out.filter(x => x.expected === x.got).length;
  const warm = out.filter(x => x.expected === 'warm');
  const live = out.filter(x => ['warm', 'maybe', 'referral'].includes(x.expected));
  const gates = [
    { name: 'agreement >= 95%', pass: agree / out.length >= 0.95, detail: `${agree}/${out.length}` },
    { name: 'all warm rows labelled warm', pass: warm.every(x => x.got === 'warm'), detail: `${warm.filter(x => x.got === 'warm').length}/${warm.length}` },
    { name: 'zero warm/maybe/referral rows labelled no', pass: live.every(x => x.got !== 'no'), detail: `${live.filter(x => x.got === 'no').length} wrong` },
  ];
  return { agreement: agree / out.length, rows: out, gates };
}

async function main() {
  const deterministic = process.argv.includes('--deterministic');
  let llm;
  if (!deterministic) {
    const { makeAnthropicLlm, loadAnthropicKey, MODELS } = require('../shared/outreach-core/replies/llm');
    llm = makeAnthropicLlm({ apiKey: loadAnthropicKey(), model: MODELS.classify, maxTokens: 300 });
  }
  const r = await evaluate(FIXTURES.flatMap(loadRows), { llm });
  for (const x of r.rows.filter(x => x.expected !== x.got)) console.log(`MISMATCH ${x.from} | ${x.subject.slice(0, 50)} | expected ${x.expected}, got ${x.got}${x.fallback ? ' (fallback)' : ''} | ${x.reason || ''}`);
  console.log(`\nAgreement: ${(r.agreement * 100).toFixed(1)}% (${r.rows.filter(x => x.expected === x.got).length}/${r.rows.length}) ${deterministic ? '[rules only]' : '[rules + Haiku]'}`);
  for (const g of r.gates) console.log(`${g.pass ? 'PASS' : 'FAIL'}  ${g.name}  ${g.detail}`);
  process.exit(r.gates.every(g => g.pass) ? 0 : 1);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(2); });
module.exports = { evaluate, loadRows };
