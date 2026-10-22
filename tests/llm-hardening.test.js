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

// plan: array of { status, json | raw, headers, asyncEmit, dropMidBody } | { netError: code, written } | 'timeout'
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
      const go = () => {
        if (step === 'timeout') return onTimeout();
        if (step.netError) {
          if (step.written) req.emit('finish');
          return req.emit('error', Object.assign(new Error(step.netError), { code: step.netError }));
        }
        req.emit('finish');
        const res = new EventEmitter();
        res.statusCode = step.status;
        res.headers = step.headers || {};
        cb(res);
        res.emit('data', step.raw !== undefined ? step.raw : JSON.stringify(step.json));
        if (step.dropMidBody) return res.emit('close');
        res.emit('end');
        res.emit('close');
      };
      if (step && step.asyncEmit) setImmediate(go); else go();
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

test('a zero USD cap blocks all spend; typos fall back to the defaults instead of disabling the cap', () => {
  process.env.OUTREACH_RUN_USD_CAP = '0';
  process.env.OUTREACH_DAY_USD_CAP = '0';
  const z = newBudget();
  assert.strictEqual(z.usdCap, 0);
  assert.strictEqual(z.dayUsdCap, 0);
  assert.throws(() => z.assertCanCall(), budgetLib.RunBudgetExceededError);
  for (const bad of ['abc', '-1', 'Infinity']) {
    process.env.OUTREACH_DAY_USD_CAP = bad;
    process.env.OUTREACH_RUN_USD_CAP = bad;
    const b = newBudget();
    assert.strictEqual(b.dayUsdCap, 3);
    assert.strictEqual(b.usdCap, 1.5);
  }
  delete process.env.OUTREACH_RUN_USD_CAP;
});

