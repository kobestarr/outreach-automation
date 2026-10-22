// Revenue estimate and tier for each lead, failing closed.
//   success                          -> priced
//   budget stop                      -> this lead and the rest are held
//   parse error / truncated answer   -> lowest tier, counted as "defaulted" (a single lead, defensible)
//   anything else (401, 400, 5xx after retries, unknown) -> that lead is held
//   3 failures in a row, or more than 20% of the list failed (checked from the 5th lead) -> the rest is held
// Held leads are removed from the list so nothing downstream can send them; the caller decides where to keep them.
const { RunBudgetExceededError, getRunBudget } = require('../llm-budget');

const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_FAILED_SHARE = 0.2;
const MIN_LEADS_FOR_SHARE_RULE = 5;
const DEFAULT_PRICING = { assignedOfferTier: 'tier1', estimatedRevenue: 80000, revenueBand: 'under-150k', revenueConfidence: 'low' };

const isDefaultable = (err) => err.name === 'AnthropicStopError' || err instanceof SyntaxError || /^Failed to parse revenue estimate/.test(err.message || '');

function holdOnBudgetStop(err, list, index, { step, log = console.error } = {}) {
  if (!(err instanceof RunBudgetExceededError)) return null;
  const held = list.splice(index);
  log(`BUDGET CAP HIT (${err.reason}) in ${step}: ${held.length} of ${index + held.length} leads held back, not priced and not sent. ${getRunBudget().summary()}`);
  return held;
}

async function priceLeads(businesses, { estimateRevenue, assignTier, log = console.log, logError = console.error, labelOf = (b, i, n) => `[${i + 1}/${n}] ${b.name || ''}`, onEstimated = () => {} }) {
  const items = businesses.slice();
  const kept = [], held = [], defaulted = [];
  let consecutive = 0, failed = 0, stopped = null;

  for (let i = 0; i < items.length; i++) {
    const business = items[i];
    if (stopped) { held.push(business); continue; }
    const label = labelOf(business, i, items.length);
    try {
      const revenueEstimate = await estimateRevenue(business);
      business.estimatedRevenue = revenueEstimate.estimatedRevenue;
      business.revenueBand = revenueEstimate.revenueBand;
      business.revenueConfidence = revenueEstimate.confidence;
      const tier = assignTier(business.estimatedRevenue);
      business.assignedOfferTier = tier.tierId;
      business.setupFee = tier.setupFee;
      business.monthlyPrice = tier.monthlyPrice;
      onEstimated(business, tier);
      kept.push(business);
      consecutive = 0;
      log(`  ${label} ${business.revenueBand} -> ${tier.tierId}`);
    } catch (err) {
      if (err instanceof RunBudgetExceededError) {
        stopped = err.reason;
        held.push(business);
        continue;
      }
      failed++; consecutive++;
      if (isDefaultable(err)) {
        Object.assign(business, DEFAULT_PRICING);
        defaulted.push(business);
        kept.push(business);
        log(`  ${label} (defaulted to tier1 - ${String(err.message).substring(0, 60)})`);
      } else {
        held.push(business);
        logError(`  ${label} HELD, not priced (${String(err.message).substring(0, 80)})`);
      }
      if (consecutive >= MAX_CONSECUTIVE_FAILURES || (i + 1 >= MIN_LEADS_FOR_SHARE_RULE && failed / items.length > MAX_FAILED_SHARE)) {
        stopped = 'circuit_breaker';
      }
    }
  }

  businesses.length = 0;
  businesses.push(...kept);
  if (stopped === 'circuit_breaker') {
    logError(`PRICING STOPPED (circuit breaker: ${MAX_CONSECUTIVE_FAILURES} failures in a row or over ${MAX_FAILED_SHARE * 100}% of the list failed): ${held.length} of ${items.length} leads held back, not priced and not sent.`);
  } else if (stopped) {
    logError(`BUDGET CAP HIT (${stopped}) in revenue estimation: ${held.length} of ${items.length} leads held back, not priced and not sent. ${getRunBudget().summary()}`);
  }
  log(`Pricing: ${kept.length - defaulted.length} priced, ${defaulted.length} defaulted to tier1, ${held.length} held back, of ${items.length}`);
  return { held, defaulted, stopped };
}

module.exports = { priceLeads, holdOnBudgetStop };
