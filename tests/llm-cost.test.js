// tests/llm-cost.test.js
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const ENV_KEYS = ['OUTREACH_COPY_MODEL', 'OUTREACH_EMAIL_MODEL', 'OUTREACH_LINKEDIN_MODEL', 'OUTREACH_MECHANICAL_MODEL',
  'OUTREACH_RUN_USD_CAP', 'OUTREACH_RUN_MAX_CALLS', 'OUTREACH_RUN_MAX_SEARCHES', 'OUTREACH_WEB_SEARCH_MAX_USES', 'OUTREACH_CREDENTIALS_PATH', 'OUTREACH_DAY_USD_CAP', 'OUTREACH_LLM_LEDGER_DIR'];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.OUTREACH_LLM_LEDGER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'llmledger-'));
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } mock.restoreAll(); });

const models = require('../shared/outreach-core/llm-models');
const budgetLib = require('../shared/outreach-core/llm-budget');

test('default models: copy on Sonnet 5.5, mechanical on Haiku 5.5', () => {
  assert.strictEqual(models.resolveModel('email'), 'claude-sonnet-5-5');
  assert.strictEqual(models.resolveModel('linkedin'), 'claude-sonnet-5-5');
  assert.strictEqual(models.resolveModel('mechanical'), 'claude-haiku-5-5');
});

test('env overrides: shared copy switch, per-site beats shared, explicit param beats env', () => {
  process.env.OUTREACH_COPY_MODEL = 'claude-haiku-5-5';
  assert.strictEqual(models.resolveModel('email'), 'claude-haiku-5-5');
  assert.strictEqual(models.resolveModel('linkedin'), 'claude-haiku-5-5');
  process.env.OUTREACH_LINKEDIN_MODEL = 'claude-sonnet-5-5';
  assert.strictEqual(models.resolveModel('linkedin'), 'claude-sonnet-5-5');
  assert.strictEqual(models.resolveModel('email', 'claude-sonnet-4-5-20250929'), 'claude-sonnet-4-5-20250929');
  process.env.OUTREACH_MECHANICAL_MODEL = 'claude-haiku-4-5-20251001';
  assert.strictEqual(models.resolveModel('mechanical'), 'claude-haiku-4-5-20251001');
});

test('request shaping: 5.x models never get temperature, Sonnet 5.5 gets between_tools, Haiku 5.5 thinking off at low effort', () => {
  const s = models.shapeBody({ model: 'claude-sonnet-5-5', max_tokens: 800, temperature: 0.7, messages: [] });
  assert.strictEqual(s.temperature, undefined);
  assert.deepStrictEqual(s.thinking, { type: 'between_tools' });
  const h = models.shapeBody({ model: 'claude-haiku-5-5', max_tokens: 200, temperature: 0.7, messages: [] });
  assert.strictEqual(h.temperature, undefined);
  assert.deepStrictEqual(h.output_config, { effort: 'low' });
  assert.deepStrictEqual(h.thinking, { type: 'disabled' });
  assert.strictEqual(h.max_tokens, 200, 'no floor needed once thinking is off');
  assert.deepStrictEqual(models.shapeBody({ model: 'claude-sonnet-5', max_tokens: 300, messages: [] }).thinking, { type: 'disabled' });
  const o = models.shapeBody({ model: 'claude-opus-5-5', max_tokens: 300, temperature: 1, messages: [] });
  assert.strictEqual(o.thinking, undefined, 'Opus 5.5 cannot turn thinking off');
  assert.strictEqual(o.temperature, undefined);
  assert.ok(o.max_tokens >= 4096, 'headroom instead');
  const old = models.shapeBody({ model: 'claude-sonnet-4-5-20250929', max_tokens: 800, temperature: 0.7, messages: [] });
  assert.strictEqual(old.temperature, 0.7);
  assert.strictEqual(old.thinking, undefined);
});