test('unknown models are charged at exactly $10 in / $50 out', () => {
  assert.strictEqual(budgetLib.costOf('claude-something-new', { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 60);
  assert.strictEqual(budgetLib.costOf('claude-something-new', { cache_read_input_tokens: 1_000_000 }), 1);
  assert.strictEqual(budgetLib.costOf('claude-something-new', { cache_creation_input_tokens: 1_000_000 }), 12.5);
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
  assert.strictEqual(stripDashes('a — b'), 'a - b');
  assert.strictEqual(stripDashes('Short one.\n\n— Kobi'), 'Short one.\n\n- Kobi');
  assert.strictEqual(stripDashes('open 9–5'), 'open 9-5');
  assert.strictEqual(stripDashes('Hall–Wood Ltd'), 'Hall-Wood Ltd');
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

const { shapeBody } = require('../shared/outreach-core/llm-models');
const { priceLeads, holdOnBudgetStop } = require('../shared/outreach-core/enrichment/price-leads');
const { classifyReply } = require('../shared/outreach-core/replies/classify');
const { draftReply } = require('../shared/outreach-core/replies/draft');
const { processNew } = require('../shared/outreach-core/replies/engine');
const replyLlm = require('../shared/outreach-core/replies/llm');

const stop = () => new budgetLib.RunBudgetExceededError('usd_cap', newBudget().snapshot());

test('priceLeads: a budget stop holds the remaining leads, never defaults a tier, one loud line', async () => {
  const logs = [], errs = [];
  const leads = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  let n = 0;
  const out = await priceLeads(leads, {
    estimateRevenue: async () => { if (++n === 2) throw stop(); return { estimatedRevenue: 500000, revenueBand: '500k', confidence: 5 }; },
    assignTier: () => ({ tierId: 'tier3', setupFee: 1, monthlyPrice: 2 }),
    log: (m) => logs.push(m), logError: (m) => errs.push(m),
  });
  assert.deepStrictEqual(leads.map((l) => l.name), ['A'], 'only the priced lead stays in the send list');
  assert.deepStrictEqual(out.held.map((l) => l.name), ['B', 'C']);
  assert.ok(out.held.every((l) => l.assignedOfferTier === undefined));
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /BUDGET CAP HIT.*2 of 3 leads held back/);
});

test('priceLeads: an ordinary failure still takes the visible default tier', async () => {
  const leads = [{ name: 'A' }];
  await priceLeads(leads, { estimateRevenue: async () => { throw new Error('parse'); }, assignTier: () => ({}), log: quiet, logError: quiet });
  assert.strictEqual(leads[0].assignedOfferTier, 'tier1');
});

test('holdOnBudgetStop ignores other errors', () => {
  assert.strictEqual(holdOnBudgetStop(new Error('x'), [1], 0), null);
});

test('anthropic-call: DNS and connect failures are never booked; a reset after sending is; retried HTTP errors are not', async () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED']) {
    const b = newBudget();
    fakeHttpsPlan([{ netError: code, written: false }]);
    await assert.rejects(() => call(b));
    assert.strictEqual(b.snapshot().calls, 0, code);
    assert.strictEqual(b.snapshot().usd, 0);
    mock.restoreAll();
  }
  let b = newBudget();
  fakeHttpsPlan([{ netError: 'ECONNRESET', written: false }]);
  await assert.rejects(() => call(b));
  assert.strictEqual(b.snapshot().calls, 0, 'reset before the request was written');
  mock.restoreAll();
  b = newBudget();
  fakeHttpsPlan([{ netError: 'ECONNRESET', written: true }]);
  await assert.rejects(() => call(b));
  assert.strictEqual(b.snapshot().unknownCalls, 3, 'each of the 3 attempts was written and reset');
  mock.restoreAll();
  b = newBudget();
  fakeHttpsPlan([{ status: 429, json: { error: { message: 'slow down' } } }]);
  await assert.rejects(() => call(b));
  assert.strictEqual(b.snapshot().calls, 0, 'retried HTTP errors are not booked');
});

test('anthropic-call: a connection dropped mid-body rejects, retries and is booked as unknown', async () => {
  const b = newBudget();
  const calls = fakeHttpsPlan([{ status: 200, raw: '{"content":', dropMidBody: true, asyncEmit: true }, ok()]);
  const out = await call(b);
  assert.strictEqual(out.text, 'fine');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(b.snapshot().unknownCalls, 1);
});

test('anthropic-call: Retry-After is honoured and capped at 30 seconds', async () => {
  const sleeps = [];
  fakeHttpsPlan([{ status: 429, headers: { 'retry-after': '7' }, json: { error: { message: 'x' } } }, { status: 429, headers: { 'retry-after': '600' }, json: { error: { message: 'x' } } }, ok()]);
  await call(newBudget(), { sleep: async (ms) => sleeps.push(ms) });
  assert.ok(sleeps[0] >= 7000);
  assert.strictEqual(sleeps[1], 30000);
});

test('shapeBody treats dated and -latest ids like the bare id and strips sampling on older no-sampling models', () => {
  assert.deepStrictEqual(shapeBody({ model: 'claude-haiku-5-5-latest', max_tokens: 100 }).thinking, { type: 'disabled' });
  assert.deepStrictEqual(shapeBody({ model: 'claude-sonnet-5-5-20261001', max_tokens: 100 }).thinking, { type: 'between_tools' });
  assert.strictEqual(shapeBody({ model: 'claude-opus-4-7', max_tokens: 100, temperature: 0.5 }).temperature, undefined);
  assert.strictEqual(shapeBody({ model: 'claude-opus-4-5', max_tokens: 100, temperature: 0.5 }).temperature, 0.5);
});

test('email parser: Subject alone on its line takes the next line as the subject', () => {
  assert.deepStrictEqual(parseEmailContent('Subject:\nquick thought\n\nBody:\nHi Sam'), { subject: 'quick thought', body: 'Hi Sam' });
  assert.deepStrictEqual(parseEmailContent('**Subject:**\n\nquick thought\n\nHi Sam,\n\nok'), { subject: 'quick thought', body: 'Hi Sam,\n\nok' });
});

test('naturalise only accepts a short name that comes from the full name', () => {
  assert.strictEqual(nat.plausibleShort('Smith Cooper Solicitors LLP', 'Smith Cooper'), true);
  assert.strictEqual(nat.plausibleShort('Smith Cooper Solicitors LLP', 'smith cooper'), true);
  assert.strictEqual(nat.plausibleShort('Smith Cooper Solicitors LLP', 'Jones'), false);
  assert.strictEqual(nat.plausibleShort('X', ''), false);
});

test('classifyReply marks budget and API failures retryable, but not a truncated answer', async () => {
  const reply = { subject: 'Re: hello', body: 'Please can you tell me more about this?' };
  const budgetFail = await classifyReply(reply, { llm: async () => { throw stop(); } });
  assert.strictEqual(budgetFail.label, 'maybe');
  assert.strictEqual(budgetFail.retry, 'budget');
  const apiFail = await classifyReply(reply, { llm: async () => { throw new Error('Anthropic 500'); } });
  assert.strictEqual(apiFail.retry, 'api');
  const cut = await classifyReply(reply, { llm: async () => { throw new AnthropicStopError('max_tokens', 'm'); } });
  assert.strictEqual(cut.retry, undefined);
  assert.ok(cut.fallback);
});

test('draftReply degrades to an empty draft with the error when the budget throws', async () => {
  const d = await draftReply({ lead: { email: 'a@b.test', firstName: 'Sam' }, reply: { subject: 's', body: 'tell me more' }, label: 'warm' }, { llm: async () => { throw stop(); }, config: {} });
  assert.strictEqual(d.text, '');
  assert.match(d.error, /budget/i);
});

test('engine: an unclassifiable reply stays unseen, one loud Buzz line, not repeated within 6 hours', async () => {
  const posts = [];
  const now = new Date('2026-10-22T10:00:00Z');
  const state = {};
  const rec = { msgid: 'm1', from: 'Sam <sam@lead.test>', to: 'kobi@kobestarr.io', subject: 'Re: hi', body: 'please remove me from your list?', date: now.toISOString() };
  const deps = (when) => ({ now: () => when, classify: async () => ({ label: 'maybe', reason: 'x', fallback: true, retry: 'budget' }), draft: async () => ({ text: '' }), post: async (t) => { posts.push(t); }, block: async () => ({ complete: true }) });
  const r1 = await processNew({ replies: [rec], events: [], state }, deps(now));
  assert.strictEqual(state.seen.m1, undefined, 'not marked seen, so it is retried');
  assert.strictEqual(r1.errors.length, 1);
  assert.strictEqual(posts.filter((t) => /AI cap hit, 1 reply unclassified/.test(t)).length, 1);
  await processNew({ replies: [rec], events: [], state }, deps(new Date(now.getTime() + 5 * 60_000)));
  assert.strictEqual(posts.length, 1, 'no repeat alert within 6 hours');
  await processNew({ replies: [rec], events: [], state }, deps(new Date(now.getTime() + 7 * 3_600_000)));
  assert.strictEqual(posts.length, 2);
});

test('reply budget is separate: batch work at its daily cap does not stop reply classification', async () => {
  process.env.OUTREACH_DAY_USD_CAP = '0.01';
  const batch = newBudget();
  batch.record('claude-sonnet-5-5', { input_tokens: 100_000, output_tokens: 10_000 });
  assert.throws(() => batch.assertCanCall(), budgetLib.RunBudgetExceededError);
  replyLlm.resetReplyBudget();
  const llm = replyLlm.makeAnthropicLlm({ apiKey: 'k', model: 'claude-haiku-5-5', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }) }) });
  assert.strictEqual(await llm({ system: 's', user: 'u' }), 'ok');
  assert.ok(fs.existsSync(path.join(ledgerDir, 'reply-llm')), 'its own ledger directory');
  replyLlm.resetReplyBudget();
});
