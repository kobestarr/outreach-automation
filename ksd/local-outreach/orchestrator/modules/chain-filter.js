/**
 * Chain Filter Module
 * Filters out UK chain businesses from Google Maps results
 */

const fs = require("fs");
const path = require("path");
const logger = require("../../../../shared/outreach-core/logger");

const CHAINS_CONFIG_PATH = path.join(__dirname, "../config/uk-chains.json");

// Module-level cache for chain config
let cachedChains = null;
let cachedSignals = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load chain brands list with caching
 */
function loadChainBrands() {
  // Return cached data if valid
  if (cachedChains && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedChains;
  }

  try {
    const data = fs.readFileSync(CHAINS_CONFIG_PATH, "utf8");
    const config = JSON.parse(data);
    
    // Update cache
    cachedChains = config.chains || [];
    cachedSignals = config.signals || {};
    cacheTimestamp = Date.now();
    
    return cachedChains;
  } catch (error) {
    logger.warn('chain-filter', 'Failed to load chain brands config', { error: error.message });
    return [];
  }
}

/**
 * Load chain signals with caching
 */
function loadChainSignals() {
  // Return cached data if valid
  if (cachedSignals && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL_MS)) {
    return cachedSignals;
  }

  try {
    const data = fs.readFileSync(CHAINS_CONFIG_PATH, "utf8");
    const config = JSON.parse(data);
    
    // Update cache
    cachedChains = config.chains || [];
    cachedSignals = config.signals || {};
    cacheTimestamp = Date.now();
    
    return cachedSignals;
  } catch (error) {
    logger.warn('chain-filter', 'Failed to load chain signals config', { error: error.message });
    return {};
  }
}

/**
 * Clear the cache (useful for testing or config reloads)
 */
function clearCache() {
  cachedChains = null;
  cachedSignals = null;
  cacheTimestamp = null;
  logger.debug('chain-filter', 'Cache cleared');
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
  const signals = loadChainSignals();
  
  const hasChainSignals = 
    reviewCount >= (signals.minReviewCount || 1000) ||
    locationCount >= (signals.minLocations || 2);
  
  return isChainBrand || hasChainSignals;
}

/**
 * Filter chains from business list
 */

/**
 * Check if business is a pub
 */
function isPub(business) {
  const businessName = (business.name || business.businessName || "").toLowerCase();
  const website = (business.website || "").toLowerCase();
  const address = (business.address || "").toLowerCase();
  
  // Check for pub keywords in name
  const pubKeywords = ["pub", "tavern", "inn", "bar", "alehouse", "public house"];
  const hasPubKeyword = pubKeywords.some(keyword => 
    businessName.includes(keyword) || address.includes(keyword)
  );
  
  // Check for pub-related domains
  const pubDomains = [
    "greeneking.co.uk",
    "robinsonsbrewery.com",
    "pubs",
    "brewery",
    "alehouse"
  ];
  const hasPubDomain = pubDomains.some(domain => website.includes(domain));
  
  return hasPubKeyword || hasPubDomain;
}

function filterChains(businesses) {
  return businesses.filter(business => !isChain(business) && !isPub(business));
}



module.exports = {
  isChain,
  filterChains,
  loadChainBrands,
  isPub,
  clearCache
};
