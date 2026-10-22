// Per-run spend guard shared by every Anthropic call site.
// Prices per million tokens from https://platform.claude.com/docs/en/about-claude/pricing and the model pages,
// fetched 2026-10-22. Web search: $10 per 1,000 searches. claude-haiku-4-5 ($1 / $5) is from memory, not re-fetched.
const logger = require('./logger');

const PRICES = [
  { match: /^claude-sonnet-5-5/, in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  { match: /^claude-haiku-5-5/, in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longAbove: 100_000, longIn: 0.5, longOut: 2.5, longCacheRead: 0.05, longCacheWrite: 0.625 },
  { match: /^claude-sonnet-4-5/, in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /^claude-haiku-4-5/, in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
];
const UNKNOWN_MODEL_PRICE = PRICES[2];
const SEARCH_USD = 0.01;

function costOf(model, usage = {}) {
  const p = PRICES.find((x) => x.match.test(model)) || UNKNOWN_MODEL_PRICE;
  const input = usage.input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const long = p.longAbove && input + cr + cw > p.longAbove;
  const rIn = long ? p.longIn : p.in;
  const rOut = long ? p.longOut : p.out;
  const rCr = long ? p.longCacheRead : p.cacheRead;
  const rCw = long ? p.longCacheWrite : p.cacheWrite;
  const searches = (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
  return (input * rIn + (usage.output_tokens || 0) * rOut + cr * rCr + cw * rCw) / 1e6 + searches * SEARCH_USD;
}

class RunBudgetExceededError extends Error {
  constructor(reason, snapshot) {
    super(`Outreach run budget reached (${reason}): $${snapshot.usd.toFixed(4)} spent over ${snapshot.calls} calls, ${snapshot.searches} searches`);
    this.name = 'RunBudgetExceededError';
    this.reason = reason;
    this.snapshot = snapshot;
  }
}

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

function createRunBudget(opts = {}) {
  const usdCap = opts.usdCap ?? num(process.env.OUTREACH_RUN_USD_CAP, 1.5);
  const maxCalls = opts.maxCalls ?? num(process.env.OUTREACH_RUN_MAX_CALLS, 400);
  const maxSearches = opts.maxSearches ?? num(process.env.OUTREACH_RUN_MAX_SEARCHES, 30);
  const log = opts.log || ((m) => logger.error('llm-budget', m));
  const state = { usd: 0, calls: 0, searches: 0, byModel: {} };

  const snapshot = () => ({ ...state, byModel: { ...state.byModel }, usdCap, maxCalls, maxSearches });
  const limitReason = ({ webSearch = false } = {}) => {
    if (state.calls >= maxCalls) return 'max_calls';
    if (state.usd >= usdCap) return 'usd_cap';
    if (webSearch && state.searches >= maxSearches) return 'max_searches';
    return null;
  };

  return {
    usdCap, maxCalls, maxSearches, log,
    snapshot,
    limitReason,
    assertCanCall(o) {
      const reason = limitReason(o);
      if (reason) throw new RunBudgetExceededError(reason, snapshot());
    },
    record(model, usage = {}) {
      const c = costOf(model, usage);
      state.usd += c;
      state.calls += 1;
      state.searches += (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0;
      state.byModel[model] = (state.byModel[model] || 0) + c;
      return c;
    },
    summary() {
      const s = snapshot();
      const models = Object.entries(s.byModel).map(([m, v]) => `${m} $${v.toFixed(4)}`).join(', ') || 'none';
      return `$${s.usd.toFixed(4)} of $${usdCap} cap, ${s.calls} of ${maxCalls} calls, ${s.searches} searches (${models})`;
    },
  };
}

let shared = null;
function getRunBudget() { return shared || (shared = createRunBudget()); }
function resetRunBudget() { shared = null; }

// Runs worker over items, stopping cleanly when the budget trips. Items for which isDone(item) is true are
// skipped without a call. Returns what finished plus every record left so the run can be resumed.
async function runWithBudget(items, worker, { budget = getRunBudget(), isDone = () => false, label = 'run' } = {}) {
  const results = [], skipped = [], failed = [];
  let stopped = false, reason = null, i = 0;
  for (; i < items.length; i++) {
    const item = items[i];
    if (isDone(item)) { skipped.push(item); continue; }
    reason = budget.limitReason();
    if (reason) { stopped = true; break; }
    try {
      results.push(await worker(item));
    } catch (err) {
      if (err instanceof RunBudgetExceededError) { stopped = true; reason = err.reason; break; }
      failed.push({ item, error: err.message });
    }
  }
  const remaining = stopped ? items.slice(i).filter((x) => !isDone(x)) : [];
  if (stopped) {
    budget.log(`BUDGET CAP HIT (${reason}) in ${label}: stopped with ${remaining.length} of ${items.length} records not processed. ${budget.summary()}. Raise OUTREACH_RUN_USD_CAP / OUTREACH_RUN_MAX_CALLS to continue; finished records are kept.`);
  }
  return { results, skipped, failed, remaining, stopped, reason };
}

function webSearchTool({ maxUses } = {}) {
  return { type: 'web_search_20250305', name: 'web_search', max_uses: maxUses ?? num(process.env.OUTREACH_WEB_SEARCH_MAX_USES, 3) };
}

module.exports = { PRICES, costOf, RunBudgetExceededError, createRunBudget, getRunBudget, resetRunBudget, runWithBudget, webSearchTool };
