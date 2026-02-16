/**
 * Data Quality Validation Module
 * Centralized validation for lead data quality
 *
 * Provides functions to:
 * - Validate person names (reject job titles, common words, UI elements)
 * - Extract names from email addresses
 * - Validate email formats (reject image files, invalid formats)
 * - Validate leads before export
 * - Calculate lead confidence scores
 */

const logger = require('../logger');
const { COMMON_FIRST_NAMES, COMMON_FIRST_NAMES_SET } = require('./common-first-names');

// Job title patterns to REJECT
const JOB_TITLE_WORDS = [
  'senior', 'junior', 'lead', 'chief', 'head', 'principal', 'assistant',
  'manager', 'director', 'officer', 'specialist', 'coordinator',
  'administrator', 'executive', 'supervisor', 'receptionist', 'nurse',
  'practice', 'office', 'clinic', 'dental', 'medical', 'sales',
  'marketing', 'hr', 'it', 'tech', 'support', 'team', 'staff',
  'associate', 'partner', 'consultant', 'analyst', 'engineer',
  'developer', 'designer', 'architect', 'technician', 'therapist',
  'hygienist', 'surgeon', 'physician', 'doctor', 'professor',
  'management', 'certified', 'chartered', 'operators', 'protection',
  'commercial', 'structural', 'financial', 'professional'
];

// Common words/UI elements to REJECT
const COMMON_WORDS = [
  'there', 'here', 'hello', 'welcome', 'contact', 'about',
  'web', 'website', 'pixels', 'banner', 'logo', 'icon',
  'image', 'photo', 'header', 'footer', 'menu', 'navigation',
  'button', 'link', 'page', 'home', 'our', 'team',
  'meet', 'visit', 'call', 'email', 'phone', 'address',
  'location', 'directions', 'hours', 'services', 'products',
  'client', 'cosmetic', 'law', 'bank', 'employment', 'independent',
  'case',
  // Business/industry words that get scraped as names
  'accountancy', 'accounting', 'insurance', 'structural', 'consulting',
  'community', 'engineering', 'recruitment', 'construction', 'architectural',
  'digital', 'response', 'approaches', 'solutions', 'associates',
  'partnership', 'enterprises', 'holdings', 'group', 'limited', 'ltd',
  'plc', 'inc', 'corp', 'company',
  // Words from website scraping artifacts
  'attach', 'files', 'survey', 'socials', 'recurring', 'mixed',
  'cutter', 'elimination', 'diet', 'managed', 'businesses',
  'choose', 'select', 'submit', 'download', 'upload', 'subscribe',
  // Short words that appear as broken first names
  'my', 'su', 'pl', 'bh',
  // Venue/object words extracted from emails
  'aviator', 'sanctuary', 'salon', 'gourmet', 'lounge', 'heaven',
  'trunk', 'opus', 'cafe', 'restaurant', 'bar', 'pub', 'inn', 'hotel'
];

// Business descriptor words that should NEVER be a last name
const BAD_LAST_NAME_WORDS = [
  'accountancy', 'accounting', 'insurance', 'structural', 'response',
  'approaches', 'protection', 'diet', 'law', 'operators', 'businesses',
  'management', 'certified', 'files', 'su', 'pl', 'bh',
  'client', 'survey', 'consulting', 'solutions', 'services',
  'recruitment', 'engineering', 'construction', 'commercial',
  'community', 'digital', 'financial', 'professional',
  'associates', 'partnership', 'enterprises', 'holdings', 'group',
  'limited', 'ltd', 'plc', 'inc', 'corp', 'company'
];

// Location words that get scraped as names
const LOCATION_WORDS = [
  'birmingham', 'manchester', 'london', 'stockport', 'bramhall',
  'cheadle', 'cheshire', 'yorkshire', 'lancashire', 'aldridge',
  'alderley', 'poynton', 'wilmslow', 'macclesfield', 'buxton',
  'hazel', 'grove', 'marple', 'hyde', 'glossop', 'whaley',
  'edinburgh', 'glasgow', 'bristol', 'liverpool', 'leeds',
  'sheffield', 'nottingham', 'derby', 'leicester', 'coventry'
];

