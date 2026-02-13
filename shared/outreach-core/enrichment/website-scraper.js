/**
 * Website Scraper for Business Intelligence
 * Extracts company registration numbers, owner names, and registered addresses from websites
 */

const https = require('https');
const http = require('http');
const { isValidPersonName } = require('../validation/data-quality');
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

  // CRITICAL: Filter out image files and other non-email patterns
  // Images: .jpg, .jpeg, .png, .gif, .svg, .webp, .ico, etc.
  // Files: .js, .css, .pdf, .zip, etc.
  const fileExtensions = /\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|js|css|pdf|zip|rar|doc|docx|xls|xlsx|mp4|mov|avi|mp3|wav)$/i;

  // Placeholder emails used in demos/templates
  const placeholderEmails = /^(mymail|user|yourname|example|test|email|name)@(mailservice|domain|example|test)\.(com|net|org)$/i;

  return [...new Set(emails)].filter(email => {
    // Filter out generic emails
    if (genericEmails.test(email)) return false;

    // CRITICAL: Filter out file paths that match email pattern (e.g., "image@2x.jpg")
    if (fileExtensions.test(email)) return false;

    // Filter out emails with numbers in domain that look like image dimensions (e.g., "@2x", "@3x")
    if (/@\d+x\./i.test(email)) return false;

    // Filter out placeholder/demo emails
    if (placeholderEmails.test(email)) return false;

    return true;
  });
}

/**
 * Fetch and parse sitemap.xml to discover team/about/contact pages
 * @param {string} baseUrl - Base website URL
 * @returns {Promise<Array<string>>} Array of relevant page URLs sorted by priority
 */
