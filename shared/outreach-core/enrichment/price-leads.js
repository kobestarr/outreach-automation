// Revenue estimate and tier for each lead. A budget stop never defaults a tier: the leads not yet priced are
// removed from the list so nothing downstream can send them.
const { RunBudgetExceededError, getRunBudget } = require('../llm-budget');

function holdOnBudgetStop(err, list, index, { step, log = console.error } = {}) {
  if (!(err instanceof RunBudgetExceededError)) return null;
  const held = list.splice(index);
  log(`BUDGET CAP HIT (${err.reason}) in ${step}: ${held.length} of ${index + held.length} leads held back, not priced and not sent. ${getRunBudget().summary()}`);
  return held;
}

async function priceLeads(businesses, { estimateRevenue, assignTier, log = console.log, logError = console.error, labelOf = (b, i, n) => `[${i + 1}/${n}] ${b.name || ''}`, onEstimated = () => {} }) {
  let held = [];
  for (let i = 0; i < businesses.length; i++) {
    const business = businesses[i];
    const label = labelOf(business, i, businesses.length);
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
      log(`  ${label} ${business.revenueBand} -> ${tier.tierId}`);
    } catch (err) {
      const h = holdOnBudgetStop(err, businesses, i, { step: 'revenue estimation', log: logError });
      if (h) { held = h; break; }
      business.assignedOfferTier = 'tier1';
      business.estimatedRevenue = 80000;
      business.revenueBand = 'under-150k';
      business.revenueConfidence = 'low';
      log(`  ${label} (default tier1 - ${String(err.message).substring(0, 40)})`);
    }
  }
  return { held };
}

module.exports = { priceLeads, holdOnBudgetStop };
