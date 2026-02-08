/**
 * Observation Signals Module
 * Detects business signals for email personalization hooks
 */

// Signal definitions with thresholds and hooks
const SIGNAL_DEFINITIONS = {
  lowReviews: {
    threshold: 10,
    hook: "growing your review count",
    description: "Less than 10 reviews — likely new or struggling with social proof",
    check: (business) => (business.reviewCount || 0) < 10
  },

  noWebsite: {
    hook: "getting a simple site live",
    description: "No website listed — missing basic online presence",
    check: (business) => !business.website || business.website.trim() === ""
  },

  poorWebsite: {
    hook: "refreshing your web presence",
    description: "Has website but appears outdated (no HTTPS or common DIY builder patterns)",
    check: (business) => {
      if (!business.website) return false;

      const url = business.website.toLowerCase();

      // Check for no HTTPS
      if (!url.startsWith("https://") && !url.startsWith("http://")) {
        return true; // Likely just a domain, no proper site
      }

      // Check for common DIY builder patterns
      const diyPatterns = [
        "wix.com",
        "weebly.com",
        "godaddy",
        "wordpress.com", // not self-hosted
        "blogger.com",
        "sites.google.com",
        "webnode"
      ];

      return diyPatterns.some(pattern => url.includes(pattern));
    }
  },

  noSocialMedia: {
    hook: "building a social presence",
    description: "No Instagram or Facebook listed — missing social proof channels",
    check: (business) => {
      // Check if business has any social media presence
      const hasSocialMedia = business.instagramUrl ||
                            business.facebookUrl ||
                            business.socialMedia?.instagram ||
                            business.socialMedia?.facebook;

      return !hasSocialMedia;
    }
  },

  lowRating: {
    threshold: 4.0,
    hook: "improving customer experience",
    description: "Rating below 4.0 — indicates service or reputation issues",
    check: (business) => {
      const rating = business.rating;
      return rating !== null && rating !== undefined && rating < 4.0;
    }
  },

  highReviews: {
    threshold: 50,
    hook: "capitalizing on your reputation",
    description: "50+ reviews — strong reputation that can be leveraged further",
    check: (business) => (business.reviewCount || 0) >= 50
  }
};

/**
 * Compute observation signals for a business
 * Returns array of signal names that apply to this business
 *
 * @param {Object} business - Business data
 * @returns {Array<string>} Array of detected signal names
 */
function computeObservationSignals(business) {
  const detected = [];

  for (const [signalName, definition] of Object.entries(SIGNAL_DEFINITIONS)) {
    try {
      if (definition.check(business)) {
        detected.push(signalName);
      }
    } catch (error) {
      // Silently skip signals that error (e.g. missing data fields)
      // Don't want a signal check failure to break entire email generation
      continue;
    }
  }

  return detected;
}

/**
 * Get hook text for a specific signal
 *
 * @param {string} signal - Signal name (e.g. "lowReviews")
 * @returns {string} Hook text for email (e.g. "growing your review count")
 */
function getSignalHook(signal) {
  const definition = SIGNAL_DEFINITIONS[signal];
  return definition ? definition.hook : "";
}

/**
 * Get description for a specific signal (for debugging/testing)
 *
 * @param {string} signal - Signal name
 * @returns {string} Human-readable description
 */
function getSignalDescription(signal) {
  const definition = SIGNAL_DEFINITIONS[signal];
  return definition ? definition.description : "";
}

/**
 * Select primary signal from an array of detected signals
 * Uses priority ordering: most impactful/urgent signals first
 *
 * Priority logic:
 * 1. lowRating - immediate reputation issue
 * 2. noWebsite - critical missing piece
 * 3. lowReviews - social proof gap
 * 4. poorWebsite - needs improvement
 * 5. noSocialMedia - missing channel
 * 6. highReviews - positive opportunity (lowest priority)
 *
 * @param {Array<string>} signals - Array of signal names
 * @returns {string|null} Primary signal name, or null if no signals
 */
function selectPrimarySignal(signals) {
  if (!signals || signals.length === 0) return null;

  // Priority order (most urgent first)
  const priority = [
    "lowRating",
    "noWebsite",
    "lowReviews",
    "poorWebsite",
    "noSocialMedia",
    "highReviews"
  ];

  // Return first signal that appears in priority list
  for (const prioritySignal of priority) {
    if (signals.includes(prioritySignal)) {
      return prioritySignal;
    }
  }

  // Fallback: return first detected signal if none match priority
  return signals[0];
}

/**
 * Get all available signal names
 * Useful for testing/documentation
 *
 * @returns {Array<string>} Array of all signal names
 */
function getAllSignalNames() {
  return Object.keys(SIGNAL_DEFINITIONS);
}

module.exports = {
  SIGNAL_DEFINITIONS,
  computeObservationSignals,
  getSignalHook,
  getSignalDescription,
  selectPrimarySignal,
  getAllSignalNames
};
