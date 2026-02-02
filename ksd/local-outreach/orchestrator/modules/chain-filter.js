/**
 * Chain Filter Module
 * Filters out UK chain businesses from Google Maps results
 */

const fs = require("fs");
const path = require("path");

const CHAINS_CONFIG_PATH = path.join(__dirname, "../config/uk-chains.json");

let cachedChains = null;
let cachedConfig = null;
let configLastModified = null;


/**
 * Load chain brands list
 */
function loadChainBrands() {
  if (cachedChains) return cachedChains;
  
  try {
    const stats = fs.statSync(CHAINS_CONFIG_PATH);
    if (configLastModified && stats.mtimeMs === configLastModified) {
      return cachedChains || [];
    }
    
    const data = fs.readFileSync(CHAINS_CONFIG_PATH, "utf8");
    const config = JSON.parse(data);
    cachedChains = config.chains || [];
    cachedConfig = config;
    configLastModified = stats.mtimeMs;
    return cachedChains;
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
  if (!cachedConfig) loadChainBrands();
    const config = cachedConfig || {};
  const signals = config.signals || {};
  
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
  if (!cachedConfig) loadChainBrands();
    const config = cachedConfig || {};
    const pubDomains = config.pubDomains || [
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
  isPub
};