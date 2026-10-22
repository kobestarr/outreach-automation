// Anthropic Messages API via plain fetch (no SDK). Endpoint, headers and body shape checked against
// https://platform.claude.com/docs/en/api/messages on 2026-10-18 (POST /v1/messages, x-api-key,
// anthropic-version 2023-06-01, required model + max_tokens + messages, system is top level,
// response content is an array of blocks: join the type "text" ones).
const os = require('os'), path = require('path');
const { shapeBody } = require('../llm-models');
const { createRunBudget, capFromEnv } = require('../llm-budget');
const { AnthropicStopError, AnthropicHttpError } = require('../anthropic-call');

// The reply engine has its own budget and its own daily ledger so batch work can never switch off reply
// classification (an unclassified opt-out is a do-not-contact risk).
let replyBudget = null;
function getReplyBudget() {
  if (!replyBudget) {
    const base = process.env.OUTREACH_LLM_LEDGER_DIR || path.join(__dirname, '..', '..', '..', 'data');
    replyBudget = createRunBudget({
      dayUsdCap: capFromEnv('OUTREACH_REPLY_DAY_USD_CAP', 1, { allowZero: true }),
      ledgerDir: path.join(base, 'reply-llm'),
    });
  }
  return replyBudget;
}

const MODELS = { classify: 'claude-haiku-5-5', draft: 'claude-sonnet-5-5' };

function makeAnthropicLlm({ apiKey, model, maxTokens = 800, fetchImpl = fetch, timeoutMs = 60_000, budget }) {
  if (!apiKey) throw new Error('No Anthropic key');
  return async function llm({ system, user }) {
    const b = budget || getReplyBudget();
    b.assertCanCall();
    let r;
    try {
      r = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(shapeBody({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) b.recordUnknown(model, maxTokens, 'timeout');
      throw e;
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new AnthropicHttpError(`Anthropic ${r.status}: ${String(t).slice(0, 200)}`, r.status, false);
    }
    const j = await r.json();
    b.record(model, j.usage);
    if (j.stop_reason === 'max_tokens' || j.stop_reason === 'refusal') throw new AnthropicStopError(j.stop_reason, model);
    return (j.content || []).filter(blk => blk.type === 'text').map(blk => blk.text).join('');
  };
}

// ~/.credentials/api-keys.json -> anthropic.apiKey (CLI wiring only; tests inject keys)
function loadAnthropicKey() {
  const creds = require(path.join(os.homedir(), '.credentials/api-keys.json'));
  const k = creds.anthropic && creds.anthropic.apiKey;
  if (!k) throw new Error('No anthropic.apiKey in ~/.credentials/api-keys.json');
  return k;
}

function resetReplyBudget() { replyBudget = null; }

module.exports = { MODELS, makeAnthropicLlm, loadAnthropicKey, getReplyBudget, resetReplyBudget };