test('extractText picks the first text block, not content[0]', () => {
  assert.strictEqual(models.extractText([{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hi' }]), 'hi');
});

test('web search tool carries max_uses: default 3, env override', () => {
  assert.deepStrictEqual(budgetLib.webSearchTool(), { type: 'web_search_20250305', name: 'web_search', max_uses: 3 });
  process.env.OUTREACH_WEB_SEARCH_MAX_USES = '1';
  assert.strictEqual(budgetLib.webSearchTool().max_uses, 1);
  assert.strictEqual(budgetLib.webSearchTool({ maxUses: 5 }).max_uses, 5);
});

test('cost uses the pricing table and real usage tokens', () => {
  const c = budgetLib.costOf('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 3 } });
  assert.ok(Math.abs(c - (2 + 1 + 0.03)) < 1e-9);
  const h = budgetLib.costOf('claude-haiku-5-5', { input_tokens: 50_000, output_tokens: 50_000 });
  assert.ok(Math.abs(h - 0.03) < 1e-9);
  const hl = budgetLib.costOf('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 });
  assert.ok(Math.abs(hl - 0.1) < 1e-9, 'long-prompt tier $0.50/MTok');
  assert.ok(Math.abs(budgetLib.costOf('claude-sonnet-4-5-20250929', { input_tokens: 1_000_000, output_tokens: 0 }) - 3) < 1e-9);
});

test('defaults: $1.50 and 400 calls', () => {
  const b = budgetLib.createRunBudget({ log: () => {} });
  assert.strictEqual(b.usdCap, 1.5);
  assert.strictEqual(b.maxCalls, 400);
  process.env.OUTREACH_RUN_USD_CAP = '0.25';
  process.env.OUTREACH_RUN_MAX_CALLS = '7';
  const e = budgetLib.createRunBudget({ log: () => {} });
  assert.strictEqual(e.usdCap, 0.25);
  assert.strictEqual(e.maxCalls, 7);
});

test('USD cap stops the loop cleanly and reports the records left', async () => {
  const logs = [];
  const budget = budgetLib.createRunBudget({ usdCap: 0.05, maxCalls: 100, log: (m) => logs.push(m) });
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  const out = await budgetLib.runWithBudget(items, async (item) => {
    budget.record('claude-sonnet-5-5', { input_tokens: 10_000, output_tokens: 1_000 }); // $0.03 each
    return item.id;
  }, { budget, label: 'test' });
  assert.strictEqual(out.stopped, true);
  assert.strictEqual(out.results.length, 2);
  assert.strictEqual(out.remaining.length, 8);
  assert.match(logs.join('\n'), /BUDGET CAP HIT/);
  assert.match(logs.join('\n'), /8 of 10/);
});

test('max calls cap stops the loop', async () => {
  const budget = budgetLib.createRunBudget({ usdCap: 100, maxCalls: 3, log: () => {} });
  const out = await budgetLib.runWithBudget([1, 2, 3, 4, 5], async () => { budget.record('claude-haiku-5-5', { input_tokens: 1, output_tokens: 1 }); }, { budget });
  assert.strictEqual(out.results.length, 3);
  assert.strictEqual(out.remaining.length, 2);
  assert.strictEqual(out.reason, 'max_calls');
});

test('search cap blocks further web searches', () => {
  const budget = budgetLib.createRunBudget({ usdCap: 100, maxCalls: 100, maxSearches: 2, log: () => {} });
  budget.record('claude-sonnet-5-5', { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 2 } });
  assert.throws(() => budget.assertCanCall({ webSearch: true }), budgetLib.RunBudgetExceededError);
  assert.doesNotThrow(() => budget.assertCanCall());
});

test('records already generated are skipped without a call', async () => {
  const budget = budgetLib.createRunBudget({ log: () => {} });
  let calls = 0;
  const items = [{ id: 1, copy: 'done' }, { id: 2 }, { id: 3, copy: 'done' }];
  const out = await budgetLib.runWithBudget(items, async () => { calls++; budget.record('claude-haiku-5-5', { input_tokens: 1, output_tokens: 1 }); }, { budget, isDone: (r) => !!r.copy });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.skipped.length, 2);
});

function fakeHttps(calls, responseJson) {
  mock.method(https, 'request', (opts, cb) => {
    const req = new EventEmitter();
    let body = '';
    req.setTimeout = () => {};
    req.write = (d) => { body += d; };
    req.destroy = () => {};
    req.end = () => {
      calls.push({ opts, body: JSON.parse(body) });
      const res = new EventEmitter();
      cb(res);
      res.emit('data', JSON.stringify(responseJson));
      res.emit('end');
    };
    return req;
  });
}
function fakeCreds() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'llmcost-')), 'api-keys.json');
  fs.writeFileSync(p, JSON.stringify({ anthropic: { apiKey: 'fake-key' } }), { mode: 0o600 });
  process.env.OUTREACH_CREDENTIALS_PATH = p;
}
const PROD_TEXT = 'Subject: quick thought for the cutting room\nBody: Hi Sam,\n\nI noticed you have 20 reviews. From just \u00a339 I can help.\n\nSent from my iPhone';
const emailReply = { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: PROD_TEXT }], usage: { input_tokens: 900, output_tokens: 150 }, stop_reason: 'end_turn' };

