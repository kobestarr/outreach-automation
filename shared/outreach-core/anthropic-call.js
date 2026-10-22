// One place that POSTs to the Anthropic Messages API for the https-based call sites:
// shapes the body for the model, enforces the run budget before the call and records real usage after it.
const https = require('https');
const { shapeBody, extractText } = require('./llm-models');
const { getRunBudget } = require('./llm-budget');

const HOST = 'api.anthropic.com';
const VERSION = '2023-06-01';

function callAnthropic({ apiKey, body, timeoutMs = 60000, budget = getRunBudget() }) {
  const webSearch = Array.isArray(body.tools) && body.tools.some((t) => /^web_search/.test(t.type || ''));
  budget.assertCanCall({ webSearch });
  const postData = JSON.stringify(shapeBody(body));
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: HOST, path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': VERSION, 'Content-Length': Buffer.byteLength(postData) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let result;
        try { result = JSON.parse(data); } catch (e) { return reject(new Error(`Failed to parse Anthropic response: ${e.message}`)); }
        if (result.error) return reject(new Error(`Anthropic API error: ${result.error.message}`));
        budget.record(body.model, result.usage);
        resolve({ text: extractText(result.content), usage: result.usage || {}, raw: result });
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Anthropic API request timeout after ${timeoutMs}ms`)); });
    req.on('error', (e) => reject(new Error(`Anthropic API request error: ${e.message}`)));
    req.write(postData);
    req.end();
  });
}

module.exports = { callAnthropic };
