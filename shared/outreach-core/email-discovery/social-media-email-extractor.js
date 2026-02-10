/**
 * Social Media Email Extractor (DEPRECATED)
 *
 * ⚠️  WARNING: FUNCTIONALITY DISABLED ⚠️
 *
 * Direct scraping of social media platforms violates their Terms of Service
 * and poses significant legal and operational risks:
 *
 * - Instagram: Explicitly prohibits automated scraping (Instagram ToS Section 3.3)
 * - Facebook: Prohibits unauthorized data collection (Facebook ToS Section 3.2)
 * - LinkedIn: Prohibits scraping (LinkedIn v. hiQ Labs, 2022)
 *
 * LEGAL RISKS:
 * - Account suspension/IP bans
 * - Legal action from platforms (cease & desist, lawsuits)
 * - CFAA violations (Computer Fraud and Abuse Act)
 * - GDPR/CCPA compliance issues
 *
 * RECOMMENDED ALTERNATIVES:
 * 1. Use official APIs with proper permissions:
 *    - Instagram Graph API (business accounts)
 *    - Facebook Graph API (pages)
 *    - LinkedIn Official API
 *
 * 2. Use authorized third-party services:
 *    - Hunter.io
 *    - Clearbit
 *    - RocketReach
 *    - Apollo.io
 *
 * 3. Focus on website-based extraction (legitimate public content)
 *
 * This module has been deprecated and all functions return empty arrays.
 * To re-enable, implement proper OAuth flows with official APIs.
 *
 * @module social-media-email-extractor
 * @deprecated Since 2026-02-10 - ToS violations
 */

const logger = require('../logger');

/**
 * Extract emails from business social media profiles (DEPRECATED)
 *
 * @param {Object} business - Business data with social media URLs
 * @returns {Promise<string[]>} Always returns empty array
 * @deprecated Use official APIs instead
 */
async function extractEmailsFromSocialMedia(business) {
  logger.warn('social-media-email-extractor',
    'Social media scraping is deprecated due to Terms of Service violations. Use official APIs instead.',
    {
      business: business.name,
      hasInstagram: !!business.instagramUrl,
      hasFacebook: !!business.facebookUrl,
      hasLinkedIn: !!business.linkedInUrl
    }
  );
  return [];
}

/**
 * Extract email from Instagram bio (DEPRECATED)
 *
 * @param {string} instagramUrl - Instagram profile URL
 * @returns {Promise<string[]>} Always returns empty array
 * @deprecated Violates Instagram Terms of Service - Use Instagram Graph API instead
 */
async function extractEmailsFromInstagram(instagramUrl) {
  logger.warn('social-media-email-extractor',
    'Instagram scraping is deprecated. Use Instagram Graph API with proper OAuth permissions instead.',
    { url: instagramUrl }
  );
  return [];
}

/**
 * Extract email from Facebook business page (DEPRECATED)
 *
 * @param {string} facebookUrl - Facebook page URL
 * @returns {Promise<string[]>} Always returns empty array
 * @deprecated Violates Facebook Terms of Service - Use Facebook Graph API instead
 */
async function extractEmailsFromFacebook(facebookUrl) {
  logger.warn('social-media-email-extractor',
    'Facebook scraping is deprecated. Use Facebook Graph API with proper page permissions instead.',
    { url: facebookUrl }
  );
  return [];
}

/**
 * Extract email from LinkedIn company page (DEPRECATED)
 *
 * @param {string} linkedInUrl - LinkedIn company page URL
 * @returns {Promise<string[]>} Always returns empty array
 * @deprecated Violates LinkedIn Terms of Service - Use LinkedIn Official API instead
 */
async function extractEmailsFromLinkedIn(linkedInUrl) {
  logger.warn('social-media-email-extractor',
    'LinkedIn scraping is deprecated. Use LinkedIn Official API with proper company permissions instead.',
    { url: linkedInUrl }
  );
  return [];
}

module.exports = {
  extractEmailsFromSocialMedia,
  extractEmailsFromInstagram,
  extractEmailsFromFacebook,
  extractEmailsFromLinkedIn
};
