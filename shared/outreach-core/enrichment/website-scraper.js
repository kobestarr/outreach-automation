/**
 * Website Scraper for Business Intelligence
 * Extracts company registration numbers, owner names, and registered addresses from websites
 */

const https = require('https');
const http = require('http');
const { isValidPersonName } = require('../validation/data-quality');
const { COMMON_FIRST_NAMES_SET } = require('../validation/common-first-names');
const { needsBrowserRendering, fetchWithBrowser, closeBrowser } = require('./browser-fetcher');
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

  // Identify generic emails (we'll keep them but de-prioritize)
  const genericEmails = /^(info|contact|hello|support|admin|enquiries|mail)@/i;

  // CRITICAL: Filter out image files and other non-email patterns
  // Images: .jpg, .jpeg, .png, .gif, .svg, .webp, .ico, etc.
  // Files: .js, .css, .pdf, .zip, etc.
  const fileExtensions = /\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff|js|css|pdf|zip|rar|doc|docx|xls|xlsx|mp4|mov|avi|mp3|wav)$/i;

  // Placeholder emails used in demos/templates
  const placeholderEmails = /^(mymail|user|yourname|example|test|email|name)@(mailservice|domain|example|test)\.(com|net|org)$/i;

  // Filter out junk, but KEEP generic emails (info@, contact@, enquiries@)
  const validEmails = [...new Set(emails)].filter(email => {
    // CRITICAL: Filter out file paths that match email pattern (e.g., "image@2x.jpg")
    if (fileExtensions.test(email)) return false;

    // Filter out emails with numbers in domain that look like image dimensions (e.g., "@2x", "@3x")
    if (/@\d+x\./i.test(email)) return false;

    // Filter out placeholder/demo emails
    if (placeholderEmails.test(email)) return false;

    return true;
  });

  // Sort emails: personal emails first, generic emails last
  // This ensures emails[0] is always the best available email
  return validEmails.sort((a, b) => {
    const aIsGeneric = genericEmails.test(a);
    const bIsGeneric = genericEmails.test(b);

    // Personal emails come first (lower sort value)
    if (!aIsGeneric && bIsGeneric) return -1;
    if (aIsGeneric && !bIsGeneric) return 1;

    // Otherwise maintain original order
    return 0;
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
      logger.debug('website-scraper', 'Detected sitemap index, following sub-sitemaps');
      // Follow sub-sitemaps one level deep (cap at 3 to limit requests)
      const subSitemapUrls = urls.filter(url => url.endsWith('.xml'));
      const allSubUrls = [];
      for (const subUrl of subSitemapUrls.slice(0, 3)) {
        try {
          const subXml = await fetchWebsite(subUrl, 5000);
          const subClean = subXml.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
          const subMatches = subClean.match(/<loc>(.*?)<\/loc>/g) || [];
          const subUrls = subMatches.map(m => m.replace(/<\/?loc>/g, '').trim());
          allSubUrls.push(...subUrls);
        } catch (e) {
          logger.debug('website-scraper', 'Sub-sitemap fetch failed', { url: subUrl, error: e.message });
        }
      }
      // Replace index URLs with actual page URLs
      urls = allSubUrls;
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
 * Extract relevant page links from homepage HTML (about, team, meet, contact pages)
 * Discovers pages like "/meet-nathan" that hardcoded paths would miss
 * @param {string} html - Homepage HTML content
 * @param {string} baseUrl - Base website URL for resolving relative links
 * @returns {Array<string>} Array of absolute URLs to check
 */
function extractNavLinks(html, baseUrl) {
  if (!html || !baseUrl) return [];

  try {
    const parsedBase = new URL(baseUrl);
    const sameDomain = parsedBase.hostname;

    // Match <a> tags with href containing relevant keywords
    const linkPattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    const relevantLinks = [];
    let match;

    while ((match = linkPattern.exec(html)) !== null) {
      const href = match[1].trim();
      const linkText = match[2].replace(/<[^>]+>/g, '').trim().toLowerCase();

      // Check if link text or URL path suggests an about/team/meet page
      const isRelevant =
        linkText.includes('meet') || linkText.includes('about') ||
        linkText.includes('team') || linkText.includes('who we are') ||
        linkText.includes('our story') || linkText.includes('founder') ||
        href.toLowerCase().includes('meet') || href.toLowerCase().includes('about') ||
        href.toLowerCase().includes('team') || href.toLowerCase().includes('founder');

      if (!isRelevant) continue;

      // Resolve relative URLs
      let fullUrl;
      try {
        if (href.startsWith('http')) {
          fullUrl = href;
        } else if (href.startsWith('/')) {
          fullUrl = `${parsedBase.protocol}//${sameDomain}${href}`;
        } else {
          fullUrl = `${parsedBase.protocol}//${sameDomain}/${href}`;
        }

        // Only include same-domain links
        const parsed = new URL(fullUrl);
        if (parsed.hostname === sameDomain) {
          relevantLinks.push(fullUrl);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }

    const unique = [...new Set(relevantLinks)];
    if (unique.length > 0) {
      logger.info('website-scraper', 'Found relevant nav links', {
        count: unique.length,
        urls: unique.slice(0, 5)
      });
    }

    return unique.slice(0, 5); // Cap at 5 to limit requests
  } catch (error) {
    logger.debug('website-scraper', 'Nav link extraction failed', { error: error.message });
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

  const text = html.replace(/<[^>]+>/g, '\n').replace(/[✓✗→←↑↓•·▸▹►▻★☆♠♣♥♦✔✘]/g, '').replace(/\s+/g, ' ');
  const names = [];

  // ── Shared validation function (used by ALL patterns) ──
  const isValidPersonName = (name) => {
    // Strip special characters (checkmarks, arrows, etc.) before validation
    name = name.replace(/[✓✗→←↑↓•·▸▹►▻★☆♠♣♥♦]/g, '').trim();

    // Reject common non-name words that get capitalized in sentences
    // Checked against ALL words in the name, not just the first
    const nonNameWords = /^(visiting|become|qualified|joined|graduated|gained|spent|completed|passed|achieved|acts|enjoys|says|lives|works|moved|returned|continued|successful|provides|offers|accepts|uses|finds|working|taking|playing|going|doing|making|having|being|getting|coming|looking|website|visit|contact|general|special|excellent|friendly|relaxed|committed|registered|professional|enhanced|extended|national|british|internal|external|modern|current|several|practice|service|dental|clinical|reception|treatment|gdc|chief|executive|business|development|sales|operations|marketing|finance|technical|digital|solutions|change|contractor|company|best|call|email|linkedin|certified|chartered|begum|ward|sports|client|main|social|media|care|message|umbrella|rachubka|attach|data|insurance|lead|construction|web|mixed|elimination|recurring|senior|junior|key|community|hybrid|cloud|packaging|support|every|top|survey|choose|managed|employment|engineering|machine|commercial|structural|independent|cutter|microsoft|google|account|programs|academic|alliance|end|customer|claims|information|security|experience|ethical|hours|meet|our|your|form|files|pixels|home|protection|diet|project|design|bank|vacancy|response|enquiry|tag|more|broking|salon|prices|expand|systems|accounts|payroll|admin|office|assistant|cosmetic|director|manager|xero|sage|quickbooks|gold|silver|bronze|platinum|premier|elite|award|partner|approved|accredited|private|residence|after|before|during|between|management|planning|consulting|trading|limited|group|holding|international|global|local|regional|central|eastern|western|northern|southern|following|collaborating|perspectives|front|house|kitchen|garden|room|studio|gallery|shop|store|centre|center|associate|specialist|assistant|trainee|intern|volunteer|freelance|temporary|permanent|full|part|time|free|consultation|today|book|schedule|request|enquire|quote|pricing|discount|offer|subscribe|download|upload|explore|discover|learn|read|watch|listen|view|browse|search|filter|apply|submit|register|login|signup|checkout|purchase|buy|order|delivery|shipping|payment|returns|guarantee|warranty|bespoke|luxury|outdoor|indoor|premium|standard|custom|handmade|sustainable|organic|natural|traditional|contemporary|affordable)$/i;

    const words = name.split(' ');
    // Check ALL words against nonNameWords (not just first)
    for (const word of words) {
      if (nonNameWords.test(word.toLowerCase())) {
        return false;
      }
    }

    // Reject if second word is a qualification (BDS, MSc, etc.)
    const secondWord = words[1];
    if (secondWord && /^(BDS|MBBS|MBChB|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Eng|ACCA|ACA|FCA|FCCA|ATT|CTA)$/i.test(secondWord)) {
      return false;
    }

    // Reject names ending with job-related words, qualifications, or country codes
    if (name.match(/\b(Dental|Lead|Senior|Junior|Practice|Team|Contact|About|University|School|College|Service|Care|General|Degree|Certificate|Diploma|Number|Website|Email|uk|usa|com|org|net|co|Executive|Officer|Manager|Sales|Operations|Marketing|Development|Change|Solutions|Professional|Client|Media|Linkedin|Managing|Home|Protection|Diet|Form|Files|Pixels|Bank|Project|Design|Vacancy|Response|Insurance|Cloud|Tag|Security|Engagement|Information|Account|Operators|Accountancy|Recruitment|Partnership|Architecture|Compliance|Technology|Approaches|Finance|Support|Systems|Accounts|Prices|Salon|Expand|Payroll|Admin|Office|Assistant|Cosmetic|Nurse|Hygienist|Therapist|Surgeon|Receptionist|Management|Residence|After|Before|Consulting|Trading|Limited|Group|Holding|International|Global|Studio|Gallery|Shop|Store|Centre|Center|Planning|Collaborating|Perspectives|Front|House|Kitchen|Garden|Room|Associate|Specialist|Trainee|Intern|Volunteer|Freelance)$/i)) {
      return false;
    }

    // Reject if contains lowercase articles or conjunctions
    if (name.match(/\b(the|and|as|an|of|in|on|at|to|for|with|from|by)\b/)) {
      return false;
    }

    // Require that both words start with uppercase and contain mostly lowercase
    for (const word of words) {
      if (!/^[A-Z][a-z]{1,}$/.test(word)) {
        return false;
      }
    }

    // Reject names where any word is a common short non-name fragment
    const shortFragments = /^(My|Su|Pl|Bh|Wy|Our|All|Top|End|New|Old|Red|Big|Att|Dom|Ads|Pr|Or|It|So|No)$/;
    if (words.some(w => shortFragments.test(w))) {
      return false;
    }

    // Require last name to be at least 3 characters (filters "My Su", "Kajal Bh" etc.)
    const lastName = words[words.length - 1];
    if (lastName.length < 3) {
      return false;
    }

    // Require exactly 2 or 3 words (a real person name)
    if (words.length < 2 || words.length > 3) {
      return false;
    }

    return name.length >= 5 && name.length <= 40;
  };

  // Pattern 1: Names with professional qualifications (BDS, MSc, PhD, ACCA, ACA, etc.)
  // e.g., "Christopher Needham BDS", "Andy Vause | BSc FCA", "Laura Gill BDS MJDF RCS Eng"
  // NOTE: No 'i' flag — name capture must be case-sensitive (proper nouns)
  const qualificationPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[|\u2013\u2014]?\s*(BDS|MBChB|MBBS|MD|PhD|BSc|MSc|MFDS|MJDF|RCS|NVQ|Level\s+\d|ACCA|ACA|FCA|FCCA|ATT|CTA|CIMA|CIPFA|[Bb][Dd][Ss]|[Bb][Ss][Cc]|[Mm][Ss][Cc]|[Pp][Hh][Dd])(?:\s+[A-Z][a-z]+|\s+RCS|\s+Eng|\s+\([A-Za-z]+\)|\s+in)?/g;
  let match;
  while ((match = qualificationPattern.exec(text)) !== null) {
    const rawName = match[1].trim();
    // Greedy regex may capture extra words — try progressively shorter names
    const nameWords = rawName.split(/\s+/);
    let validName = null;
    for (let len = Math.min(nameWords.length, 3); len >= 2; len--) {
      const candidate = nameWords.slice(0, len).join(' ');
      if (isValidPersonName(candidate)) {
        validName = candidate;
        break;
      }
    }
    if (validName) {
      const qualification = match[2].toUpperCase();
      names.push({ name: validName, title: qualification });
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
      let name = match[1].trim();
      // Greedy regex may capture too many words (e.g. "Mark Rogers Expand")
      // Try progressively shorter names until one passes validation
      const nameWords = name.split(/\s+/);
      let validName = null;
      for (let len = Math.min(nameWords.length, 3); len >= 2; len--) {
        const candidate = nameWords.slice(0, len).join(' ');
        if (isValidPersonName(candidate)) {
          validName = candidate;
          break;
        }
      }
      if (validName) {
        const titleMatch = match[0].match(/(Principal|Owner|Founder|Director|Managing Director|CEO|Proprietor|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)/i);
        names.push({ name: validName, title: titleMatch ? titleMatch[0] : null });
      }
    }
  }

  // Pattern 3: Context clues (founded by, started by, etc.)
  // e.g., "founded by Christopher Needham", "practice was started by Sarah Johnson"
  const contextPattern = /(?:founded|started|established|run|led|owned|joined|managed|graduated)\s+(?:by|from)\s+(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi;
  while ((match = contextPattern.exec(text)) !== null) {
    const rawName = match[1].trim();
    const nameWords = rawName.split(/\s+/);
    let validName = null;
    for (let len = Math.min(nameWords.length, 3); len >= 2; len--) {
      const candidate = nameWords.slice(0, len).join(' ');
      if (isValidPersonName(candidate)) {
        validName = candidate;
        break;
      }
    }
    if (validName) {
      names.push({ name: validName, title: 'Founder' });
    }
  }

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

  // Pattern 5: First-name-only from high-confidence contexts
  // Captures owner first names when no surname is given on the website
  // e.g., "Meet Nathan", "I'm Nathan", "Hello! I'm Nathan", "Hi, I'm Nathan"
  // Validated against common first names dictionary to prevent false positives
  const firstNamePatterns = [
    /\bMeet\s+([A-Z][a-z]{2,})\b/g,
    /\b(?:I'm|I am|I'm)\s+([A-Z][a-z]{2,})\b/g,
    /\b(?:Hi|Hello)!?\s*,?\s*(?:I'm|I am|I'm)\s+([A-Z][a-z]{2,})\b/g,
    /\bMy\s+name\s+is\s+([A-Z][a-z]{2,})\b/gi,
    /\bSay\s+[Hh]ello\s+to\s+[^.]{0,30}?\b([A-Z][a-z]{2,})\b/g
  ];

  for (const pattern of firstNamePatterns) {
    while ((match = pattern.exec(text)) !== null) {
      const firstName = match[1].trim();
      // Validate against common first names dictionary to avoid false positives
      if (COMMON_FIRST_NAMES_SET.has(firstName.toLowerCase()) &&
          !names.find(n => n.name.toLowerCase() === firstName.toLowerCase())) {
        names.push({ name: firstName, title: 'Owner', firstNameOnly: true });
        logger.info('website-scraper', 'Found first-name-only owner', { name: firstName, pattern: pattern.source.substring(0, 30) });
      }
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
 * Smart fetch: native HTTP first, Playwright fallback for JS-rendered sites
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in ms
 * @param {boolean} forceBrowser - Skip detection and use Playwright directly
 * @returns {Promise<string>} HTML content
 */
async function smartFetch(url, timeout = 10000, forceBrowser = false) {
  // If we already know the site needs a browser, skip native fetch
  if (forceBrowser) {
    const rendered = await fetchWithBrowser(url, 15000);
    if (rendered) return rendered;
    // Fall through to native fetch if Playwright fails
  }

  const html = await fetchWebsite(url, timeout);

  if (needsBrowserRendering(html)) {
    logger.info('website-scraper', 'JS-rendered site detected, using Playwright', { url });
    const rendered = await fetchWithBrowser(url, 15000);
    if (rendered) return rendered;
    // Fall back to native HTML if Playwright fails
    logger.warn('website-scraper', 'Playwright failed, using native HTML', { url });
  }

  return html;
}

/**
 * Scrape website for company information
 * @param {string} url - Website URL
 * @returns {Promise<Object>} Scraped data
 */
async function scrapeWebsite(url) {
  try {
    logger.info('website-scraper', 'Scraping website', { url });

    // Skip social media URLs - can't scrape useful data from them
    // Will add dedicated IG/FB module later for phone/email extraction
    if (url.includes('facebook.com') || url.includes('instagram.com') || url.includes('fb.com')) {
      logger.info('website-scraper', 'Skipping social media URL', { url });
      return {
        registrationNumber: null,
        registeredAddress: null,
        ownerNames: [],
        emails: [],
        scrapedAt: new Date().toISOString()
      };
    }

    // Fetch main page (native HTTP first, Playwright fallback for JS-rendered sites)
    let html = await fetchWebsite(url);
    let siteNeedsBrowser = false;

    if (needsBrowserRendering(html)) {
      logger.info('website-scraper', 'JS-rendered site detected, using Playwright', { url });
      const rendered = await fetchWithBrowser(url, 15000);
      if (rendered) {
        html = rendered;
        siteNeedsBrowser = true;
      }
    }

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
    // Prioritise team/contact/about pages — skip blog/news/insights unless we found nothing
    let sitemapUrls = await fetchSitemapUrls(url);
    const baseParsedUrl = new URL(url);

    // Split hardcoded paths into HIGH-PRIORITY (team/contact/about) and LOW-PRIORITY (blog/news)
    const highPriorityPaths = [
      '/contact', '/contact-us', '/contactus',
      '/team', '/meet-the-team', '/our-team', '/meet-the-team-subtitle', '/team-members',
      '/staff', '/people', '/directors',
      '/about', '/about-us', '/about-me', '/aboutus', '/about-us/meet-the-team'
    ];
    const lowPriorityPaths = ['/blog', '/insights', '/news'];

    // Also discover relevant pages from homepage navigation links (e.g., "Meet Nathan")
    const navLinks = extractNavLinks(html, url);

    let pagesToCheck;
    if (sitemapUrls.length > 0) {
      // Sitemap found — use its filtered URLs, then add any nav links not already covered
      const sitemapSet = new Set(sitemapUrls.map(u => u.toLowerCase()));
      const extraNavLinks = navLinks.filter(u => !sitemapSet.has(u.toLowerCase()));
      pagesToCheck = [...sitemapUrls.slice(0, 5), ...extraNavLinks.slice(0, 3)];
      logger.info('website-scraper', 'Using sitemap URLs + nav links', { sitemap: sitemapUrls.length, nav: extraNavLinks.length });
    } else {
      // No sitemap — use hardcoded paths + any discovered nav links
      const hardcodedUrls = highPriorityPaths.map(path => `${baseParsedUrl.protocol}//${baseParsedUrl.hostname}${path}`);
      const hardcodedSet = new Set(hardcodedUrls.map(u => u.toLowerCase()));
      const extraNavLinks = navLinks.filter(u => !hardcodedSet.has(u.toLowerCase()));
      pagesToCheck = [...hardcodedUrls, ...extraNavLinks.slice(0, 3)];
      logger.debug('website-scraper', 'Using hardcoded paths + nav links', { nav: extraNavLinks.length });
    }

    // SCRAPE TEAM/CONTACT/ABOUT PAGES: Find all team members
    // Smart exit: stop once we've found 3+ people from subpages (enough for multi-owner note)
    const MIN_PEOPLE_TARGET = 3;
    let allEmails = [...emails];
    let subpageNamesFound = 0;

    for (const pageUrl of pagesToCheck) {
      try {
        // If main page was JS-rendered, subpages will be too — go straight to Playwright
        const teamHtml = siteNeedsBrowser
          ? await smartFetch(pageUrl, 5000, true)
          : await fetchWebsite(pageUrl, 5000);

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
                hasEmailMatch: false,
                matchedEmail: null
              });
              subpageNamesFound++;
              logger.info('website-scraper', `Found name in meta description`, { name, url: pageUrl });
            }
          }
        }

        // Also extract from team page HTML content
        const teamNames = extractOwnerNames(teamHtml, allEmails);
        for (const name of teamNames) {
          if (!ownerNames.find(n => n.name.toLowerCase() === name.name.toLowerCase())) {
            ownerNames.push(name);
            subpageNamesFound++;
          }
        }
        if (teamNames.length > 0) {
          const pagePath = new URL(pageUrl).pathname;
          logger.info('website-scraper', `Found names on page`, { path: pagePath, count: teamNames.length });
        }

        // SMART EXIT: If we've found enough people from subpages, stop checking more
        if (subpageNamesFound >= MIN_PEOPLE_TARGET) {
          logger.info('website-scraper', 'Enough team members found, skipping remaining pages', {
            namesFound: subpageNamesFound,
            totalNames: ownerNames.length,
            pagesChecked: pagesToCheck.indexOf(pageUrl) + 1,
            pagesTotal: pagesToCheck.length
          });
          break;
        }
      } catch (error) {
        // Team page fetch failed - not critical, try next one
        logger.debug('website-scraper', `Could not fetch page`, { url: pageUrl, error: error.message });
      }
    }

    // LOW-PRIORITY FALLBACK: Only check blog/news if we found NO people from high-priority pages
    if (subpageNamesFound === 0 && sitemapUrls.length === 0) {
      const lowPriorityUrls = lowPriorityPaths.map(path => `${baseParsedUrl.protocol}//${baseParsedUrl.hostname}${path}`);
      for (const pageUrl of lowPriorityUrls) {
        try {
          const html = siteNeedsBrowser
            ? await smartFetch(pageUrl, 5000, true)
            : await fetchWebsite(pageUrl, 5000);

          const pageEmails = extractEmails(html);
          allEmails = [...new Set([...allEmails, ...pageEmails])];

          const pageNames = extractOwnerNames(html, allEmails);
          for (const name of pageNames) {
            if (!ownerNames.find(n => n.name.toLowerCase() === name.name.toLowerCase())) {
              ownerNames.push(name);
            }
          }
          if (pageNames.length > 0) {
            const pagePath = new URL(pageUrl).pathname;
            logger.info('website-scraper', `Found names on low-priority page`, { path: pagePath, count: pageNames.length });
            break; // Found something on a low-priority page, stop
          }
        } catch (error) {
          logger.debug('website-scraper', `Could not fetch low-priority page`, { url: pageUrl, error: error.message });
        }
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

    // Clean up browser if it was launched
    await closeBrowser();

    return result;
  } catch (error) {
    logger.error('website-scraper', 'Website scraping failed', { url, error: error.message });
    await closeBrowser();
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
  extractEmails,
  parseName,
  fetchWebsite
};