// Email domains that are internal tracking systems, not business emails
const BLOCKED_EMAIL_DOMAINS = [
  'sentry.io', 'sentry-next.wixpress.com', 'wixpress.com',
  'sentry.wixpress.com', 'wordpress.com', 'squarespace.com',
  'wix.com', 'mailchimp.com', 'hubspot.com', 'salesforce.com'
];

// Known short surnames (2-3 chars) that are legitimate
// Used to allow splits like "saragil" → "Sara Gil" despite < 4 char remainder
const KNOWN_SHORT_SURNAMES = new Set([
  // Western
  'ali', 'ash', 'bay', 'box', 'cox', 'cup', 'day', 'dee', 'dow', 'dye',
  'fay', 'fox', 'fry', 'gay', 'hay', 'hoy', 'jay', 'joy', 'kay', 'key',
  'law', 'lay', 'lee', 'low', 'may', 'moy', 'nay', 'nye', 'orr',
  'ott', 'poe', 'rae', 'ray', 'roe', 'row', 'roy', 'rue', 'rye',
  'say', 'shy', 'woo', 'yeo',
  // Scandinavian
  'ahl', 'ask', 'dal', 'ek', 'lie', 'vik',
  // Spanish / Portuguese
  'gil', 'luz', 'paz', 'sol', 'vaz',
  // South Asian
  'bai', 'das', 'dey', 'kar', 'nag', 'pal', 'rai', 'rao', 'roy', 'sen', 'sur',
  // East Asian (keep short)
  'ai', 'do', 'he', 'ho', 'hu', 'ko', 'le', 'li', 'lo', 'lu', 'ly',
  'ma', 'ng', 'qi', 'wu', 'xu', 'ye', 'yu',
]);

// Image file patterns
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|svg|webp|bmp|ico|tiff)$/i;
const IMAGE_SIZE_PATTERN = /\d+x\d+@/;
const IMAGE_DESCRIPTOR_PATTERN = /(logo|icon|banner|header|footer|brandmark|badge|thumb|avatar)_/i;

/**
 * Strip titles/prefixes from name
 * Removes: Dr., Mr., Mrs., Ms., Miss, Rev., Prof.
 * @param {string} name - Name with potential title prefix
 * @returns {string} Name without title prefix
 */
function stripTitles(name) {
  if (!name) return '';

  const titles = ['Dr.', 'Dr', 'Mr.', 'Mr', 'Mrs.', 'Mrs', 'Ms.', 'Ms', 'Miss', 'Rev.', 'Prof.', 'Professor'];
  let cleaned = name.trim();

  for (const title of titles) {
    if (cleaned.startsWith(title + ' ')) {
      cleaned = cleaned.substring(title.length + 1).trim();
    }
  }

  return cleaned;
}

/**
 * Validate if string is a valid person's name
 * Rejects job titles, common words, and UI elements
 *
 * @param {string} name - Name to validate
 * @returns {boolean} True if valid person name
 *
 * @example
 * isValidPersonName('Andrew Smith')  // true
 * isValidPersonName('Senior Specialist')  // false (job title)
 * isValidPersonName('there')  // false (common word)
 * isValidPersonName('Web Pixels')  // false (UI element)
 */