async function fetchSitemapUrls(baseUrl) {
  try {
    const parsedUrl = new URL(baseUrl);
    const sitemapUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}/sitemap.xml`;

    logger.debug('website-scraper', 'Fetching sitemap', { url: sitemapUrl });
    const xml = await fetchWebsite(sitemapUrl, 5000);

    // Remove CDATA wrappers if present
    const cleanedXml = xml.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');

    // Extract all <loc> URLs from sitemap
    const urlMatches = cleanedXml.match(/<loc>(.*?)<\/loc>/g) || [];
    let urls = urlMatches.map(match => match.replace(/<\/?loc>/g, '').trim());

    // Check if this is a sitemap index (contains links to other sitemaps)
    const isSitemapIndex = urls.some(url => url.endsWith('.xml') || url.includes('sitemap'));
    if (isSitemapIndex) {
      logger.debug('website-scraper', 'Detected sitemap index, skipping sub-sitemaps');
      // Don't recursively fetch sub-sitemaps - too expensive
      return [];
    }

    // Filter and prioritize relevant pages
    const relevantUrls = urls.filter(url => {
      const path = url.toLowerCase();
      return path.includes('team') ||
             path.includes('about') ||
             path.includes('contact') ||
             path.includes('staff') ||
             path.includes('people') ||
             path.includes('directors') ||
             path.includes('meet');
    });

    // Sort by priority: contact > team > about > other
    relevantUrls.sort((a, b) => {
      const getPriority = (url) => {
        const path = url.toLowerCase();
        if (path.includes('contact')) return 1;
        if (path.includes('team') || path.includes('meet')) return 2;
        if (path.includes('about')) return 3;
        return 4;
      };
      return getPriority(a) - getPriority(b);
    });

    logger.info('website-scraper', 'Found relevant pages in sitemap', {
      count: relevantUrls.length,
      urls: relevantUrls.slice(0, 5)
    });

    return relevantUrls;
  } catch (error) {
    logger.debug('website-scraper', 'No sitemap found or parse failed', {
      error: error.message
    });
    return [];
  }
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

  // Pattern 1: Names with professional qualifications (BDS, MSc, PhD, ACCA, ACA, etc.)
  // e.g., "Christopher Needham BDS", "Andy Vause | BSc FCA", "Laura Gill BDS MJDF RCS Eng"
  // Handles pipe separators (|, –, —) between name and qualification
  const qualificationPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[|\u2013\u2014]?\s*(BDS|MBChB|MBBS|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Level\s+\d|ACCA|ACA|FCA|FCCA|ATT|CTA|CIMA|CIPFA)(?:\s+[A-Z][a-z]+|\s+RCS|\s+Eng|\s+\([A-Za-z]+\)|\s+in)?/gi;
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
    const nonNameWords = /^(visiting|become|qualified|joined|graduated|gained|spent|completed|passed|achieved|acts|enjoys|says|lives|works|moved|returned|continued|successful|provides|offers|accepts|uses|finds|working|taking|playing|going|doing|making|having|being|getting|coming|looking|website|visit|contact|general|special|excellent|friendly|relaxed|committed|registered|professional|enhanced|extended|national|british|internal|external|modern|current|several|practice|service|dental|clinical|reception|treatment|gdc|chief|executive|business|development|sales|operations|marketing|finance|technical|digital|solutions|change|contractor|company|best|call|email|linkedin|certified|chartered|begum|ward|sports|client|main|social|media|care|message|umbrella|connor|moore|rachubka)\b/i;

    const firstWord = name.split(' ')[0].toLowerCase();
    if (nonNameWords.test(firstWord)) {
      return false;
    }

    // Reject if second word is a qualification (BDS, MSc, etc.)
    const secondWord = name.split(' ')[1];
    if (secondWord && /^(BDS|MBBS|MBChB|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Eng|ACCA|ACA|FCA|FCCA|ATT|CTA)$/i.test(secondWord)) {
      return false;
    }

    // Reject names ending with job-related words, qualifications, or country codes
    if (name.match(/\b(Dental|Lead|Senior|Junior|Practice|Team|Contact|About|University|School|College|Service|Care|General|Degree|Certificate|Diploma|Number|Website|Email|uk|usa|com|org|net|co|Executive|Officer|Manager|Sales|Operations|Marketing|Development|Change|Solutions|Professional|Client|Media|Linkedin|Managing)$/i)) {
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
  // e.g., "Amanda Lynam Practice Manager", "Paul Brown Tax Director"

  // First try extended pattern for 3-word names with compound titles (handles "Paul Brown Tax Director")
  const extendedPattern = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+([A-Z][a-z]+)\s+(Director|Manager|Accountant|Partner|Officer)\b/gi;

  while ((match = extendedPattern.exec(text)) !== null) {
    const firstName = match[1].trim();
    const middleWord = match[2].trim();
    const lastWord = match[3].trim();

    // Check if middle word is part of job title (Tax, Operations, Sales, etc.) or part of name
    const jobTitlePrefixes = ['Tax', 'Operations', 'Sales', 'Marketing', 'Managing', 'Senior', 'Junior', 'Chief', 'Executive', 'Finance', 'Technical', 'Practice', 'Office', 'Business', 'Client', 'Accounts', 'Payroll'];

    if (jobTitlePrefixes.includes(middleWord)) {
      // Middle word is job title prefix, so name is first two words
      if (isValidPersonName(firstName)) {
        names.push({ name: firstName, title: `${middleWord} ${lastWord}` });
      }
    } else {
      // Middle word is likely part of name (three-word name)
      const fullName = `${firstName} ${middleWord}`;
      if (isValidPersonName(fullName)) {
        names.push({ name: fullName, title: lastWord });
      }
    }
  }

  // Then standard 2-word name pattern
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

    // INTELLIGENT SCRAPING: Try sitemap.xml first, then fall back to hardcoded paths
    // This discovers pages like /resources/news/in-team/ that we'd otherwise miss
    let pagesToCheck = await fetchSitemapUrls(url);

    // If no sitemap or no relevant pages found, use hardcoded paths
    if (pagesToCheck.length === 0) {
      logger.debug('website-scraper', 'No sitemap found, using hardcoded paths');
      const baseParsedUrl = new URL(url);
      const hardcodedPaths = [
        '/contact', '/contact-us', '/contactus',  // Contact pages first (usually have email + names)
        '/team', '/meet-the-team', '/our-team', '/meet-the-team-subtitle', '/team-members',
        '/staff', '/people', '/directors',
        '/about', '/about-us', '/about-me', '/aboutus', '/about-us/meet-the-team',
        '/blog', '/insights', '/news'
      ];
      pagesToCheck = hardcodedPaths.map(path => `${baseParsedUrl.protocol}//${baseParsedUrl.hostname}${path}`);
    }

    // EARLY EXIT OPTIMIZATION: Stop scraping once we have email + name
    // This saves tokens and reduces scraping time
    let allEmails = [...emails];

    for (const pageUrl of pagesToCheck) {
      try {
        // EARLY EXIT: If we already have email + name, stop scraping
        if (allEmails.length > 0 && ownerNames.length > 0) {
          logger.info('website-scraper', 'Early exit: already have email + name', {
            emails: allEmails.length,
            names: ownerNames.length
          });
          break;
        }

        const teamHtml = await fetchWebsite(pageUrl, 5000);

        // Extract emails from team page (may have additional staff emails)
        const teamEmails = extractEmails(teamHtml);
        allEmails = [...new Set([...allEmails, ...teamEmails])]; // Combine and dedupe

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
              logger.info('website-scraper', `Found name in meta description`, { name, url: pageUrl });
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
          const pagePath = new URL(pageUrl).pathname;
          logger.info('website-scraper', `Found names on page`, { path: pagePath, count: teamNames.length });
        }
      } catch (error) {
        // Team page fetch failed - not critical, try next one
        logger.debug('website-scraper', `Could not fetch page`, { url: pageUrl, error: error.message });
      }
    }

    // Update emails array with all discovered emails
    emails.push(...allEmails.filter(e => !emails.includes(e)));

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
      emails, // CRITICAL: Return the emails array so they can be exported to Lemlist
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
      emails: [],
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

  const trimmed = fullName.trim();

  // CRITICAL FIX: Validate BEFORE parsing (blocks "Senior Specialist", "Web Pixels", etc.)
  if (!isValidPersonName(trimmed)) {
    logger.warn('website-scraper', 'Invalid name rejected by parseName', {
      input: trimmed,
      reason: 'Failed validation (likely job title or common word)'
    });
    return { firstName: '', lastName: '' };
  }

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    const firstName = parts[0];

    // Validate single-word names
    if (!isValidPersonName(firstName)) {
      logger.warn('website-scraper', 'Single-word name failed validation', {
        input: firstName
      });
      return { firstName: '', lastName: '' };
    }

    return { firstName, lastName: '' };
  }

  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');

  // CRITICAL FIX: Validate parsed firstName (extra safety layer)
  // This catches cases where first word is valid but is actually a job title
  if (!isValidPersonName(firstName)) {
    logger.warn('website-scraper', 'Invalid firstName rejected by parseName', {
      input: trimmed,
      firstName: firstName,
      reason: 'firstName failed validation'
    });
    return { firstName: '', lastName: '' };
  }

  return { firstName, lastName };
}

module.exports = {
  scrapeWebsite,
  extractRegistrationNumber,
  extractRegisteredAddress,
  extractOwnerNames,
  parseName,
  fetchWebsite
};
