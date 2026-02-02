/**
 * Email Discovery Module
 * Main entry point for email discovery using multiple sources
 */

const { findEmail } = require('./icypeas-finder');
const { generateEmailPatterns, extractDomain } = require('./pattern-generator');
const { verifyEmail } = require('../email-verification/reoon-verifier');

/**
 * Discover email address using multiple methods
 * @param {Object} params - Search parameters
 * @param {string} params.firstName - First name
 * @param {string} params.lastName - Last name
 * @param {string} params.domain - Domain name (extracted from website if not provided)
 * @param {string} params.website - Website URL
 * @param {Array<string>} params.emailsFromWebsite - Emails already found on website (from HasData scraper)
 * @param {boolean} params.useIcypeas - Whether to use Icypeas (default: true for professionals)
 * @returns {Promise<Object>} Discovery result
 */
async function discoverEmail(params) {
  const {
    firstName,
    lastName,
    domain,
    website,
    emailsFromWebsite = [],
    useIcypeas = true
  } = params;
  
  const result = {
    email: null,
    source: null,
    certainty: null,
    verified: false,
    verificationStatus: null
  };
  
  // Method 1: Use emails found on website (from HasData scraper)
  if (emailsFromWebsite && emailsFromWebsite.length > 0) {
    // Verify the first email
    try {
      const verification = await verifyEmail(emailsFromWebsite[0]);
      if (verification.isValid) {
        result.email = emailsFromWebsite[0];
        result.source = 'website';
        result.certainty = 'high';
        result.verified = true;
        result.verificationStatus = verification.status;
        return result;
      }
    } catch (error) {
      // Continue to next method if verification fails
    }
  }
  
  // Method 2: Icypeas lookup (if enabled and we have name + domain)
  if (useIcypeas && firstName && lastName) {
    const domainToUse = domain || extractDomain(website);
    
    if (domainToUse) {
      try {
        const icypeasResult = await findEmail({
          firstName,
          lastName,
          domainOrCompany: domainToUse
        });
        
        if (icypeasResult.emails && icypeasResult.emails.length > 0) {
          const bestEmail = icypeasResult.emails[0]; // Highest certainty first
          
          // Verify the email
          try {
            const verification = await verifyEmail(bestEmail.email);
            if (verification.isValid) {
              result.email = bestEmail.email;
              result.source = 'icypeas';
              result.certainty = bestEmail.certainty || 'medium';
              result.verified = true;
              result.verificationStatus = verification.status;
              return result;
            }
          } catch (error) {
            // Verification failed, but we still have the email
            result.email = bestEmail.email;
            result.source = 'icypeas_unverified';
            result.certainty = bestEmail.certainty || 'medium';
            result.verified = false;
          }
        }
      } catch (error) {
        // Icypeas failed, continue to pattern generation
      }
    }
  }
  
  // Method 3: Pattern generation + verification
  if (firstName && lastName) {
    const domainToUse = domain || extractDomain(website);
    
    if (domainToUse) {
      const patterns = generateEmailPatterns({ firstName, lastName, domain: domainToUse });
      
      // Try each pattern until we find a valid one
      for (const patternEmail of patterns) {
        try {
          const verification = await verifyEmail(patternEmail);
          if (verification.isValid) {
            result.email = patternEmail;
            result.source = 'pattern_verified';
            result.certainty = 'medium';
            result.verified = true;
            result.verificationStatus = verification.status;
            return result;
          }
        } catch (error) {
          // Continue to next pattern
        }
      }
    }
  }
  
  // No email found
  return result;
}

module.exports = {
  discoverEmail,
  generateEmailPatterns,
  extractDomain
};
