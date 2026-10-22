// Per-run spend guard shared by every Anthropic call site.
// Prices per million tokens from https://platform.claude.com/docs/en/about-claude/pricing and the model pages,
// fetched 2026-10-22. Web search: $10 per 1,000 searches.
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const PRICES = [
  { match: /^claude-sonnet-5-5/, in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  { match: /^claude-haiku-5-5/, in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125, longAbove: 100_000, longIn: 0.5, longOut: 2.5, longCacheRead: 0.05, longCacheWrite: 0.625 },
  { match: /^claude-sonnet-4-5/, in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: /^claude-haiku-4-5/, in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
];
// An unpriced model is charged at the dearest known rate so the cap errs on the safe side (Opus 5.5 is $4/$20 and
// Fable 5.1 is $10/$50, both dearer than anything in the table).
const UNKNOWN_MODEL_PRICE = PRICES.reduce((a, b) => (b.out > a.out ? b : a));
const warnedUnknown = new Set();
const SEARCH_USD = 0.01;

function priceFor(model) {
  const p = PRICES.find((x) => x.match.test(model));
  if (p) return p;
  if (!warnedUnknown.has(model)) {
    warnedUnknown.add(model);
    logger.warn('llm-budget', `No price for model ${model}: charging it at the dearest known rate. Add it to PRICES.`);
  }
  return UNKNOWN_MODEL_PRICE;
}

function costOf(model, usage = {}) {
  const p = priceFor(model);
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

// A cap that is not a usable number must not silently become "no cap".
function capFromEnv(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (Number.isFinite(v) && (allowZero ? v >= 0 : v > 0)) return v;
  logger.warn('llm-budget', `${name}="${raw}" is not a valid number, using the default ${fallback}`);
  return fallback;
}

const today = () => new Date().toISOString().slice(0, 10);

// Cross-process daily spend: one small JSON file per UTC day, re-read on every check and written atomically
// (temp file then rename). Two processes finishing at the same moment can lose one update, which is an accepted
// error for a safety net. Ledger problems are logged loudly and never crash the run.
function createLedger(dir) {
  const file = () => path.join(dir, `llm-spend-${today()}.json`);
  let warned = false;
  const warn = (e) => { if (!warned) { warned = true; logger.error('llm-budget', `Daily spend ledger unavailable (${e.message}); the daily cap is NOT being enforced`); } };
  return {
    total() {
      try { return Number(JSON.parse(fs.readFileSync(file(), 'utf8')).usd) || 0; }
      catch (e) { if (e.code !== 'ENOENT') warn(e); return 0; }
    },
    add(usd) {
      if (!(usd > 0)) return;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${file()}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ date: today(), usd: this.total() + usd }));
        fs.renameSync(tmp, file());
      } catch (e) { warn(e); }
    },
  };
}

const DEFAULT_LEDGER_DIR = path.join(__dirname, '..', '..', 'data');

function createRunBudget(opts = {}) {
  const usdCap = opts.usdCap ?? capFromEnv('OUTREACH_RUN_USD_CAP', 1.5);
  const maxCalls = opts.maxCalls ?? capFromEnv('OUTREACH_RUN_MAX_CALLS', 400, { allowZero: true });
  const maxSearches = opts.maxSearches ?? capFromEnv('OUTREACH_RUN_MAX_SEARCHES', 30, { allowZero: true });
  const dayUsdCap = opts.dayUsdCap ?? capFromEnv('OUTREACH_DAY_USD_CAP', 3);
  const ledger = opts.ledger === false ? null : createLedger(opts.ledgerDir || process.env.OUTREACH_LLM_LEDGER_DIR || DEFAULT_LEDGER_DIR);
  const log = opts.log || ((m) => logger.error('llm-budget', m));
  const state = { usd: 0, calls: 0, searches: 0, byModel: {}, unknownCalls: 0 };

  const snapshot = () => ({ ...state, byModel: { ...state.byModel }, usdCap, maxCalls, maxSearches, dayUsdCap, dayUsd: ledger ? ledger.total() : null });
  const limitReason = ({ webSearch = false } = {}) => {
    if (state.calls >= maxCalls) return 'max_calls';
    if (state.usd >= usdCap) return 'usd_cap';
    if (ledger && ledger.total() >= dayUsdCap) return 'day_cap';
    if (webSearch && state.searches >= maxSearches) return 'max_searches';
    return null;
  };
  const book = (model, c, searches) => {
    state.usd += c;
    state.calls += 1;
    state.searches += searches;
    state.byModel[model] = (state.byModel[model] || 0) + c;
    if (ledger) ledger.add(c);
    return c;
  };

  return {
    usdCap, maxCalls, maxSearches, dayUsdCap, log,
    snapshot,
    limitReason,
    assertCanCall(o) {
      const reason = limitReason(o);
      if (reason) throw new RunBudgetExceededError(reason, snapshot());
    },
    record(model, usage = {}) {
      return book(model, costOf(model, usage), (usage.server_tool_use && usage.server_tool_use.web_search_requests) || 0);
    },
    // A request that timed out or was cut off may still have been billed: count it, charge the worst case for output.
    recordUnknown(model, maxTokens, reason) {
      state.unknownCalls += 1;
      const c = costOf(model, { output_tokens: maxTokens || 0 });
      log(`Usage unknown for a ${model} call (${reason}); charging the worst case $${c.toFixed(4)} against the caps`);
      return book(model, c, 0);
    },
    summary() {
      const s = snapshot();
      const models = Object.entries(s.byModel).map(([m, v]) => `${m} $${v.toFixed(4)}`).join(', ') || 'none';
      const day = s.dayUsd === null ? '' : `, day $${s.dayUsd.toFixed(4)} of $${dayUsdCap}`;
      return `$${s.usd.toFixed(4)} of $${usdCap} run cap, ${s.calls} of ${maxCalls} calls, ${s.searches} searches${day} (${models})`;
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
    budget.log(`BUDGET CAP HIT (${reason}) in ${label}: stopped with ${remaining.length} of ${items.length} records not processed. ${budget.summary()}. Raise OUTREACH_RUN_USD_CAP / OUTREACH_RUN_MAX_CALLS / OUTREACH_DAY_USD_CAP to continue; finished records are kept.`);
  }
  return { results, skipped, failed, remaining, stopped, reason };
}

function webSearchTool({ maxUses } = {}) {
  return { type: 'web_search_20250305', name: 'web_search', max_uses: maxUses ?? num(process.env.OUTREACH_WEB_SEARCH_MAX_USES, 3) };
}

module.exports = { PRICES, priceFor, costOf, RunBudgetExceededError, createRunBudget, getRunBudget, resetRunBudget, runWithBudget, webSearchTool };
