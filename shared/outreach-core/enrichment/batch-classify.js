// Classify records in batches and fail CLOSED: a record the model did not clearly answer for is held back,
// never put on a send list. A budget stop ends the run with one loud line and holds everything not yet classified.
const { RunBudgetExceededError } = require('../llm-budget');

async function classifyInBatches(names, classifyBatch, { batchSize = 80, log = console.error, describe = (n) => ({ name: n }) } = {}) {
  const decided = new Map();
  const held = [];
  let stopped = null;

  for (let i = 0; i < names.length; i += batchSize) {
    const chunk = names.slice(i, i + batchSize);
    if (stopped) { held.push(...chunk); continue; }
    let out;
    try {
      out = await classifyBatch(chunk.map(describe));
    } catch (e) {
      held.push(...chunk);
      if (e instanceof RunBudgetExceededError) {
        stopped = e.reason;
        log(`BUDGET CAP HIT (${e.reason}) while classifying: ${names.length - i} of ${names.length} names not classified and held back. ${e.message}`);
      } else {
        log(`batch @${i} failed (${e.message}); ${chunk.length} names held back, not kept`);
      }
      continue;
    }
    const answered = new Set();
    for (const o of Array.isArray(out) ? out : []) {
      if (o && typeof o.full === 'string' && typeof o.keep === 'boolean') {
        decided.set(o.full, { short: o.short || o.full, keep: o.keep });
        answered.add(o.full);
      }
    }
    for (const n of chunk) if (!answered.has(n)) held.push(n);
  }
  return { decided, held, stopped };
}

module.exports = { classifyInBatches };
