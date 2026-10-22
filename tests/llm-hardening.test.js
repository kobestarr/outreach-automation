// tests/llm-hardening.test.js
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const budgetLib = require('../shared/outreach-core/llm-budget');
const { callAnthropic, AnthropicStopError } = require('../shared/outreach-core/anthropic-call');
const { stripDashes } = require('../shared/outreach-core/llm-models');
const { parseEmailContent } = require('../shared/outreach-core/content-generation/claude-email-generator');
const { gate } = require('../shared/outreach-core/enrichment/company-quality-gate');
const { classifyInBatches } = require('../shared/outreach-core/enrichment/batch-classify');
const nat = require('../shared/outreach-core/enrichment/naturalise-lib');
const { makeAnthropicLlm } = require('../shared/outreach-core/replies/llm');

let ledgerDir;
beforeEach(() => { ledgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhard-')); process.env.OUTREACH_LLM_LEDGER_DIR = ledgerDir; delete process.env.OUTREACH_DAY_USD_CAP; });
afterEach(() => { mock.restoreAll(); delete process.env.OUTREACH_LLM_LEDGER_DIR; delete process.env.OUTREACH_DAY_USD_CAP; });

const quiet = () => {};
const newBudget = (o = {}) => budgetLib.createRunBudget({ log: quiet, ...o });

// plan: array of { status, json | raw } or 'timeout'
function fakeHttpsPlan(plan, calls = []) {
  let n = 0;
  mock.method(https, 'request', (opts, cb) => {
    const step = plan[Math.min(n++, plan.length - 1)];
    const req = new EventEmitter();
    let onTimeout;
    req.setTimeout = (ms, fn) => { onTimeout = fn; };
    req.write = () => {};
    req.destroy = () => {};
    req.end = () => {
      calls.push(step);
      if (step === 'timeout') return onTimeout();
      const res = new EventEmitter();
      res.statusCode = step.status;
      cb(res);
      res.emit('data', step.raw !== undefined ? step.raw : JSON.stringify(step.json));
      res.emit('end');
    };
    return req;
  });
  return calls;
}
const ok = (extra = {}) => ({ status: 200, json: { content: [{ type: 'text', text: 'fine' }], usage: { input_tokens: 100, output_tokens: 20 }, stop_reason: 'end_turn', ...extra } });
const call = (budget, extra = {}) => callAnthropic({ apiKey: 'k', body: { model: 'claude-haiku-5-5', max_tokens: 100, messages: [] }, budget, sleep: async () => {}, ...extra });

test('stop_reason max_tokens and refusal throw a typed error but usage is still booked', async () => {
  for (const reason of ['max_tokens', 'refusal']) {
    const b = newBudget();
    fakeHttpsPlan([ok({ stop_reason: reason, content: [] })]);
    await assert.rejects(() => call(b), (e) => e instanceof AnthropicStopError && e.stopReason === reason);
    assert.strictEqual(b.snapshot().calls, 1);
    mock.restoreAll();
  }
});

test('retries 529 twice with jitter then succeeds; gives up after two retries', async () => {
  const sleeps = [];
  let calls = fakeHttpsPlan([{ status: 529, json: { error: { message: 'overloaded' } } }, { status: 529, json: { error: { message: 'overloaded' } } }, ok()]);
  const out = await call(newBudget(), { sleep: async (ms) => sleeps.push(ms) });
  assert.strictEqual(out.text, 'fine');
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(sleeps.length, 2);
  mock.restoreAll();
  calls = fakeHttpsPlan([{ status: 503, json: { error: { message: 'down' } } }]);
  await assert.rejects(() => call(newBudget()), (e) => e.statusCode === 503 && /HTTP 503/.test(e.message));
  assert.strictEqual(calls.length, 3);
});

test('a 400 is not retried and carries its status code', async () => {
  const calls = fakeHttpsPlan([{ status: 400, json: { error: { message: 'bad temperature' } } }]);
  await assert.rejects(() => call(newBudget()), (e) => e.statusCode === 400 && /bad temperature/.test(e.message));
  assert.strictEqual(calls.length, 1);
});

test('a non-JSON body is an error with the status, not a crash', async () => {
  fakeHttpsPlan([{ status: 200, raw: '<html>gateway</html>' }]);
  await assert.rejects(() => call(newBudget()), /non-JSON body \(HTTP 200\)/);
});

test('a timeout rejects and is booked as an unknown-usage call at the worst case', async () => {
  const logs = [];
  const b = budgetLib.createRunBudget({ log: (m) => logs.push(m) });
  fakeHttpsPlan(['timeout']);
  await assert.rejects(() => call(b, { timeoutMs: 5 }), /timeout/);
  assert.strictEqual(b.snapshot().calls, 1);
  assert.strictEqual(b.snapshot().unknownCalls, 1);
  assert.ok(b.snapshot().usd > 0);
  assert.match(logs.join('\n'), /Usage unknown/);
});

test('daily ledger is shared across budgets and stops calls at OUTREACH_DAY_USD_CAP', () => {
  process.env.OUTREACH_DAY_USD_CAP = '0.05';
  const first = newBudget();
  first.record('claude-sonnet-5-5', { input_tokens: 10_000, output_tokens: 3_000 }); // $0.05
  const second = newBudget();
  assert.throws(() => second.assertCanCall(), (e) => e instanceof budgetLib.RunBudgetExceededError && e.reason === 'day_cap');
  assert.ok(fs.readdirSync(ledgerDir).some((f) => /^llm-spend-\d{4}-\d{2}-\d{2}\.json$/.test(f)));
});

test('invalid caps fall back to the defaults instead of disabling the cap', () => {
  for (const bad of ['abc', '-1', '0', 'Infinity']) {
    process.env.OUTREACH_DAY_USD_CAP = bad;
    process.env.OUTREACH_RUN_USD_CAP = bad;
    const b = newBudget();
    assert.strictEqual(b.dayUsdCap, 3);
    assert.strictEqual(b.usdCap, 1.5);
  }
  delete process.env.OUTREACH_RUN_USD_CAP;
});

test('unknown models are charged at the dearest known rate', () => {
  const known = budgetLib.costOf('claude-sonnet-4-5-20250929', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  const unknown = budgetLib.costOf('claude-fable-5-1', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(unknown >= 12 && unknown >= known, 'at least the dearest table rate');
});

test('email parser: production format, bold markdown, missing Body marker, and the Subject guard', () => {
  const prod = parseEmailContent('Subject: a lower case line\nBody: Hi Sam,\n\nShort one.\n\nSent from my iPhone');
  assert.deepStrictEqual(prod, { subject: 'a lower case line', body: 'Hi Sam,\n\nShort one.\n\nSent from my iPhone' });
  const bold = parseEmailContent('**Subject:** a lower case line\n\n**Body:**\nHi Sam,\n\nShort one.');
  assert.deepStrictEqual(bold, { subject: 'a lower case line', body: 'Hi Sam,\n\nShort one.' });
  const noBody = parseEmailContent('**Subject:** a lower case line\n\nHi Sam,\n\nShort one.');
  assert.deepStrictEqual(noBody, { subject: 'a lower case line', body: 'Hi Sam,\n\nShort one.' });
  const hashed = parseEmailContent('## Subject: x y\n\nBody: Hi Sam');
  assert.deepStrictEqual(hashed, { subject: 'x y', body: 'Hi Sam' });
  assert.throws(() => parseEmailContent('Subject: x\nSubject: y\nHi'), /Subject line/);
  assert.throws(() => parseEmailContent('Subject: only a subject'), /no body/);
});

test('dash filter: em and en dashes never survive in generated copy', () => {
  assert.strictEqual(stripDashes('a — b–c'), 'a - b - c');
  const parsed = parseEmailContent('Subject: a — b\nBody: Hi Sam – quick one — ok');
  assert.ok(!/[—–]/.test(parsed.subject + parsed.body));
});

test('company gate lets a budget stop through instead of marking every company "review"', async () => {
  const rec = { companyName: 'Acme Plumbing Ltd', location: 'Leeds', roleTitle: 'Plumber' };
  const io = {
    resolveDomain: async () => 'acme.example',
    companyProfile: async () => { throw new budgetLib.RunBudgetExceededError('usd_cap', newBudget().snapshot()); },
  };
  await assert.rejects(() => gate([rec], io), budgetLib.RunBudgetExceededError);
  const soft = await gate([rec], { resolveDomain: async () => 'acme.example', companyProfile: async () => { throw new Error('boom'); } });
  assert.strictEqual(soft[0].lane, 'review', 'ordinary failures still degrade to review');
});

test('classification fails closed: errors, budget stops and unanswered names are held, never kept', async () => {
  const logs = [];
  const names = Array.from({ length: 5 }, (_, i) => `Firm ${i}`);
  let call = 0;
  const out = await classifyInBatches(names, async (items) => {
    call++;
    if (call === 1) return [{ full: items[0].name, short: 'F', keep: true }]; // answers 1 of 2
    throw new budgetLib.RunBudgetExceededError('usd_cap', newBudget().snapshot());
  }, { batchSize: 2, log: (m) => logs.push(m) });
  assert.deepStrictEqual([...out.decided.keys()], ['Firm 0']);
  assert.deepStrictEqual(out.held, ['Firm 1', 'Firm 2', 'Firm 3', 'Firm 4']);
  assert.strictEqual(out.stopped, 'usd_cap');
  assert.strictEqual(logs.filter((m) => /BUDGET CAP HIT/.test(m)).length, 1);
  const failed = await classifyInBatches(['A', 'B'], async () => { throw new SyntaxError('bad json'); }, { batchSize: 2, log: quiet });
  assert.deepStrictEqual(failed.held, ['A', 'B']);
  assert.strictEqual(failed.decided.size, 0);
});

test('naturalise cache keeps only names the model returned', () => {
  const returned = new Map([['Sheppards Chartered Accountants', 'Sheppards'], ['Tax Assist', 'Tax Assist']]);
  const tsv = nat.buildReview(['Sheppards Chartered Accountants', 'Tax Assist', 'Missed Ltd'], returned);
  const cache = nat.parseCache(tsv);
  assert.strictEqual(cache.get('Sheppards Chartered Accountants'), 'Sheppards');
  assert.strictEqual(cache.get('Tax Assist'), 'Tax Assist');
  assert.strictEqual(cache.has('Missed Ltd'), false, 'an omitted name is sent again');
  assert.strictEqual(nat.parseCache('FULL\tSHORT\tCHANGED\nA Ltd\tA\tYES').size, 0, 'old 3-column files are not trusted');
  assert.strictEqual(nat.chunk(Array.from({ length: 130 }, (_, i) => i)).map((c) => c.length).join(','), '60,60,10');
  assert.strictEqual(nat.maxTokensFor(60), 300 + 70 * 60);
});

test('reply-engine LLM path: shaped body, budget booked, truncation raises instead of returning a stub', async () => {
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 1000, output_tokens: 50 }, stop_reason: sent.length > 1 ? 'max_tokens' : 'end_turn' }) };
  };
  const b = newBudget();
  const llm = makeAnthropicLlm({ apiKey: 'k', model: 'claude-haiku-5-5', maxTokens: 300, fetchImpl, budget: b });
  assert.strictEqual(await llm({ system: 's', user: 'u' }), '{"a":1}');
  assert.deepStrictEqual(sent[0].thinking, { type: 'disabled' });
  assert.deepStrictEqual(sent[0].output_config, { effort: 'low' });
  assert.strictEqual(sent[0].max_tokens, 300);
  assert.strictEqual(b.snapshot().calls, 1);
  await assert.rejects(() => llm({ system: 's', user: 'u' }), AnthropicStopError);
  const capped = newBudget({ maxCalls: 0 });
  const llm2 = makeAnthropicLlm({ apiKey: 'k', model: 'claude-sonnet-5-5', fetchImpl, budget: capped });
  await assert.rejects(() => llm2({ system: 's', user: 'u' }), budgetLib.RunBudgetExceededError);
});
