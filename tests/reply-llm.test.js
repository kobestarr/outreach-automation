// tests/reply-llm.test.js
const { test } = require('node:test');
const assert = require('node:assert');
process.env.OUTREACH_LLM_LEDGER_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'replyllm-'));
const { makeAnthropicLlm, MODELS } = require('../shared/outreach-core/replies/llm');

const okFetch = (calls, text = 'hello') => async (url, opts) => {
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text }, { type: 'text', text: ' more' }] }) };
};

test('models are the agreed ones', () => {
  assert.strictEqual(MODELS.classify, 'claude-haiku-5-5');
  assert.strictEqual(MODELS.draft, 'claude-sonnet-5-5');
});

test('posts to the Messages API with the right headers and joins text blocks', async () => {
  const calls = [];
  const llm = makeAnthropicLlm({ apiKey: 'k', model: MODELS.classify, fetchImpl: okFetch(calls) });
  const out = await llm({ system: 'sys', user: 'usr' });
  assert.strictEqual(out, 'hello more');
  assert.strictEqual(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(calls[0].opts.headers['x-api-key'], 'k');
  assert.strictEqual(calls[0].opts.headers['anthropic-version'], '2023-06-01');
  assert.deepStrictEqual(calls[0].body.messages, [{ role: 'user', content: 'usr' }]);
  assert.strictEqual(calls[0].body.system, 'sys');
  assert.strictEqual(calls[0].body.model, 'claude-haiku-5-5');
  assert.ok(calls[0].body.max_tokens > 0);
});

test('a failed call throws without leaking the key', async () => {
  const llm = makeAnthropicLlm({ apiKey: 'SECRETKEY', model: 'm', fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }) });
  await assert.rejects(() => llm({ system: 's', user: 'u' }), e => /429/.test(e.message) && !/SECRETKEY/.test(e.message));
});

test('no key means no model', () => {
  assert.throws(() => makeAnthropicLlm({ apiKey: '', model: 'm' }), /key/i);
});
