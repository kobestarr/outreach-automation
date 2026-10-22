// One place that POSTs to the Anthropic Messages API for the https-based call sites:
// shapes the body for the model, enforces the run and daily budget before the call, retries transient failures
// and records real usage after it. Truncated or refused answers are errors, never returned as if complete.
const https = require('https');
const { shapeBody, extractText } = require('./llm-models');
const { getRunBudget } = require('./llm-budget');
const logger = require('./logger');

const HOST = 'api.anthropic.com';
const VERSION = '2023-06-01';
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 529]);
const RETRY_NET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);
const MAX_RETRIES = 2;

class AnthropicStopError extends Error {
  constructor(stopReason, model) {
    super(stopReason === 'max_tokens'
      ? `Anthropic ${model} stopped at max_tokens: the answer is cut off`
      : `Anthropic ${model} returned stop_reason "${stopReason}" with no usable answer`);
    this.name = 'AnthropicStopError';
    this.stopReason = stopReason;
  }
}

class AnthropicHttpError extends Error {
  constructor(message, statusCode, retryable) {
    super(message);
    this.name = 'AnthropicHttpError';
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt) => Math.round(500 * 2 ** attempt * (0.5 + Math.random()));

function once({ apiKey, postData, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = https.request({
      hostname: HOST, path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': VERSION, 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const status = res.statusCode;
        let result;
        try { result = JSON.parse(data); }
        catch (e) { return done(reject, new AnthropicHttpError(`Anthropic returned a non-JSON body (HTTP ${status}): ${e.message}`, status, RETRY_STATUSES.has(status))); }
        if (result.error || (status && status >= 400)) {
          const msg = (result.error && result.error.message) || 'unknown error';
          return done(reject, new AnthropicHttpError(`Anthropic API error (HTTP ${status}): ${msg}`, status, RETRY_STATUSES.has(status)));
        }
        done(resolve, result);
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      const e = new AnthropicHttpError(`Anthropic API request timeout after ${timeoutMs}ms`, null, false);
      e.timedOut = true;
      done(reject, e);
    });
    req.on('error', (e) => {
      const err = new AnthropicHttpError(e.code === 'ECONNRESET'
        ? 'Anthropic API connection reset - request may have timed out'
        : `Anthropic API request error: ${e.message}`, null, RETRY_NET_CODES.has(e.code));
      err.netError = true;
      done(reject, err);
    });
    req.write(postData);
    req.end();
  });
}

async function callAnthropic({ apiKey, body, timeoutMs = 60000, budget = getRunBudget(), sleep = defaultSleep }) {
  const webSearch = Array.isArray(body.tools) && body.tools.some((t) => /^web_search/.test(t.type || ''));
  budget.assertCanCall({ webSearch });
  const shaped = shapeBody(body);
  const postData = JSON.stringify(shaped);

  let result;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await once({ apiKey, postData, timeoutMs });
      break;
    } catch (err) {
      if (err.timedOut || err.netError) {
        budget.recordUnknown(body.model, shaped.max_tokens, err.timedOut ? 'timeout' : 'connection error');
      }
      if (err.retryable && attempt < MAX_RETRIES) {
        logger.warn('anthropic-call', `Retrying after ${err.statusCode || err.message} (attempt ${attempt + 1} of ${MAX_RETRIES})`);
        await sleep(backoffMs(attempt));
        budget.assertCanCall({ webSearch });
        continue;
      }
      throw err;
    }
  }

  budget.record(body.model, result.usage);
  const text = extractText(result.content);
  if (result.stop_reason === 'max_tokens' || result.stop_reason === 'refusal') {
    throw new AnthropicStopError(result.stop_reason, body.model);
  }
  return { text, usage: result.usage || {}, raw: result };
}

module.exports = { callAnthropic, AnthropicStopError, AnthropicHttpError };