function isValidPersonName(name) {
  if (!name || typeof name !== 'string') return false;

  const cleaned = stripTitles(name.trim());
  if (cleaned.length < 2) return false;

  // Must contain at least one letter
  if (!/[a-zA-Z]/.test(cleaned)) return false;

  // Reject names containing digits (e.g., "Bali1room" from email extraction)
  if (/\d/.test(cleaned)) {
    logger.debug('data-quality', 'Name rejected: contains digits', { name });
    return false;
  }

  // Reject single-word names longer than 15 chars (likely compound words from emails)
  // e.g., "Dataprotectionofficer", "Cheatdazebradford"
  const words = cleaned.toLowerCase().split(/\s+/);
  if (words.length === 1 && cleaned.length > 15) {
    logger.debug('data-quality', 'Name rejected: single word too long (likely compound)', { name, length: cleaned.length });
    return false;
  }

  // Reject 2-char names that aren't known short names (even single words)
  if (cleaned.length <= 2) {
    const knownShortNames = new Set(['al', 'bo', 'ed', 'jo', 'li', 'mo', 'ty', 'ai', 'lu', 'yi']);
    if (!knownShortNames.has(cleaned.toLowerCase())) {
      logger.debug('data-quality', 'Name rejected: too short and not a known name', { name });
      return false;
    }
  }

  for (const word of words) {
    // Reject if word is in job title list
    if (JOB_TITLE_WORDS.includes(word)) {
      logger.debug('data-quality', 'Name rejected: contains job title word', {
        name,
        rejectedWord: word
      });
      return false;
    }

    // Reject if word is in common words list
    if (COMMON_WORDS.includes(word)) {
      logger.debug('data-quality', 'Name rejected: contains common word', {
        name,
        rejectedWord: word
      });
      return false;
    }

    // Reject if word is a location name
    if (LOCATION_WORDS.includes(word)) {
      logger.debug('data-quality', 'Name rejected: contains location word', {
        name,
        rejectedWord: word
      });
      return false;
    }
  }

  // Reject very short first names (likely initials or fragments)
  const firstName = words[0];
  if (firstName && firstName.length === 1 && words.length === 1) {
    return false;
  }

  // Reject if first name is only 2 chars and not a known short name
  if (firstName && firstName.length <= 2 && words.length > 1) {
    const knownShortFirstNames = new Set(['al', 'bo', 'ed', 'jo', 'li', 'mo', 'ty']);
    if (!knownShortFirstNames.has(firstName)) {
      logger.debug('data-quality', 'Name rejected: suspiciously short first name', {
        name,
        firstName
      });
      return false;
    }
  }

  return true;
}

/**
 * Validate a first name + last name pair for export
 * Catches patterns that slip through single-name validation
 * e.g., "Cheshire Structural", "Wilson Accountancy", "My Su"
 *
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @returns {boolean} True if valid name pair
 */
function isValidNamePair(firstName, lastName) {
  if (!firstName || typeof firstName !== 'string') return false;

  const first = firstName.toLowerCase().trim();
  const last = (lastName || '').toLowerCase().trim();

  // "there" is the valid fallback - allow it
  if (first === 'there') return true;

  // Names ending in "Team" are valid fallbacks (e.g., "CRO Info Team")
  if (first.endsWith(' team') || last === 'team') return true;

  // First check: both parts must pass individual validation
  if (!isValidPersonName(firstName)) return false;

  // Last name checks (catches "Wilson Accountancy", "Cheshire Structural", etc.)
  if (last.length > 0) {
    if (BAD_LAST_NAME_WORDS.includes(last)) {
      logger.debug('data-quality', 'Name pair rejected: bad last name word', {
        firstName, lastName, rejectedWord: last
      });
      return false;
    }

    // Multi-word last names that are clearly not names
    const lastWords = last.split(/\s+/);
    for (const word of lastWords) {
      if (BAD_LAST_NAME_WORDS.includes(word)) {
        logger.debug('data-quality', 'Name pair rejected: bad word in last name', {
          firstName, lastName, rejectedWord: word
        });
        return false;
      }
    }

    // Very short last name that's not a real surname
    if (last.length <= 2) {
      const realShortSurnames = new Set([
        'li', 'wu', 'xu', 'ye', 'ma', 'he', 'hu', 'lu', 'ng',
        'ho', 'lo', 'ko', 'do', 'le', 'ly', 'qi', 'yu', 'ai'
      ]);
      if (!realShortSurnames.has(last)) {
        logger.debug('data-quality', 'Name pair rejected: suspicious short last name', {
          firstName, lastName
        });
        return false;
      }
    }
  }

  return true;
}

/**
 * Try to split a concatenated email username into firstName + lastName
 * using a dictionary of common first names.
 *
 * Algorithm:
 * 1. Try each known first name (longest first) as a prefix
 * 2. If match found, check remaining part is a plausible surname (>= 4 chars, valid)
 * 3. Return "FirstName LastName" or null if no valid split
 *
 * @param {string} username - Lowercase email username (no separators)
 * @returns {string|null} "FirstName LastName" or null
 *
 * @example
 * trySplitConcatenatedName('kategymer')    // "Kate Gymer"
 * trySplitConcatenatedName('jamessmith')   // "James Smith"
 * trySplitConcatenatedName('markham')      // null (ham < 4 chars)
 * trySplitConcatenatedName('peter')        // null (no valid remainder)
 */
