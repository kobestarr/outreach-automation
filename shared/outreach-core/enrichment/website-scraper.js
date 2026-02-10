/**
 * Website Scraper for Business Intelligence
 * Extracts company registration numbers, owner names, and registered addresses from websites
 */

const https = require('https');
const http = require('http');
const logger = require('../logger');

/**
 * Fetch website content with timeout and redirects
 * @param {string} url - Website URL
 * @param {number} timeout - Request timeout in ms (default 10000)
 * @returns {Promise<string>} HTML content
 */
function fetchWebsite(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      return reject(new Error('Invalid URL'));
    }

    // Ensure URL has protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    const protocol = url.startsWith('https://') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      timeout: timeout
    };

    const req = protocol.get(url, options, (res) => {
      // Handle redirects with socket cleanup
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Clean up current request before following redirect
        req.destroy();
        res.destroy();

        return fetchWebsite(res.headers.location, timeout)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      // Use Buffer pattern to prevent memory leak from string concatenation
      const chunks = [];
      let totalLength = 0;

      res.on('data', (chunk) => {
        chunks.push(chunk);
        totalLength += chunk.length;

        // Limit response size to 1MB
        if (totalLength > 1024 * 1024) {
          req.destroy();
          reject(new Error('Response too large'));
        }
      });

      res.on('end', () => {
        const data = Buffer.concat(chunks, totalLength).toString('utf8');
        resolve(data);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });
  });
}

/**
 * Extract company registration number from HTML
 * Looks for various UK company registration number formats
 * @param {string} html - HTML content
 * @returns {string|null} Company registration number (8 digits)
 */
function extractRegistrationNumber(html) {
  if (!html) return null;

  // Remove HTML tags for cleaner text search
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Common UK company registration patterns
  const patterns = [
    /Company\s+(?:Registration\s+)?(?:No\.?|Number)[\s:]+(\d{8})/i,
    /Registered\s+(?:No\.?|Number)[\s:]+(\d{8})/i,
    /Registration\s+(?:No\.?|Number)[\s:]+(\d{8})/i,
    /Registered\s+in\s+England\s+(?:and\s+Wales\s+)?(?:No\.?|Number)?[\s:]*(\d{8})/i,
    /Companies\s+House\s+(?:No\.?|Number)?[\s:]*(\d{8})/i,
    /\bCompany\b[^<]{0,30}\b(\d{8})\b/i,
    /\bRegistered\b[^<]{0,30}\b(\d{8})\b/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const number = match[1];
      // Validate: exactly 8 digits
      if (/^\d{8}$/.test(number)) {
        logger.info('website-scraper', 'Found registration number', { number });
        return number;
      }
    }
  }

  return null;
}

/**
 * Extract registered address from HTML
 * @param {string} html - HTML content
 * @returns {string|null} Registered address
 */
function extractRegisteredAddress(html) {
  if (!html) return null;

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const patterns = [
    /Registered\s+Office[\s:]+([^<]{20,200}(?:UK|United Kingdom|\d{3,4}\s*\d[A-Z]{2}))/i,
    /Registered\s+Address[\s:]+([^<]{20,200}(?:UK|United Kingdom|\d{3,4}\s*\d[A-Z]{2}))/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const address = match[1].trim()
        .replace(/\s+/g, ' ')
        .substring(0, 200);
      logger.info('website-scraper', 'Found registered address', { address: address.substring(0, 50) + '...' });
      return address;
    }
  }

  return null;
}

/**
 * Extract owner/director names from HTML
 * Looks for names on About, Team, Contact pages and footer
 * @param {string} html - HTML content
 * @returns {Array<{name: string, title: string|null}>} Array of potential owner names
 */
function extractOwnerNames(html) {
  if (!html) return [];

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const names = [];

  // Patterns for director/owner mentions with titles
  const titlePatterns = [
    /(?:Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor)[\s:]+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
    /(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[\s,]+(?:Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor)/gi,
    /(?:Founded by|Run by|Led by|Owned by)[\s:]+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi
  ];

  for (const pattern of titlePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      // Validate: 2-4 words, each capitalized, reasonable length
      if (name.length >= 5 && name.length <= 50 && /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(name)) {
        // Extract title if present in the matched text
        const titleMatch = match[0].match(/(Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)/i);
        names.push({
          name: name,
          title: titleMatch ? titleMatch[0] : null
        });
      }
    }
  }

  // Remove duplicates
  const unique = [];
  const seen = new Set();
  for (const item of names) {
    if (!seen.has(item.name.toLowerCase())) {
      seen.add(item.name.toLowerCase());
      unique.push(item);
    }
  }

  if (unique.length > 0) {
    logger.info('website-scraper', 'Found owner names', { count: unique.length, names: unique.map(n => n.name) });
  }

  return unique;
}

/**
 * Scrape website for company information
 * @param {string} url - Website URL
 * @returns {Promise<Object>} Scraped data
 */
async function scrapeWebsite(url) {
  try {
    logger.info('website-scraper', 'Scraping website', { url });

    // Fetch main page
    const html = await fetchWebsite(url);

    // Extract all available data
    const registrationNumber = extractRegistrationNumber(html);
    const registeredAddress = extractRegisteredAddress(html);
    const ownerNames = extractOwnerNames(html);

    // Try to fetch /about page for additional owner info
    let aboutHtml = null;
    try {
      const aboutUrl = new URL(url);
      aboutUrl.pathname = '/about';
      aboutHtml = await fetchWebsite(aboutUrl.toString(), 5000);
      const aboutNames = extractOwnerNames(aboutHtml);
      // Merge with main page names
      for (const name of aboutNames) {
        if (!ownerNames.find(n => n.name.toLowerCase() === name.name.toLowerCase())) {
          ownerNames.push(name);
        }
      }
    } catch (error) {
      // About page fetch failed - not critical
      logger.debug('website-scraper', 'Could not fetch /about page', { error: error.message });
    }

    const result = {
      registrationNumber,
      registeredAddress,
      ownerNames,
      scrapedAt: new Date().toISOString()
    };

    logger.info('website-scraper', 'Website scraping complete', {
      url,
      hasRegistrationNumber: !!registrationNumber,
      hasAddress: !!registeredAddress,
      ownerNamesCount: ownerNames.length
    });

    return result;
  } catch (error) {
    logger.error('website-scraper', 'Website scraping failed', { url, error: error.message });
    return {
      registrationNumber: null,
      registeredAddress: null,
      ownerNames: [],
      error: error.message,
      scrapedAt: new Date().toISOString()
    };
  }
}

/**
 * Parse full name into firstName and lastName
 * @param {string} fullName - Full name (e.g., "Sarah Johnson")
 * @returns {Object} { firstName, lastName }
 */
function parseName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: '', lastName: '' };
  }

  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

module.exports = {
  scrapeWebsite,
  extractRegistrationNumber,
  extractRegisteredAddress,
  extractOwnerNames,
  parseName,
  fetchWebsite
};
