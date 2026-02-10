/**
 * LinkedIn Message Generator
 * Generates simple, natural LinkedIn connection messages
 *
 * Philosophy: LinkedIn message should reference email and build multi-channel presence
 */

const { getBusinessType } = require("./business-type-helper");
const { humanizeCompanyName } = require("./company-name-humanizer");
const logger = require("../logger");

/**
 * Generate LinkedIn connection message
 * Simple message referencing email sent
 *
 * @param {Object} business - Business data
 * @returns {string} LinkedIn message
 */
function generateLinkedInMessage(business) {
  const { ownerFirstName, businessName, category } = business;

  // Humanize company name
  const { humanized: humanizedBusinessName } = humanizeCompanyName(businessName);

  // Get business type for generic language
  const businessType = getBusinessType(category);

  const firstName = ownerFirstName || "there";

  // Simple template options
  const templates = [
    // Template 1: Direct reference to email
    `Hi ${firstName}, I just sent you an email about ${humanizedBusinessName}. Thought I'd reach out here too - easier to stay in touch. Let me know if you'd like to chat.`,

    // Template 2: Multi-channel approach
    `Hi ${firstName}, I emailed you earlier about working with ${businessType} like ${humanizedBusinessName}. Wanted to connect here as well. Happy to discuss if it's a fit.`,

    // Template 3: Casual follow-up
    `Hi ${firstName}, sent you an email about ${humanizedBusinessName}. Just wanted to connect on LinkedIn as well. Let me know if you're interested in learning more.`
  ];

  // Select template (random for variation)
  const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];

  logger.debug("linkedin-message-generator", "Generated LinkedIn message", {
    business: humanizedBusinessName,
    owner: firstName,
    messageLength: selectedTemplate.length,
  });

  return selectedTemplate;
}

/**
 * Generate LinkedIn connection request note
 * Short note for connection request (max 300 chars)
 *
 * @param {Object} business - Business data
 * @returns {string} Connection request note
 */
function generateConnectionRequestNote(business) {
  const { ownerFirstName, businessName } = business;

  // Humanize company name
  const { humanized: humanizedBusinessName } = humanizeCompanyName(businessName);

  const firstName = ownerFirstName || "there";

  // Keep it very short and simple
  const note = `Hi ${firstName}, I work with local businesses and wanted to connect. I've sent you an email about ${humanizedBusinessName}.`;

  logger.debug("linkedin-message-generator", "Generated connection request note", {
    business: humanizedBusinessName,
    owner: firstName,
    noteLength: note.length,
  });

  return note;
}

/**
 * Generate LinkedIn message with email reference (for Prosp campaigns)
 * @param {Object} business - Business data
 * @param {Object} options - Generation options
 * @returns {Object} Message with variations
 */
function generateLinkedInOutreachMessage(business, options = {}) {
  const { includeConnectionNote = true } = options;

  const message = generateLinkedInMessage(business);
  const connectionNote = includeConnectionNote ? generateConnectionRequestNote(business) : null;

  return {
    message,
    connectionNote,
    metadata: {
      businessType: getBusinessType(business.category),
      humanizedName: humanizeCompanyName(business.businessName).humanized,
    },
  };
}

module.exports = {
  generateLinkedInMessage,
  generateConnectionRequestNote,
  generateLinkedInOutreachMessage,
};
