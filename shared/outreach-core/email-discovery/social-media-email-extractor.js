/**
 * Social Media Email Extractor
 * Extracts email addresses from business social media profiles
 * Checks Instagram, Facebook, LinkedIn in order of success rate
 */

const logger = require('../logger');
const { fetchWebsiteHtml } = require('./website-email-extractor');

/**
 * Extract emails from business social media profiles
 * Checks Instagram, Facebook, LinkedIn in order of success rate
 *
 * @param {Object} business - Business data with social media URLs
 * @returns {Promise<string[]>} Array of discovered email addresses
 */
async function extractEmailsFromSocialMedia(business) {
  const emails = new Set();

  try {
    logger.info('social-media-email-extractor', 'Starting social media extraction', {
      business: business.name,
      hasInstagram: !!business.instagramUrl,
      hasFacebook: !!business.facebookUrl,
      hasLinkedIn: !!business.linkedInUrl
    });

    // Instagram (highest success rate for small businesses)
    if (business.instagramUrl) {
      const igEmails = await extractEmailsFromInstagram(business.instagramUrl);
      igEmails.forEach(email => emails.add(email));

      if (emails.size > 0) {
        logger.info('social-media-email-extractor', 'Found emails on Instagram', {
          url: business.instagramUrl,
          count: emails.size
        });
        return Array.from(emails);
      }
    }

    // Facebook (medium success rate)
    if (business.facebookUrl) {
      const fbEmails = await extractEmailsFromFacebook(business.facebookUrl);
      fbEmails.forEach(email => emails.add(email));

      if (emails.size > 0) {
        logger.info('social-media-email-extractor', 'Found emails on Facebook', {
          url: business.facebookUrl,
          count: emails.size
        });
        return Array.from(emails);
      }
    }

    // LinkedIn (lower success rate but more professional)
    if (business.linkedInUrl) {
      const liEmails = await extractEmailsFromLinkedIn(business.linkedInUrl);
      liEmails.forEach(email => emails.add(email));

      if (emails.size > 0) {
        logger.info('social-media-email-extractor', 'Found emails on LinkedIn', {
          url: business.linkedInUrl,
          count: emails.size
        });
        return Array.from(emails);
      }
    }

    logger.info('social-media-email-extractor', 'Social media extraction complete', {
      business: business.name,
      emails: Array.from(emails)
    });

    return Array.from(emails);

  } catch (error) {
    logger.error('social-media-email-extractor', 'Social media extraction failed', {
      business: business.name,
      error: error.message
    });
    return [];
  }
}

/**
 * Extract email from Instagram bio
 * Uses public Instagram page (no API key required)
 *
 * @param {string} instagramUrl - Instagram profile URL
 * @returns {Promise<string[]>} Array of email addresses
 */
async function extractEmailsFromInstagram(instagramUrl) {
  try {
    logger.debug('social-media-email-extractor', 'Fetching Instagram profile', { url: instagramUrl });

    // Fetch Instagram profile HTML (public page)
    const html = await fetchWebsiteHtml(instagramUrl, 10000);

    // Instagram embeds data in <script> tags with JSON
    // Look for biography field containing email
    const bioMatch = html.match(/"biography":"([^"]+)"/);

    if (!bioMatch) {
      logger.debug('social-media-email-extractor', 'No Instagram bio found', { url: instagramUrl });
      return [];
    }

    const biography = bioMatch[1];

    // Extract emails from bio
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = biography.match(emailRegex) || [];

    logger.debug('social-media-email-extractor', 'Instagram extraction result', {
      url: instagramUrl,
      found: emails.length
    });

    return emails.map(e => e.toLowerCase());

  } catch (error) {
    logger.error('social-media-email-extractor', 'Instagram extraction failed', {
      url: instagramUrl,
      error: error.message
    });
    return [];
  }
}

/**
 * Extract email from Facebook business page
 * Uses public Facebook page (no API key required)
 *
 * @param {string} facebookUrl - Facebook page URL
 * @returns {Promise<string[]>} Array of email addresses
 */
async function extractEmailsFromFacebook(facebookUrl) {
  try {
    logger.debug('social-media-email-extractor', 'Fetching Facebook page', { url: facebookUrl });

    // Fetch Facebook page HTML
    const html = await fetchWebsiteHtml(facebookUrl, 10000);

    // Facebook pages often have email in "About" section
    // Look for email patterns in HTML
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailRegex) || [];

    // Filter out Facebook-specific emails
    const filtered = emails
      .map(e => e.toLowerCase())
      .filter(e => !e.includes('@facebook.com') && !e.includes('@fb.com'));

    logger.debug('social-media-email-extractor', 'Facebook extraction result', {
      url: facebookUrl,
      found: filtered.length
    });

    return filtered;

  } catch (error) {
    logger.error('social-media-email-extractor', 'Facebook extraction failed', {
      url: facebookUrl,
      error: error.message
    });
    return [];
  }
}

/**
 * Extract email from LinkedIn company page
 * Uses public LinkedIn page (no API key required)
 *
 * @param {string} linkedInUrl - LinkedIn company page URL
 * @returns {Promise<string[]>} Array of email addresses
 */
async function extractEmailsFromLinkedIn(linkedInUrl) {
  try {
    logger.debug('social-media-email-extractor', 'Fetching LinkedIn page', { url: linkedInUrl });

    // Fetch LinkedIn company page HTML
    const html = await fetchWebsiteHtml(linkedInUrl, 10000);

    // LinkedIn company pages sometimes include email in "Overview" section
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailRegex) || [];

    // Filter out LinkedIn-specific emails
    const filtered = emails
      .map(e => e.toLowerCase())
      .filter(e => !e.includes('@linkedin.com'));

    logger.debug('social-media-email-extractor', 'LinkedIn extraction result', {
      url: linkedInUrl,
      found: filtered.length
    });

    return filtered;

  } catch (error) {
    logger.error('social-media-email-extractor', 'LinkedIn extraction failed', {
      url: linkedInUrl,
      error: error.message
    });
    return [];
  }
}

module.exports = {
  extractEmailsFromSocialMedia,
  extractEmailsFromInstagram,
  extractEmailsFromFacebook,
  extractEmailsFromLinkedIn
};
