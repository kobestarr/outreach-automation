/**
 * Currency Localization Module
 * Provides currency-specific pricing for micro-offers by country
 */

// Currency mapping with micro-offer and full-offer pricing
const CURRENCY_MAP = {
  UK: {
    country: "UK",
    currency: "GBP",
    symbol: "£",
    microOffer: 97,
    fullOffer: 497
  },
  US: {
    country: "US",
    currency: "USD",
    symbol: "$",
    microOffer: 127,
    fullOffer: 597
  },
  AU: {
    country: "AU",
    currency: "AUD",
    symbol: "A$",
    microOffer: 147,
    fullOffer: 697
  },
  CA: {
    country: "CA",
    currency: "CAD",
    symbol: "CA$",
    microOffer: 127,
    fullOffer: 597
  },
  NZ: {
    country: "NZ",
    currency: "NZD",
    symbol: "NZ$",
    microOffer: 147,
    fullOffer: 697
  },
  EU: {
    country: "EU",
    currency: "EUR",
    symbol: "€",
    microOffer: 97,
    fullOffer: 497
  }
};

/**
 * Detect country from location string
 * Uses heuristics to determine likely country from address/location text
 *
 * @param {string} location - Location string (e.g. "Bramhall, SK7", "123 Main St, New York")
 * @returns {string} Country code (UK, US, AU, CA, NZ, EU)
 */
function detectCountryFromLocation(location) {
  if (!location || typeof location !== 'string') return "UK"; // Default to UK

  const locationLower = location.toLowerCase();

  // UK: Check for postcode patterns (e.g. SK7, M1, SW1A, etc.)
  // UK postcodes: 1-2 letters, 1-2 digits, optional space, digit, 2 letters
  if (/\b[A-Z]{1,2}\d{1,2}\s?\d?[A-Z]{0,2}\b/i.test(location)) {
    return "UK";
  }

  // UK: Common UK place indicators
  if (locationLower.includes("uk") ||
      locationLower.includes("united kingdom") ||
      locationLower.includes("england") ||
      locationLower.includes("scotland") ||
      locationLower.includes("wales") ||
      locationLower.includes("northern ireland")) {
    return "UK";
  }

  // US: Check for state abbreviations (2 capital letters)
  // Look for patterns like "NY", "CA", "TX" etc in context
  const usStatePattern = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/;
  if (usStatePattern.test(location)) {
    return "US";
  }

  // US: Common US indicators
  if (locationLower.includes("usa") ||
      locationLower.includes("united states") ||
      locationLower.includes("america")) {
    return "US";
  }

  // US: ZIP code pattern (5 digits or 5+4 format)
  if (/\b\d{5}(?:-\d{4})?\b/.test(location)) {
    return "US";
  }

  // Australia
  if (locationLower.includes("australia") ||
      locationLower.includes(" nsw") ||
      locationLower.includes(" vic") ||
      locationLower.includes(" qld") ||
      locationLower.includes(" wa") ||
      locationLower.includes(" sa") ||
      locationLower.includes("sydney") ||
      locationLower.includes("melbourne") ||
      locationLower.includes("brisbane") ||
      locationLower.includes("perth")) {
    return "AU";
  }

  // Canada
  if (locationLower.includes("canada") ||
      locationLower.includes("toronto") ||
      locationLower.includes("vancouver") ||
      locationLower.includes("montreal") ||
      locationLower.includes("calgary") ||
      locationLower.includes(" on") || // Ontario
      locationLower.includes(" bc") || // British Columbia
      locationLower.includes(" ab") || // Alberta
      locationLower.includes(" qc")) { // Quebec
    return "CA";
  }

  // New Zealand
  if (locationLower.includes("new zealand") ||
      locationLower.includes("auckland") ||
      locationLower.includes("wellington") ||
      locationLower.includes("christchurch")) {
    return "NZ";
  }

  // Europe (various countries)
  const europeanCountries = [
    "france", "germany", "spain", "italy", "netherlands", "belgium",
    "ireland", "portugal", "austria", "denmark", "sweden", "finland",
    "poland", "czech", "greece", "norway"
  ];

  if (europeanCountries.some(country => locationLower.includes(country))) {
    return "EU";
  }

  // Default to UK if no match (most common use case for this system)
  return "UK";
}

/**
 * Get currency information for a location
 * Accepts optional country override to skip detection
 *
 * @param {string} location - Location string
 * @param {string} [country] - Optional country code override (UK, US, AU, etc.)
 * @returns {Object} Currency object with symbol, microOffer, fullOffer, etc.
 */
function getCurrencyForLocation(location, country = null) {
  // Use provided country or detect from location
  const detectedCountry = country || detectCountryFromLocation(location);

  // Return currency object, defaulting to UK if country not found
  return CURRENCY_MAP[detectedCountry] || CURRENCY_MAP.UK;
}

/**
 * Format price with currency symbol
 * Helper function for displaying prices consistently
 *
 * @param {number} amount - Price amount
 * @param {Object} currency - Currency object from getCurrencyForLocation()
 * @returns {string} Formatted price (e.g. "£97", "$127")
 */
function formatPrice(amount, currency) {
  return `${currency.symbol}${amount}`;
}

/**
 * Get all available country codes
 * Useful for testing/documentation
 *
 * @returns {Array<string>} Array of country codes
 */
function getAvailableCountries() {
  return Object.keys(CURRENCY_MAP);
}

module.exports = {
  CURRENCY_MAP,
  detectCountryFromLocation,
  getCurrencyForLocation,
  formatPrice,
  getAvailableCountries
};
