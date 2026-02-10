/**
 * Website Email Extractor
 * Extracts email addresses from business websites
 * Checks homepage, /contact, and /about pages
 */

const https = require('https');
const http = require('http');
const logger = require('../logger');

/**
 * Extract emails from business website
 * Checks homepage + /contact + /about pages
 *
 * @param {string} websiteUrl - Business website URL
 * @returns {Promise<string[]>} Array of discovered email addresses
 */
async function extractEmailsFromWebsite(websiteUrl) {
  const emails = new Set();

  try {
    // Normalize URL
    const baseUrl = normalizeUrl(websiteUrl);

    logger.info('website-email-extractor', 'Starting email extraction', {
      url: baseUrl
    });

    // Fetch homepage HTML
    const homepageHtml = await fetchWebsiteHtml(baseUrl, 10000);
    const homepageEmails = extractEmailsFromHtml(homepageHtml, baseUrl);
    homepageEmails.forEach(email => emails.add(email));

    // If found emails on homepage, return early (performance optimization)
    if (emails.size > 0) {
      logger.info('website-email-extractor', 'Found emails on homepage', {
        url: baseUrl,
        count: emails.size
      });
      return Array.from(emails);
    }

    // Try /contact page
    const contactUrl = `${baseUrl}/contact`;
    try {
      const contactHtml = await fetchWebsiteHtml(contactUrl, 5000);
      const contactEmails = extractEmailsFromHtml(contactHtml, baseUrl);
      contactEmails.forEach(email => emails.add(email));
    } catch (err) {
      // Contact page might not exist - not an error
      logger.debug('website-email-extractor', 'No /contact page found', { url: contactUrl });
    }

    // Try /about page
    if (emails.size === 0) {
      const aboutUrl = `${baseUrl}/about`;
      try {
        const aboutHtml = await fetchWebsiteHtml(aboutUrl, 5000);
        const aboutEmails = extractEmailsFromHtml(aboutHtml, baseUrl);
        aboutEmails.forEach(email => emails.add(email));
      } catch (err) {
        logger.debug('website-email-extractor', 'No /about page found', { url: aboutUrl });
      }
    }

    logger.info('website-email-extractor', 'Website extraction complete', {
      url: baseUrl,
      emails: Array.from(emails)
    });

    return Array.from(emails);

  } catch (error) {
    logger.error('website-email-extractor', 'Website extraction failed', {
      url: websiteUrl,
      error: error.message
    });
    return [];
  }
}

/**
 * Fetch website HTML using native Node.js https/http
 *
 * @param {string} url - Website URL
 * @param {number} timeout - Request timeout (default 10000ms)
 * @returns {Promise<string>} HTML content
 */
function fetchWebsiteHtml(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive'
        },
        timeout: timeout
      };

      const req = protocol.request(options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          logger.debug('website-email-extractor', 'Following redirect', {
            from: url,
            to: redirectUrl
          });
          return fetchWebsiteHtml(redirectUrl, timeout).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          // Limit response size (1MB max)
          if (data.length > 1000000) {
            req.destroy();
            reject(new Error('Response too large'));
          }
        });

        res.on('end', () => resolve(data));
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Extract valid email addresses from HTML content
 * Filters out generic/irrelevant emails
 *
 * @param {string} html - HTML content
 * @param {string} baseUrl - Website base URL for domain matching
 * @returns {string[]} Array of valid email addresses
 */
function extractEmailsFromHtml(html, baseUrl) {
  // Comprehensive email regex (RFC 5322 simplified)
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  // Extract all email-like strings
  const matches = html.match(emailRegex) || [];

  // Get domain from base URL
  const domain = new URL(baseUrl).hostname.replace('www.', '');

  // Filter and prioritize emails
  const validEmails = matches
    .map(email => email.toLowerCase())
    .filter(email => isValidEmail(email, domain))
    .sort((a, b) => prioritizeEmail(a, domain) - prioritizeEmail(b, domain));

  // Remove duplicates
  return [...new Set(validEmails)];
}

/**
 * Check if email is valid and relevant
 *
 * @param {string} email - Email address to validate
 * @param {string} domain - Business domain for matching
 * @returns {boolean} True if email is valid
 */
function isValidEmail(email, domain) {
  // Reject invalid formats
  if (!email.includes('@') || email.length > 254) return false;

  // Reject image filenames (e.g., callum@2x.jpg, header-1-300x125@2x.png)
  if (email.match(/\.(jpg|jpeg|png|gif|svg|webp|bmp|ico)$/i)) return false;

  // Reject emails containing image size patterns (e.g., 150x150@, 300x300@)
  if (email.match(/\d+x\d+@/)) return false;

  // Get email domain
  const emailDomain = email.split('@')[1];
  if (!emailDomain) return false;

  // Reject internal platform emails
  const platformDomains = [
    'sentry.wixpress.com',
    'sentry-next.wixpress.com',
    'wix.com',
    'squarespace.com',
    'weebly.com',
    'shopify.com',
    'wordpress.com',
    'tumblr.com',
    'blogger.com',
    'medium.com'
  ];

  if (platformDomains.some(p => emailDomain.includes(p))) return false;

  // Reject generic emails (not business-specific)
  const genericEmails = [
    'example@',
    'test@',
    'noreply@',
    'no-reply@',
    'donotreply@',
    'admin@example.com',
    'info@example.com'
  ];

  if (genericEmails.some(g => email.startsWith(g))) return false;

  // Reject common service providers (not business emails)
  const serviceProviders = [
    '@gmail.com',
    '@yahoo.com',
    '@hotmail.com',
    '@outlook.com',
    '@live.com',
    '@icloud.com',
    '@aol.com',
    '@protonmail.com'
  ];

  // Allow personal emails if they match business domain
  if (!serviceProviders.includes('@' + emailDomain)) {
    return true; // Business domain
  }

  // Reject personal emails (not business-specific)
  return false;
}

/**
 * Prioritize emails by relevance
 * Lower number = higher priority
 *
 * @param {string} email - Email address
 * @param {string} domain - Business domain
 * @returns {number} Priority score
 */
function prioritizeEmail(email, domain) {
  const localPart = email.split('@')[0];
  const emailDomain = email.split('@')[1];

  // Priority 1: Emails matching business domain
  if (emailDomain === domain || emailDomain === `www.${domain}`) {
    // Priority 1a: Contact/info emails
    if (localPart.includes('contact') || localPart.includes('info')) return 1;
    // Priority 1b: Hello/enquiries
    if (localPart.includes('hello') || localPart.includes('enquir')) return 2;
    // Priority 1c: Other business domain emails
    return 3;
  }

  // Priority 2: Non-matching domains (deprioritize)
  return 10;
}

/**
 * Normalize URL to ensure consistency
 *
 * @param {string} url - Input URL
 * @returns {string} Normalized URL
 */
function normalizeUrl(url) {
  // Add https:// if no protocol specified
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // Parse and reconstruct URL to remove trailing slashes, etc.
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
}

module.exports = {
  extractEmailsFromWebsite,
  fetchWebsiteHtml,
  extractEmailsFromHtml,
  isValidEmail,
  prioritizeEmail,
  normalizeUrl
};