function trySplitConcatenatedName(username) {
  const lower = username.toLowerCase();

  // Track the longest first name that matched but was rejected (surname too short).
  // If "robert" matched in "robertson" but "son" was too short, don't try "rob"
  // because the user is likely "Robertson", not "Rob Ertson".
  let longestRejectedMatch = 0;

  // COMMON_FIRST_NAMES is pre-sorted by length descending (longest match first)
  for (const name of COMMON_FIRST_NAMES) {
    if (lower.startsWith(name) && lower.length > name.length) {
      // Skip shorter names if a longer name already matched this prefix
      if (name.length < longestRejectedMatch) continue;

      const remainder = lower.substring(name.length);

      // Surname length check:
      // - If remainder is in KNOWN_SHORT_SURNAMES → allow (even 2-3 chars)
      // - Otherwise must be at least 4 chars to avoid false splits
      //   e.g., "markham" → "mark" + "ham" (3 chars) → rejected
      if (remainder.length < 4 && !KNOWN_SHORT_SURNAMES.has(remainder)) {
        longestRejectedMatch = Math.max(longestRejectedMatch, name.length);
        continue;
      }

      // Surname must contain at least one vowel-like character (pronounceability)
      // Includes Unicode vowels for Scandinavian/European names (ø, ö, ü, etc.)
      if (!/[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿ]/i.test(remainder)) continue;

      // For known short surnames, skip the full validation (they're already vetted)
      // For longer surnames, must pass name validation (not a blocklisted word)
      if (!KNOWN_SHORT_SURNAMES.has(remainder)) {
        const capitalizedSurname = remainder.charAt(0).toUpperCase() + remainder.slice(1);
        if (!isValidPersonName(capitalizedSurname)) continue;
      }

      // Valid split found
      const firstName = name.charAt(0).toUpperCase() + name.slice(1);
      const capitalizedSurname = remainder.charAt(0).toUpperCase() + remainder.slice(1);
      logger.info('data-quality', 'Split concatenated email name', {
        username,
        firstName,
        lastName: capitalizedSurname
      });

      return `${firstName} ${capitalizedSurname}`;
    }
  }

  return null;
}

/**
 * Extract name from email username
 * Parses the part before @ and capitalizes appropriately.
 *
 * Extraction chain:
 * 1. Reject generic/hash usernames
 * 2. If has separators (. _ -): split and validate each part
 * 3. If no separators:
 *    a. If whole username is a known first name → use it
 *    b. Try dictionary-based split (e.g., "kategymer" → "Kate Gymer")
 *    c. If short enough and passes validation → use as single name
 * 4. Return null if nothing works
 *
 * @param {string} email - Email address
 * @returns {string|null} Extracted name or null if invalid
 *
 * @example
 * extractNameFromEmail('andrew@business.co.uk')          // "Andrew"
 * extractNameFromEmail('sarah.johnson@dental.co.uk')     // "Sarah Johnson"
 * extractNameFromEmail('kategymer@owlbookkeeper.com')    // "Kate Gymer"
 * extractNameFromEmail('info@business.com')              // null (generic)
 */
function extractNameFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return null;
  }

  const username = email.split('@')[0];
  const lowerUsername = username.toLowerCase();

  // Reject generic usernames
  const genericUsernames = [
    'info', 'contact', 'hello', 'admin', 'support', 'enquiries',
    'mail', 'sales', 'office', 'reception', 'help', 'team',
    'enquiry', 'general', 'main', 'service', 'booking', 'appointments',
    'marketing', 'accounts', 'billing', 'orders', 'hr', 'jobs',
    'careers', 'press', 'media', 'news', 'webmaster', 'postmaster',
    'noreply', 'no-reply', 'donotreply'
  ];

  if (genericUsernames.includes(lowerUsername)) {
    logger.debug('data-quality', 'Email username rejected: generic', { email, username });
    return null;
  }

  // Reject if username looks like a hash, ID, or random string
  if (/^[0-9a-f]{8,}$/i.test(username) || /^\d+$/.test(username)) {
    logger.debug('data-quality', 'Email username rejected: hash/ID pattern', { email, username });
    return null;
  }

  // Additional rejection: business/location words in the username
  const badEmailWords = [
    'sandwich', 'bramhall', 'manchester', 'london', 'alderley', 'cheadle',
    'stockport', 'cheshire', 'yorkshire', 'cafe', 'restaurant', 'salon',
    'hairdressing', 'beauty', 'dental', 'accountants', 'chartered',
    'enquiries', 'bookings', 'reservations'
  ];

  if (badEmailWords.some(bad => lowerUsername.includes(bad))) {
    logger.debug('data-quality', 'Email username rejected: business/location word', { email, username });
    return null;
  }

  // ── SEPARATED USERNAMES (has . _ or -) ──
  const parts = username.split(/[._-]/);

  if (parts.length > 1) {
    // Multi-part: capitalize each part
    const capitalized = parts
      .filter(part => part.length > 0)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');

    if (isValidPersonName(capitalized)) {
      logger.info('data-quality', 'Successfully extracted name from email', {
        email, extractedName: capitalized
      });
      return capitalized;
    }

    logger.debug('data-quality', 'Extracted name from email failed validation', {
      email, extractedName: capitalized
    });
    return null;
  }

  // ── SINGLE-PART USERNAME (no separators) ──

  // Check if the whole username is a known blocklist word → skip entirely
  const allBlocklists = [...JOB_TITLE_WORDS, ...COMMON_WORDS, ...LOCATION_WORDS];
  if (allBlocklists.includes(lowerUsername)) {
    logger.debug('data-quality', 'Email username rejected: blocklisted word', { email, username });
    return null;
  }

  // Step A: If the whole username is a known first name, use it directly
  // This prevents splitting "rosemary" → "Rose Mary" when "Rosemary" is a real name
  if (COMMON_FIRST_NAMES_SET.has(lowerUsername)) {
    const capitalized = lowerUsername.charAt(0).toUpperCase() + lowerUsername.slice(1);
    logger.info('data-quality', 'Email username is a known first name', {
      email, extractedName: capitalized
    });
    return capitalized;
  }

  // Step B: Try dictionary-based split for concatenated names
  // e.g., "kategymer" → "Kate Gymer", "jamessmith" → "James Smith"
  if (lowerUsername.length >= 6) {
    const splitResult = trySplitConcatenatedName(lowerUsername);
    if (splitResult) {
      logger.info('data-quality', 'Successfully extracted name from email via dictionary split', {
        email, extractedName: splitResult
      });
      return splitResult;
    }
  }

  // Step C: Try as a single name (short usernames that pass validation)
  const capitalized = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
  if (isValidPersonName(capitalized)) {
    logger.info('data-quality', 'Successfully extracted name from email', {
      email, extractedName: capitalized
    });
    return capitalized;
  }

  logger.debug('data-quality', 'Email username could not be parsed as a name', {
    email, username
  });
  return null;
}

/**
 * Validate email address
 * Rejects image files, invalid formats, and placeholder emails
 *
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid email
 *
 * @example
 * isValidEmail('andrew@business.com')  // true
 * isValidEmail('back-header-164×300@2x.jpg')  // false (image file)
 * isValidEmail('email@example.com')  // false (placeholder)
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (!email.includes('@') || email.length > 254) return false;

  // Reject image files
  if (IMAGE_EXTENSIONS.test(email)) {
    logger.warn('data-quality', 'Email rejected: image file extension', { email });
    return false;
  }

  if (IMAGE_SIZE_PATTERN.test(email)) {
    logger.warn('data-quality', 'Email rejected: image size pattern', { email });
    return false;
  }

  if (IMAGE_DESCRIPTOR_PATTERN.test(email)) {
    logger.warn('data-quality', 'Email rejected: image descriptor pattern', { email });
    return false;
  }

  // Reject placeholder emails
  const placeholders = ['example.com', 'test.com', 'email@example', 'test@test'];
  const lowerEmail = email.toLowerCase();

  for (const placeholder of placeholders) {
    if (lowerEmail.includes(placeholder)) {
      logger.warn('data-quality', 'Email rejected: placeholder pattern', { email });
      return false;
    }
  }

  // Reject internal tracking/platform emails (sentry, wix, etc.)
  const domain = lowerEmail.split('@')[1];
  if (domain && BLOCKED_EMAIL_DOMAINS.some(blocked => domain === blocked || domain.endsWith('.' + blocked))) {
    logger.warn('data-quality', 'Email rejected: blocked internal/tracking domain', { email, domain });
    return false;
  }

  // Reject hex hash usernames (sentry IDs, tracking tokens)
  const username = lowerEmail.split('@')[0];
  if (/^[a-f0-9]{16,}$/.test(username)) {
    logger.warn('data-quality', 'Email rejected: hex hash username (tracking ID)', { email });
    return false;
  }

  // Basic email format validation (RFC 5322 simplified)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailRegex.test(email)) {
    logger.warn('data-quality', 'Email rejected: invalid format', { email });
    return false;
  }

  return true;
}

/**
 * Validate lead data before export to Lemlist
 * Checks all critical fields for quality issues
 *
 * @param {Object} lead - Business/lead object to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 *
 * @example
 * validateLeadForExport({ ownerEmail: 'test@business.com', ownerFirstName: 'Sarah', emailVerified: true })
 * // { valid: true, errors: [] }
 *
 * validateLeadForExport({ ownerEmail: 'back-header@2x.jpg', ownerFirstName: 'there' })
 * // { valid: false, errors: ['Invalid email format', 'Invalid firstName'] }
 */
