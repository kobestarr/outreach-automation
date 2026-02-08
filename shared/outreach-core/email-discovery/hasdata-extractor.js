/**
 * HasData Email Extraction Module
 * 
 * NOTE: This module is deprecated. Email extraction is now handled directly
 * by the Google Maps scraper (google-maps-scraper.js) which returns emails
 * in the 'emailsFromWebsite' field of each business.
 * 
 * HasData's Google Maps scraper already extracts emails from websites during
 * the scraping process, making a separate email extraction API call redundant.
 * 
 * This file is kept for backward compatibility but should be removed in a
 * future cleanup. Use business.emailsFromWebsite from the Google Maps scraper
 * results instead.
 * 
 * @deprecated Use business.emailsFromWebsite from Google Maps scraper results
 */

const logger = require('../logger');

/**
 * Extract emails from a website URL
 * @deprecated Use business.emailsFromWebsite from Google Maps scraper instead
 * @param {string} websiteUrl - Website URL to extract emails from
 * @returns {Promise<Array<string>>} Array of found email addresses (always empty)
 */
async function extractEmailsFromWebsite(websiteUrl) {
  logger.warn('hasdata-extractor', 'extractEmailsFromWebsite is deprecated. Emails are now extracted by Google Maps scraper.', {
    websiteUrl,
    alternative: 'Use business.emailsFromWebsite from scrapeGoogleMaps results'
  });
  
  // Return empty array - emails now come from Google Maps scraper results
  return [];
}

module.exports = {
  extractEmailsFromWebsite
};
