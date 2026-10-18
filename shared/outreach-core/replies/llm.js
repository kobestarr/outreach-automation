// Anthropic Messages API via plain fetch (no SDK). Endpoint, headers and body shape checked against
// https://platform.claude.com/docs/en/api/messages on 2026-10-18 (POST /v1/messages, x-api-key,
// anthropic-version 2023-06-01, required model + max_tokens + messages, system is top level,
// response content is an array of blocks: join the type "text" ones).
const os = require('os'), path = require('path');

const MODELS = { classify: 'claude-haiku-5-5', draft: 'claude-sonnet-5-5' };

function makeAnthropicLlm({ apiKey, model, maxTokens = 800, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!apiKey) throw new Error('No Anthropic key');
  return async function llm({ system, user }) {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`Anthropic ${r.status}: ${String(t).slice(0, 200)}`);
    }
    const j = await r.json();
    return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  };
}

// ~/.credentials/api-keys.json -> anthropic.apiKey (CLI wiring only; tests inject keys)
function loadAnthropicKey() {
  const creds = require(path.join(os.homedir(), '.credentials/api-keys.json'));
  const k = creds.anthropic && creds.anthropic.apiKey;
  if (!k) throw new Error('No anthropic.apiKey in ~/.credentials/api-keys.json');
  return k;
}

module.exports = { MODELS, makeAnthropicLlm, loadAnthropicKey };
