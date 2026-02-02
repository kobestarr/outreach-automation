/**
 * LinkedIn Enrichment Module
 * Main entry point for LinkedIn profile enrichment
 */

const { findLinkedInProfile } = require("./icypeas-enricher");
const { shouldEnrichLinkedIn, recordLinkedInResult } = require("./decision-logic");
const { checkDailyLimit } = require("../credentials-loader");

/**
 * Enrich business with LinkedIn profile
 */
async function enrichLinkedIn(business) {
  // Check if we should enrich
  const creditLimits = {
    icypeas: checkDailyLimit("icypeas")
  };
  
  const decision = shouldEnrichLinkedIn(business, creditLimits);
  
  if (!decision.enrich) {
    return {
      enriched: false,
      reason: decision.reason,
      linkedInUrl: null,
      linkedInData: null
    };
  }
  
  // Perform enrichment
  try {
    const profile = await findLinkedInProfile({
      firstName: business.ownerFirstName,
      lastName: business.ownerLastName,
      companyName: business.businessName || business.name,
      location: business.address || business.city
    });
    
    // Record result
    recordLinkedInResult(business, profile.found);
    
    if (profile.found) {
      return {
        enriched: true,
        linkedInUrl: profile.linkedInUrl,
        linkedInData: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          title: profile.title,
          company: profile.company,
          location: profile.location
        }
      };
    } else {
      return {
        enriched: false,
        reason: "profile_not_found",
        linkedInUrl: null,
        linkedInData: null
      };
    }
  } catch (error) {
    // Record failure
    recordLinkedInResult(business, false);
    
    return {
      enriched: false,
      reason: "enrichment_error",
      error: error.message,
      linkedInUrl: null,
      linkedInData: null
    };
  }
}

module.exports = {
  enrichLinkedIn,
  shouldEnrichLinkedIn
};
