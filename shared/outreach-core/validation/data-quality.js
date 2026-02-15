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
  'management', 'certified', 'chartered'
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
  'case', 'begum', 'allen'
];

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

  // Check each word against blacklists
  const words = cleaned.toLowerCase().split(/\s+/);

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
  }

  // Reject very short first names (likely initials or fragments)
  const firstName = words[0];
  if (firstName && firstName.length === 1 && words.length === 1) {
    return false;
  }

  return true;
}

/**
 * Extract name from email username
 * Parses the part before @ and capitalizes appropriately
 *
 * @param {string} email - Email address
 * @returns {string|null} Extracted name or null if invalid
 *
 * @example
 * extractNameFromEmail('andrew@themountingstone.co.uk')  // "Andrew"
 * extractNameFromEmail('sarah.johnson@dental.co.uk')  // "Sarah Johnson"
 * extractNameFromEmail('j.smith@example.com')  // "J Smith"
 * extractNameFromEmail('info@business.com')  // null (generic)
 */
function extractNameFromEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return null;
  }

  const username = email.split('@')[0];

  // Reject generic usernames
  const genericUsernames = [
    'info', 'contact', 'hello', 'admin', 'support', 'enquiries',
    'mail', 'sales', 'office', 'reception', 'help', 'team',
    'enquiry', 'general', 'main', 'service', 'booking', 'appointments'
  ];

  if (genericUsernames.includes(username.toLowerCase())) {
    logger.debug('data-quality', 'Email username rejected: generic', {
      email,
      username
    });
    return null;
  }

  // Reject if username looks like a hash, ID, or random string
  if (/^[0-9a-f]{8,}$/i.test(username) || /^\d+$/.test(username)) {
    logger.debug('data-quality', 'Email username rejected: hash/ID pattern', {
      email,
      username
    });
    return null;
  }

  // Parse username parts (split on dots, underscores, dashes)
  const parts = username.split(/[._-]/);

  // Capitalize each part
  const capitalized = parts
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  // Additional rejection patterns for email-extracted names
  const badEmailNames = [
    'sandwich', 'bramhall', 'manchester', 'london', 'alderley', 'cheadle',
    'stockport', 'cheshire', 'yorkshire', 'cafe', 'restaurant', 'salon',
    'hairdressing', 'beauty', 'dental', 'accountants', 'chartered'
  ];

  const lowerCapitalized = capitalized.toLowerCase();
  if (badEmailNames.some(bad => lowerCapitalized.includes(bad))) {
    logger.debug('data-quality', 'Extracted name from email rejected: business/location word', {
      email,
      extractedName: capitalized
    });
    return null;
  }

  // Validate extracted name
  if (!isValidPersonName(capitalized)) {
    logger.debug('data-quality', 'Extracted name from email failed validation', {
      email,
      extractedName: capitalized
    });
    return null;
  }

  logger.info('data-quality', 'Successfully extracted name from email', {
    email,
    extractedName: capitalized
  });

  return capitalized;
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
  extractNameFromEmail,
  isValidEmail,
  validateLeadForExport,
  calculateLeadConfidence,

  // Helper functions
  stripTitles,

  // Export constants for testing
  JOB_TITLE_WORDS,
  COMMON_WORDS
};
