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
 * Extract email addresses from HTML
 * @param {string} html - HTML content
 * @returns {Array<string>} Array of email addresses found
 */
function extractEmails(html) {
  if (!html) return [];

  const emailPattern = /\b[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = html.match(emailPattern) || [];

  // Deduplicate and filter out common generic emails
  const genericEmails = /^(info|contact|hello|support|admin|enquiries|mail)@/i;
  return [...new Set(emails)].filter(email => !genericEmails.test(email));
}

/**
 * Find matching email for a person, respecting already-claimed emails
 * Implements email claiming logic: only one person can claim each email
 * Priority: Personal emails > Senior roles > Junior roles
 *
 * @param {string} fullName - Person's full name (e.g., "Christopher Needham")
 * @param {string} title - Person's job title (e.g., "Practice Manager", "Owner")
 * @param {Array<string>} emails - All emails found on website
 * @param {Set<string>} claimedEmails - Emails already claimed by other people
 * @returns {string|null} Matching email or null
 */
function findMatchingEmail(fullName, title, emails, claimedEmails = new Set()) {
  if (!fullName || !emails || emails.length === 0) return null;

  const nameParts = fullName.toLowerCase().split(' ');
  if (nameParts.length < 2) return null;

  const firstName = nameParts[0];
  const lastName = nameParts[nameParts.length - 1];

  // Priority 1: Personal email patterns (highest priority)
  const personalPatterns = [
    `${firstName}.${lastName}@`,       // christopher.needham@
    `${firstName}${lastName}@`,        // christopherneedham@
    `${firstName}@`,                   // christopher@
    `${firstName[0]}${lastName}@`,     // cneedham@
    `${firstName[0]}.${lastName}@`     // c.needham@
  ];

  // Check personal email patterns first
  for (const pattern of personalPatterns) {
    const match = emails.find(email => {
      const emailLower = email.toLowerCase();
      return emailLower.includes(pattern) && !claimedEmails.has(email);
    });
    if (match) return match;
  }

  // Priority 2: Role-based email patterns (if title provided)
  if (title) {
    const titleLower = title.toLowerCase();
    let rolePatterns = [];

    // Map job titles to email patterns with priority
    if (titleLower.includes('practice manager') || titleLower.includes('office manager')) {
      rolePatterns = ['pm@', 'manager@', 'office@']; // Senior role
    } else if (titleLower.includes('owner') || titleLower.includes('proprietor') || titleLower.includes('founder')) {
      rolePatterns = ['owner@', 'director@', 'ceo@']; // Senior role
    } else if (titleLower.includes('director') || titleLower.includes('managing director')) {
      rolePatterns = ['director@', 'md@']; // Senior role
    } else if (titleLower.includes('reception')) {
      rolePatterns = ['reception@', 'front@']; // Junior role
    }

    // Check role-based patterns
    for (const pattern of rolePatterns) {
      const match = emails.find(email => {
        const emailLower = email.toLowerCase();
        return emailLower.startsWith(pattern) && !claimedEmails.has(email);
      });
      if (match) return match;
    }
  }

  return null; // No match found or all matches already claimed
}

/**
 * Extract owner/director names from HTML
 * Looks for names on About, Team, Contact pages and footer
 * Supports healthcare professionals, business titles, and contextual mentions
 * @param {string} html - HTML content
 * @param {Array<string>} emails - Optional array of emails to validate against
 * @returns {Array<{name: string, title: string|null, hasEmailMatch: boolean}>} Array of potential owner names
 */
function extractOwnerNames(html, emails = []) {
  if (!html) return [];

  const text = html.replace(/<[^>]+>/g, '\n').replace(/\s+/g, ' ');
  const names = [];

  // Pattern 1: Names with professional qualifications (BDS, MSc, PhD, etc.)
  // e.g., "Christopher Needham BDS", "Laura Gill BDS MJDF RCS Eng", "Michael Clark BDS MSc (Endo)"
  const qualificationPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(BDS|MBChB|MBBS|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Level\s+\d)(?:\s+[A-Z][a-z]+|\s+RCS|\s+Eng|\s+\([A-Za-z]+\)|\s+in)?/gi;
  let match;
  while ((match = qualificationPattern.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 5 && name.length <= 50 && /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(name)) {
      const qualification = match[2];
      names.push({ name, title: qualification });
    }
  }

  // Pattern 2: Business titles BEFORE name (more reliable)
  // e.g., "Principal Christopher Needham", "Owner Sarah Johnson", "Founder Mike Chen"
  const titleFirstPatterns = [
    /(?:Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor|Partner)[\s:]+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
    /(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[\s,]+(?:Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor)/gi
  ];

  for (const pattern of titleFirstPatterns) {
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      // Ensure name doesn't end with job-related words
      if (name.length >= 5 && name.length <= 50 &&
          /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(name) &&
          !name.match(/\b(Dental|Lead|Senior|Junior|Manager|Director|Officer)$/)) {
        const titleMatch = match[0].match(/(Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)/i);
        names.push({ name, title: titleMatch ? titleMatch[0] : null });
      }
    }
  }

  // Pattern 3: Context clues (founded by, joined by, graduated from)
  // e.g., "founded by Christopher Needham", "practice was started by Sarah Johnson"
  const contextPattern = /(?:founded|started|established|run|led|owned|joined|managed|graduated)\s+(?:by|from)\s+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi;
  while ((match = contextPattern.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 5 && name.length <= 50 &&
        /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(name) &&
        !name.match(/\b(Dental|Lead|Senior|Junior|Manager|Director|Officer|University|School|College)$/)) {
      names.push({ name, title: 'Founder' });
    }
  }

  // Pattern 4: General names near job indicators (works for any business type)
  // Finds proper names followed by job-related terms within proximity
  // Two sub-patterns: (a) name directly before indicator, (b) name with 1-2 words before indicator

  // Helper function to validate if a string looks like a real person's name
  const isValidPersonName = (name) => {
    // Reject common non-name words that get capitalized in sentences
    const nonNameWords = /^(visiting|become|qualified|joined|graduated|gained|spent|completed|passed|achieved|acts|enjoys|says|lives|works|moved|returned|continued|successful|provides|offers|accepts|uses|finds|working|taking|playing|going|doing|making|having|being|getting|coming|looking|website|visit|contact|general|special|excellent|friendly|relaxed|committed|registered|professional|enhanced|extended|national|british|internal|external|modern|current|several|practice|service|dental|clinical|reception|treatment|gdc)\b/i;

    const firstWord = name.split(' ')[0].toLowerCase();
    if (nonNameWords.test(firstWord)) {
      return false;
    }

    // Reject if second word is a qualification (BDS, MSc, etc.)
    const secondWord = name.split(' ')[1];
    if (secondWord && /^(BDS|MBBS|MBChB|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Eng)$/i.test(secondWord)) {
      return false;
    }

    // Reject names ending with job-related words, qualifications, or country codes
    if (name.match(/\b(Dental|Lead|Senior|Junior|Practice|Team|Contact|About|University|School|College|Service|Care|General|Degree|Certificate|Diploma|Number|Website|Email|uk|usa|com|org|net|co)$/i)) {
      return false;
    }

    // Reject if contains lowercase articles or conjunctions
    if (name.match(/\b(the|and|as|an|of|in|on|at|to|for|with|from|by)\b/)) {
      return false;
    }

    // Require that both words start with uppercase and contain mostly lowercase
    const words = name.split(' ');
    for (const word of words) {
      if (!/^[A-Z][a-z]{1,}$/.test(word)) {
        return false;
      }
    }

    return name.length >= 5 && name.length <= 40;
  };

  // 4a: Name immediately followed by job indicator (most reliable)
  // e.g., "Amanda Lynam Practice Manager", "Natasha Lallement Receptionist"
  const directPattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(Practice\s+Manager|Office\s+Manager|Lead\s+Nurse|Senior\s+Nurse|Dental\s+Nurse|Dental\s+Hygienist|Dental\s+Therapist|Dental\s+Surgeon|Receptionist|Manager|Director|Owner|Founder|Partner|Associate|Hygienist|Therapist|Nurse|Dentist|Surgeon|Administrator|Accountant|Consultant|Engineer|Plumber|Electrician|Chef|Stylist|Barber|Technician|Specialist|Coordinator|Officer)\b/gi;

  while ((match = directPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const indicator = match[2].trim();

    if (isValidPersonName(name)) {
      names.push({ name, title: indicator });
    }
  }

  // 4b: Name followed by GDC Number (UK dental professionals)
  // e.g., "Barbara Woodall Dental Hygienist - GDC Number"
  const gdcProximityPattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+[A-Za-z\s-]{0,30}?GDC\s+Number/gi;

  while ((match = gdcProximityPattern.exec(text)) !== null) {
    const name = match[1].trim();

    if (isValidPersonName(name)) {
      names.push({ name, title: 'Professional' });
    }
  }

  // Remove duplicates (keep first occurrence which is usually highest priority)
  const unique = [];
  const seen = new Set();
  for (const item of names) {
    if (!seen.has(item.name.toLowerCase())) {
      seen.add(item.name.toLowerCase());
      unique.push(item);
    }
  }

  // Validate names against email patterns with email claiming
  // Only one person can claim each email (fixes duplicate email bug)
  const claimedEmails = new Set();
  const validated = unique.map(owner => {
    const matchedEmail = findMatchingEmail(owner.name, owner.title, emails, claimedEmails);

    if (matchedEmail) {
      claimedEmails.add(matchedEmail); // Claim the email so others can't use it
      return {
        ...owner,
        hasEmailMatch: true,
        matchedEmail: matchedEmail // Store which email matched
      };
    } else {
      return {
        ...owner,
        hasEmailMatch: false,
        matchedEmail: null
      };
    }
  });

  // Sort by email match (names with matching emails first)
  validated.sort((a, b) => {
    if (a.hasEmailMatch && !b.hasEmailMatch) return -1;
    if (!a.hasEmailMatch && b.hasEmailMatch) return 1;
    return 0;
  });

  if (validated.length > 0) {
    // Count UNIQUE emails (not people) - fixes duplicate email counting bug
    const uniqueMatchedEmails = new Set(
      validated
        .filter(n => n.hasEmailMatch && n.matchedEmail)
        .map(n => n.matchedEmail)
    );

    logger.info('website-scraper', 'Found owner names', {
      count: validated.length,
      peopleWithEmails: validated.filter(n => n.hasEmailMatch).length,
      uniqueEmailsMatched: uniqueMatchedEmails.size, // Correct count of unique emails
      names: validated.map(n => `${n.name}${n.hasEmailMatch ? ' ✓' : ''}`)
    });
  }

  return validated;
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

    // Extract emails first (used for name validation)
    const emails = extractEmails(html);
    logger.info('website-scraper', 'Extracted emails from main page', { count: emails.length });

    // Extract from meta tags first (often has team info)
    const metaNames = [];
    const metaDescription = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["']([^"']+)["']/i);
    if (metaDescription && metaDescription[1]) {
      const metaText = metaDescription[1].replace(/&amp;/g, '&');
      // Look for names with "Dr" prefix in meta description
      const drPattern = /Dr\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;
      let match;
      while ((match = drPattern.exec(metaText)) !== null) {
        const name = match[1].trim();
        metaNames.push({
          name: name,
          title: 'Dr',
          hasEmailMatch: false, // Will be validated later with email claiming
          matchedEmail: null
        });
      }
      if (metaNames.length > 0) {
        logger.info('website-scraper', 'Found names in meta description', { count: metaNames.length });
      }
    }

    // Extract all available data
    const registrationNumber = extractRegistrationNumber(html);
    const registeredAddress = extractRegisteredAddress(html);

    // Start with meta description names (highest priority)
    const ownerNames = [...metaNames];

    // Also extract from main page content using pattern matching
    const mainPageNames = extractOwnerNames(html, emails);
    for (const name of mainPageNames) {
      if (!ownerNames.find(n => n.name.toLowerCase() === name.name.toLowerCase())) {
        ownerNames.push(name);
      }
    }

    // Try to fetch team/about/contact/blog pages for additional owner info
    // For small local business websites, checking all common pages increases name discovery
    const teamPageUrls = [
      '/about', '/about-us', '/about-me', '/aboutus',
      '/team', '/meet-the-team', '/our-team', '/meet-the-team-subtitle', '/team-members',
      '/staff', '/people', '/directors',
      '/contact', '/contact-us', '/contactus',
      '/blog', '/insights', '/news'
    ];

    for (const path of teamPageUrls) {
      try {
        const teamUrl = new URL(url);
        teamUrl.pathname = path;
        const teamHtml = await fetchWebsite(teamUrl.toString(), 5000);

        // Extract emails from team page (may have additional staff emails)
        const teamEmails = extractEmails(teamHtml);
        const allEmails = [...new Set([...emails, ...teamEmails])]; // Combine and dedupe

        // Extract from team page meta description first
        const teamMetaDescription = teamHtml.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["']([^"']+)["']/i);
        if (teamMetaDescription && teamMetaDescription[1]) {
          const teamMetaText = teamMetaDescription[1].replace(/&amp;/g, '&');
          const drPattern = /Dr\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;
          let match;
          while ((match = drPattern.exec(teamMetaText)) !== null) {
            const name = match[1].trim();
            if (!ownerNames.find(n => n.name.toLowerCase() === name.toLowerCase())) {
              ownerNames.push({
                name: name,
                title: 'Dr',
                hasEmailMatch: false, // Will be validated later with email claiming
                matchedEmail: null
              });
              logger.info('website-scraper', `Found name in ${path} meta description`, { name });
            }
          }
        }

        // Also extract from team page HTML content
        const teamNames = extractOwnerNames(teamHtml, allEmails);
        for (const name of teamNames) {
          if (!ownerNames.find(n => n.name.toLowerCase() === name.name.toLowerCase())) {
            ownerNames.push(name);
          }
        }
        if (teamNames.length > 0) {
          logger.info('website-scraper', `Found names on ${path}`, { count: teamNames.length });
        }
      } catch (error) {
        // Team page fetch failed - not critical, try next one
        logger.debug('website-scraper', `Could not fetch ${path} page`, { error: error.message });
      }
    }

    // Final email claiming pass on ALL merged names
    // This ensures only one person claims each email, even if they come from different sources
    const claimedEmails = new Set();
    ownerNames.forEach(owner => {
      // Skip if already validated by extractOwnerNames (from team pages)
      if (owner.hasEmailMatch && owner.matchedEmail) {
        claimedEmails.add(owner.matchedEmail);
        return;
      }

      // Validate names that don't have email matches yet (meta description names)
      const matchedEmail = findMatchingEmail(owner.name, owner.title, emails, claimedEmails);
      if (matchedEmail) {
        claimedEmails.add(matchedEmail);
        owner.hasEmailMatch = true;
        owner.matchedEmail = matchedEmail;
      } else {
        owner.hasEmailMatch = false;
        owner.matchedEmail = null;
      }
    });

    // Sort owner names - prioritize those with email matches
    ownerNames.sort((a, b) => {
      if (a.hasEmailMatch && !b.hasEmailMatch) return -1;
      if (!a.hasEmailMatch && b.hasEmailMatch) return 1;
      return 0;
    });

    const result = {
      registrationNumber,
      registeredAddress,
      ownerNames,
      scrapedAt: new Date().toISOString()
    };

    // Count UNIQUE emails (not people) - fixes duplicate email counting bug
    const uniqueMatchedEmails = new Set(
      ownerNames
        .filter(n => n.hasEmailMatch && n.matchedEmail)
        .map(n => n.matchedEmail)
    );

    logger.info('website-scraper', 'Website scraping complete', {
      url,
      hasRegistrationNumber: !!registrationNumber,
      hasAddress: !!registeredAddress,
      ownerNamesCount: ownerNames.length,
      peopleWithEmails: ownerNames.filter(n => n.hasEmailMatch).length,
      uniqueEmailsMatched: uniqueMatchedEmails.size // Correct count of unique emails
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
