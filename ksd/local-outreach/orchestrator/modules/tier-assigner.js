/**
 * Tier Assignment Module
 * Assigns business to appropriate tier based on revenue
 */

const fs = require("fs");
const path = require("path");

const TIER_CONFIG_PATH = path.join(__dirname, "../config/tier-config.json");

/**
 * Load tier configuration
 */
function loadTierConfig() {
  try {
    const data = fs.readFileSync(TIER_CONFIG_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Failed to load tier config: ${error.message}`);
  }
}

/**
 * Assign tier based on revenue
 */
function assignTier(revenue) {
  const config = loadTierConfig();
  const tiers = config.tiers;
  
  // Find matching tier
  for (const [tierId, tier] of Object.entries(tiers)) {
    const [min, max] = tier.revenueRange;
    if (revenue >= min && revenue < max) {
      return {
        tierId: tierId,
        tierName: tier.name,
        setupFee: tier.setupFee,
        monthlyPrice: tier.monthlyPrice,
        ghlOffer: tier.ghlOffer,
        leadMagnet: tier.leadMagnet,
        personalBrand: tier.personalBrand || false,
        businessGrowth: tier.businessGrowth || false
      };
    }
  }
  
  // Default to Tier 1 if no match
  const tier1 = tiers.tier1;
  return {
    tierId: "tier1",
    tierName: tier1.name,
    setupFee: tier1.setupFee,
    monthlyPrice: tier1.monthlyPrice,
    ghlOffer: tier1.ghlOffer,
    leadMagnet: tier1.leadMagnet
  };
}

module.exports = {
  assignTier,
  loadTierConfig
};