function validateLeadForExport(lead) {
  const errors = [];

  // Check 1: Email must exist and be valid
  if (!lead.ownerEmail) {
    errors.push('Missing email');
  } else if (!isValidEmail(lead.ownerEmail)) {
    errors.push(`Invalid email format: ${lead.ownerEmail}`);
  }

  // Check 2: Email must be verified (CRITICAL - prevents bounces)
  // Strict check: ONLY emailVerified=true passes, everything else fails
  if (lead.emailVerified !== true) {
    errors.push(`Email not verified (emailVerified=${lead.emailVerified})`);
  }

  // Check 3: firstName must exist and be valid
  if (!lead.ownerFirstName || lead.ownerFirstName.length < 2) {
    errors.push('Missing firstName');
  } else if (!isValidPersonName(lead.ownerFirstName)) {
    errors.push(`Invalid firstName: "${lead.ownerFirstName}" (likely job title or common word)`);
  }

  // Check 3b: firstName + lastName pair must be valid (catches "Cheshire Structural", "My Su", etc.)
  if (lead.ownerFirstName && lead.ownerFirstName !== 'there' &&
      !isValidNamePair(lead.ownerFirstName, lead.ownerLastName)) {
    errors.push(`Invalid name pair: "${lead.ownerFirstName} ${lead.ownerLastName || ''}" (likely business/location name)`);
  }

  // Check 4: Company name must exist
  if (!lead.businessName && !lead.name) {
    errors.push('Missing company name');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Calculate lead confidence score (0-100)
 * Based on data quality indicators
 *
 * @param {Object} lead - Business/lead object
 * @returns {number} Confidence score 0-100
 *
 * Higher scores indicate better lead quality:
 * - 80-100: High confidence (verified email, valid name, premium source)
 * - 50-79: Medium confidence (some quality indicators)
 * - 0-49: Low confidence (missing data or unverified)
 */
function calculateLeadConfidence(lead) {
  let score = 0;

  // Email quality (40 points max)
  if (lead.ownerEmail && isValidEmail(lead.ownerEmail)) {
    score += 20;
    if (lead.emailVerified === true) {
      score += 20; // Verified email is critical
    }
  }

  // Name quality (30 points max)
  if (lead.ownerFirstName && isValidPersonName(lead.ownerFirstName)) {
    score += 15;
    if (lead.ownerLastName && lead.ownerLastName.length > 0) {
      score += 15;
    }
  }

  // Source quality (20 points max)
  const source = lead.emailSource || lead.source;
  if (source === 'icypeas') {
    score += 20; // Premium API, highest confidence
  } else if (source === 'pattern_verified' || source === 'pattern') {
    score += 15; // Verified pattern match
  } else if (source === 'website') {
    score += 10; // Direct website extraction
  }

  // Additional data (10 points max)
  if (lead.linkedInUrl || lead.linkedin) {
    score += 5;
  }
  if (lead.phone || lead.phoneNumber) {
    score += 5;
  }

  return Math.min(score, 100);
}

module.exports = {
  // Core validation functions
  isValidPersonName,
  isValidNamePair,
  extractNameFromEmail,
  trySplitConcatenatedName,
  isValidEmail,
  validateLeadForExport,
  calculateLeadConfidence,

  // Helper functions
  stripTitles,

  // Export constants for testing
  JOB_TITLE_WORDS,
  COMMON_WORDS,
  BAD_LAST_NAME_WORDS,
  LOCATION_WORDS,
  BLOCKED_EMAIL_DOMAINS
};
