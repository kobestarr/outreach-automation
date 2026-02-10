/**
 * Email Merge Variables Generator
 * Generates dynamic merge variables for Lemlist email templates
 *
 * Handles:
 * - Proximity-based introductions (local vs UK-wide)
 * - Observation signals (business-specific hooks)
 * - Meeting options (in-person vs phone)
 * - Tiered pricing (tier1-tier5 with multipliers)
 */

const { computeObservationSignals, selectPrimarySignal } = require('./observation-signals');
const { getCurrencyForLocation } = require('./currency-localization');
const { getBusinessType } = require('./business-type-helper');
const logger = require('../logger');

/**
 * Nearby postcodes (within 45 minutes of Poynton SK12)
 * Used to determine if business is "local" for personalized intro
 */
const NEARBY_POSTCODES = [
  // Core Poynton area
  'SK12', // Poynton (base location)

  // Stockport & surrounding
  'SK7',  // Bramhall, Hazel Grove
  'SK6',  // High Lane, Disley
  'SK8',  // Cheadle
  'SK1',  // Stockport Central
  'SK2',  // Stockport South
  'SK3',  // Stockport East
  'SK4',  // Stockport West

  // Cheshire East & Peak District
  'SK9',  // Alderley Edge, Wilmslow
  'SK10', // Macclesfield
  'SK17', // Buxton
  'SK22', // New Mills, Hayfield
  'SK23', // Whaley Bridge, Chapel-en-le-Frith
  'WA14', // Altrincham
  'WA15', // Hale, Bowdon
  'WA16', // Knutsford

  // South Manchester
  'M20',  // Didsbury
  'M21',  // Chorlton
  'M22',  // Wythenshawe
  'M23',  // Baguley
  'M19',  // Levenshulme
  'M14',  // Fallowfield
  'M13',  // Ardwick, Longsight
];

/**
 * Tier-based pricing multipliers
 * Applied to base micro-offer price (£97, $127, etc.)
 */
const TIER_MULTIPLIERS = {
  tier1: 5,    // High revenue businesses → £485
  tier2: 3,    // Medium-high → £291
  tier3: 2,    // Medium → £194
  tier4: 1.5,  // Medium-low → £145
  tier5: 1     // Low revenue → £97
};

/**
 * Check if business is nearby (within 45 minutes)
 * @param {string} postcode - Business postcode (e.g., "SK7 1AB")
 * @returns {boolean} True if nearby
 */
function isNearby(postcode) {
  if (!postcode) return false;

  const postcodePrefix = postcode.substring(0, 3).toUpperCase().trim();
  return NEARBY_POSTCODES.includes(postcodePrefix);
}

/**
 * Get proximity-based introduction text
 * @param {string} postcode - Business postcode
 * @returns {string} Introduction text for email
 */
function getLocalIntro(postcode) {
  if (isNearby(postcode)) {
    return "I'm Kobi, a digital marketing consultant based in Poynton, so pretty close to you!";
  } else {
    return "I'm Kobi, a digital marketing consultant working with local businesses across the UK.";
  }
}

/**
 * Get observation signal for business
 * Converts technical signal into natural observation text
 *
 * @param {Object} business - Business data
 * @returns {string} Observation text for email
 */
function getObservationSignal(business) {
  const signals = computeObservationSignals(business);
  const primarySignal = selectPrimarySignal(signals);

  // Map signals to natural observations
  const observations = {
    lowReviews: "saw you're building up your online reputation",
    noWebsite: "noticed you don't have a website yet",
    poorWebsite: "thought your website could use a refresh",
    noSocialMedia: "saw you could use help with social media",
    lowRating: "noticed you could improve your online presence",
    highReviews: "saw you've built up a solid reputation online"
  };

  const observationText = observations[primarySignal] || "thought I'd reach out";

  logger.debug('email-merge-variables', 'Generated observation signal', {
    business: business.name,
    primarySignal,
    allSignals: signals,
    observationText
  });

  return observationText;
}

/**
 * Get meeting option based on proximity
 * @param {string} postcode - Business postcode
 * @returns {string} Meeting option text
 */
function getMeetingOption(postcode) {
  if (isNearby(postcode)) {
    return "meet in person if that's easier";
  } else {
    return "have a chat";
  }
}

/**
 * Calculate tiered micro-offer price
 * @param {Object} business - Business data with assignedOfferTier
 * @returns {string} Formatted price (e.g., "£291", "$635")
 */
function getMicroOfferPrice(business) {
  const tier = business.assignedOfferTier || 'tier5';
  const multiplier = TIER_MULTIPLIERS[tier];

  // Get currency and base price for location
  const currency = getCurrencyForLocation(business.location || 'UK');
  const basePrice = currency.microOffer; // 97 for UK, 127 for US, etc.

  // Calculate tiered price
  const finalPrice = Math.round(basePrice * multiplier);
  const formattedPrice = `${currency.symbol}${finalPrice}`;

  logger.debug('email-merge-variables', 'Calculated tiered pricing', {
    business: business.name,
    tier,
    multiplier,
    basePrice,
    finalPrice: formattedPrice,
    country: currency.country
  });

  return formattedPrice;
}

/**
 * Generate all merge variables for a business
 * @param {Object} business - Business data
 * @returns {Object} All merge variables for email template
 */
function getAllMergeVariables(business) {
  const postcode = business.postcode || '';

  const mergeVariables = {
    // Core business data
    firstName: business.ownerFirstName || 'there',
    lastName: business.ownerLastName || '',
    companyName: business.businessName || business.name,
    location: business.location || '',
    businessType: getBusinessType(business.category),

    // Dynamic variables
    localIntro: getLocalIntro(postcode),
    observationSignal: getObservationSignal(business),
    meetingOption: getMeetingOption(postcode),
    microOfferPrice: getMicroOfferPrice(business),

    // Additional context
    isNearby: isNearby(postcode),
    tier: business.assignedOfferTier || 'tier5',
    postcode: postcode
  };

  logger.info('email-merge-variables', 'Generated merge variables', {
    business: business.name,
    isNearby: mergeVariables.isNearby,
    tier: mergeVariables.tier,
    microOfferPrice: mergeVariables.microOfferPrice
  });

  return mergeVariables;
}

/**
 * Add nearby postcode to the list
 * Useful for expanding coverage area
 * @param {string} postcode - Postcode prefix to add (e.g., "M24")
 */
function addNearbyPostcode(postcode) {
  const prefix = postcode.substring(0, 3).toUpperCase().trim();
  if (!NEARBY_POSTCODES.includes(prefix)) {
    NEARBY_POSTCODES.push(prefix);
    logger.info('email-merge-variables', 'Added nearby postcode', { postcode: prefix });
  }
}

/**
 * Get list of nearby postcodes
 * @returns {Array<string>} Array of postcode prefixes
 */
function getNearbyPostcodes() {
  return [...NEARBY_POSTCODES];
}

module.exports = {
  // Main functions
  getAllMergeVariables,
  getLocalIntro,
  getObservationSignal,
  getMeetingOption,
  getMicroOfferPrice,

  // Helper functions
  isNearby,
  addNearbyPostcode,
  getNearbyPostcodes,

  // Constants (for testing/config)
  NEARBY_POSTCODES,
  TIER_MULTIPLIERS
};