test('email generator: defaults to Sonnet 5.5, no temperature, records usage, reuses stored copy', async () => {
  fakeCreds();
  const calls = [];
  fakeHttps(calls, emailReply);
  budgetLib.resetRunBudget();
  const gen = require('../shared/outreach-core/content-generation/claude-email-generator');
  const base = { businessName: 'The Cutting Room', ownerFirstName: 'Sam', category: 'hair salon', location: 'Bramhall', reviewCount: 20, rating: 4.5, website: 'https://x.test' };
  const r = await gen.generateEmailContent(base);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].body.model, 'claude-sonnet-5-5');
  assert.strictEqual(calls[0].body.temperature, undefined);
  assert.ok(calls[0].body.max_tokens <= 1000);
  assert.strictEqual(budgetLib.getRunBudget().snapshot().calls, 1);
  assert.strictEqual(r.subject, 'quick thought for the cutting room');
  assert.strictEqual(r.body, 'Hi Sam,\n\nI noticed you have 20 reviews. From just \u00a339 I can help.\n\nSent from my iPhone');
  const again = await gen.generateEmailContent({ ...base, existingEmail: { subject: r.subject, body: r.body } });
  assert.strictEqual(calls.length, 1, 'no second call');
  assert.strictEqual(again.metadata.reused, true);
});

test('email generator: OUTREACH_COPY_MODEL switches to Haiku for the A/B', async () => {
  fakeCreds();
  process.env.OUTREACH_COPY_MODEL = 'claude-haiku-5-5';
  const calls = [];
  fakeHttps(calls, emailReply);
  budgetLib.resetRunBudget();
  const gen = require('../shared/outreach-core/content-generation/claude-email-generator');
  await gen.generateEmailContent({ businessName: 'A', ownerFirstName: 'B', category: 'hair salon', location: 'Bramhall' });
  assert.strictEqual(calls[0].body.model, 'claude-haiku-5-5');
});

test('generator refuses a call once the run cap is hit', async () => {
  fakeCreds();
  process.env.OUTREACH_RUN_MAX_CALLS = '0';
  const calls = [];
  fakeHttps(calls, emailReply);
  budgetLib.resetRunBudget();
  const gen = require('../shared/outreach-core/content-generation/claude-email-generator');
  await assert.rejects(() => gen.generateEmailContent({ businessName: 'A', ownerFirstName: 'B', category: 'hair salon', location: 'Bramhall' }), budgetLib.RunBudgetExceededError);
  assert.strictEqual(calls.length, 0);
});

test('LinkedIn generators default to Sonnet 5.5 with no temperature and reuse stored text', async () => {
  fakeCreds();
  const calls = [];
  fakeHttps(calls, { content: [{ type: 'text', text: 'Hi Sam, nice work.' }], usage: { input_tokens: 300, output_tokens: 20 } });
  budgetLib.resetRunBudget();
  const li = require('../shared/outreach-core/content-generation/claude-linkedin-generator');
  const p = { businessName: 'A', ownerFirstName: 'Sam', category: 'hair salon', location: 'Bramhall', emailSubject: 's', emailBody: 'b' };
  assert.strictEqual(await li.generateConnectionNote(p), 'Hi Sam, nice work.');
  assert.strictEqual(await li.generateLinkedInMessage(p), 'Hi Sam, nice work.');
  assert.strictEqual(calls.length, 2);
  for (const c of calls) { assert.strictEqual(c.body.model, 'claude-sonnet-5-5'); assert.strictEqual(c.body.temperature, undefined); }
  assert.strictEqual(await li.generateConnectionNote({ ...p, existingText: 'stored' }), 'stored');
  assert.strictEqual(calls.length, 2);
});

test('revenue estimator is mechanical work: Haiku 5.5', async () => {
  fakeCreds();
  const calls = [];
  fakeHttps(calls, { content: [{ type: 'text', text: '{"estimatedRevenue":100000,"revenueBand":"£100k-500k","confidence":5,"reasoning":"x"}' }], usage: { input_tokens: 200, output_tokens: 50 } });
  budgetLib.resetRunBudget();
  const { estimateRevenue } = require('../ksd/local-outreach/orchestrator/modules/revenue-estimator');
  const r = await estimateRevenue({ name: 'A', category: 'plumber', address: 'Bramhall' });
  assert.strictEqual(r.estimatedRevenue, 100000);
  assert.strictEqual(calls[0].body.model, 'claude-haiku-5-5');
  assert.strictEqual(calls[0].body.temperature, undefined);
});
