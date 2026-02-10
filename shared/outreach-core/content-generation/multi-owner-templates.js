/**
 * Multi-Owner Email Templates
 * Generates dynamic greetings and transparency paragraphs for emails to multiple business owners
 */

/**
 * Generate greeting for multiple owners
 * @param {Array<Object>} owners - Array of owner objects with firstName
 * @returns {string} Formatted greeting (e.g., "Hi Sarah and John,")
 */
function generateGreeting(owners) {
  if (!owners || owners.length === 0) {
    return "Hi there,";
  }

  const firstNames = owners
    .map(owner => owner.firstName)
    .filter(name => name && name.trim());

  if (firstNames.length === 0) {
    return "Hi there,";
  }

  if (firstNames.length === 1) {
    return `Hi ${firstNames[0]},`;
  }

  if (firstNames.length === 2) {
    return `Hi ${firstNames[0]} and ${firstNames[1]},`;
  }

  // 3 or more: "Hi Sarah, John, and Michael,"
  const allButLast = firstNames.slice(0, -1);
  const last = firstNames[firstNames.length - 1];
  return `Hi ${allButLast.join(', ')}, and ${last},`;
}

/**
 * Generate transparency paragraph for multi-owner emails
 * @param {Array<Object>} owners - Array of owner objects
 * @returns {string} Transparency paragraph (or empty string if single owner)
 */
function generateTransparencyParagraph(owners) {
  if (!owners || owners.length <= 1) {
    return ""; // No transparency paragraph needed for single owner
  }

  return "I wasn't sure which of you would be the best person to speak with about this, so I'm reaching out to everyone. Hope that's okay!";
}

/**
 * Generate closing line for multi-owner emails
 * @param {Array<Object>} owners - Array of owner objects
 * @returns {string} Closing line (or empty string if single owner)
 */
function generateClosingLine(owners) {
  if (!owners || owners.length <= 1) {
    return ""; // No closing line needed for single owner
  }

  return "Please let me know which one of you is the best to chat with regarding this.";
}

/**
 * Remove existing greeting from email body
 * Handles various greeting formats including edge cases
 * @param {string} body - Email body content
 * @returns {string} Body with greeting removed
 */
function removeExistingGreeting(body) {
  if (!body || typeof body !== 'string') {
    return body;
  }

  // Pattern to match common greetings
  // Matches: "Hi Name," "Hey Name," "Hello Name," with optional whitespace
  // Handles multiple names: "Hi Sarah and John," "Hi Sarah, John, and Mike,"
  const greetingPatterns = [
    // Standard greetings with name(s)
    /^(Hi|Hey|Hello)\s+[^,\n]+,?\s*\n*/im,
    // Greetings with "there" or "team"
    /^(Hi|Hey|Hello)\s+(there|team),?\s*\n*/im,
    // Greetings with multiple people (comma-separated)
    /^(Hi|Hey|Hello)\s+[^,]+(,\s+[^,]+)*\s+and\s+[^,]+,?\s*\n*/im,
    // Very short greetings (just "Hi," or "Hey,")
    /^(Hi|Hey|Hello),?\s*\n*/im
  ];

  let cleanedBody = body;
  
  for (const pattern of greetingPatterns) {
    cleanedBody = cleanedBody.replace(pattern, '');
  }

  return cleanedBody;
}

/**
 * Generate complete email body with multi-owner support
 * @param {string} baseBody - Base email body content
 * @param {Array<Object>} owners - Array of owner objects
 * @returns {string} Complete email body with greeting, transparency, and closing
 */
function generateMultiOwnerEmailBody(baseBody, owners) {
  const greeting = generateGreeting(owners);
  const transparency = generateTransparencyParagraph(owners);
  const closing = generateClosingLine(owners);

  // Remove "Subject:" line if present (Claude sometimes includes it)
  let cleanedBody = baseBody.replace(/^Subject:.*?\n+/im, '');

  // Remove any existing greeting using improved regex
  cleanedBody = removeExistingGreeting(cleanedBody);

  // Extract "Sent from my iPhone" if present (will re-add at the end)
  let signature = "";
  const signatureMatch = cleanedBody.match(/\n\nSent from my iPhone\s*$/);
  if (signatureMatch) {
    signature = "Sent from my iPhone";
    cleanedBody = cleanedBody.replace(/\n\nSent from my iPhone\s*$/, '');
  }

  // Trim any leading/trailing whitespace
  cleanedBody = cleanedBody.trim();

  // Build final email
  let emailParts = [greeting];

  if (cleanedBody) {
    emailParts.push(cleanedBody);
  }

  if (transparency) {
    emailParts.push(transparency);
  }

  if (closing) {
    emailParts.push(closing);
  }

  if (signature) {
    emailParts.push(signature);
  }

  return emailParts.join('\n\n');
}

/**
 * Get all email addresses from owners array
 * @param {Array<Object>} owners - Array of owner objects with email field
 * @returns {Array<string>} Array of email addresses (filtered for valid emails)
 */
function getOwnerEmails(owners) {
  if (!owners || owners.length === 0) {
    return [];
  }

  return owners
    .map(owner => owner.email)
    .filter(email => email && email.trim() && email.includes('@'));
}

/**
 * Format owner names for display
 * @param {Array<Object>} owners - Array of owner objects
 * @returns {string} Formatted names (e.g., "Sarah Johnson, John Smith")
 */
function formatOwnerNames(owners) {
  if (!owners || owners.length === 0) {
    return "Unknown";
  }

  return owners
    .map(owner => owner.fullName || `${owner.firstName} ${owner.lastName}`.trim())
    .filter(name => name)
    .join(', ');
}

module.exports = {
  generateGreeting,
  generateTransparencyParagraph,
  generateClosingLine,
  generateMultiOwnerEmailBody,
  getOwnerEmails,
  formatOwnerNames
};
