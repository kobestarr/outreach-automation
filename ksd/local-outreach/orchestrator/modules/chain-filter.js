/**
 * Chain Filter Module
 * Filters out UK chain businesses from Google Maps results
 */

const fs = require("fs");
const path = require("path");

const CHAINS_CONFIG_PATH = path.join(__dirname, "../config/uk-chains.json");

/**
 * Load chain brands list
 */
function loadChainBrands() {
  try {
    const data = fs.readFileSync(CHAINS_CONFIG_PATH, "utf8");
    const config = JSON.parse(data);
    return config.chains || [];
  } catch (error) {
    console.warn("Failed to load chain brands config:", error.message);
    return [];
  }
}

/**
 * Check if business is a chain
 */
function isChain(business) {
  const businessName = (business.name || business.businessName || "").toLowerCase();
  const chains = loadChainBrands();
  
  // Check if name contains any chain brand
  const isChainBrand = chains.some(chain => businessName.includes(chain.toLowerCase()));
  
  // Check Google Maps signals
  const reviewCount = business.reviewCount || 0;
  const locationCount = business.locationCount || 1;
  const config = JSON.parse(fs.readFileSync(CHAINS_CONFIG_PATH, "utf8"));
  const signals = config.signals || {};
  
  const hasChainSignals = 
    reviewCount >= (signals.minReviewCount || 1000) ||
    locationCount >= (signals.minLocations || 2);
  
  return isChainBrand || hasChainSignals;
}

/**
 * Filter chains from business list
 */
function filterChains(businesses) {
  return businesses.filter(business => !isChain(business));
}

module.exports = {
  isChain,
  filterChains,
  loadChainBrands
};
