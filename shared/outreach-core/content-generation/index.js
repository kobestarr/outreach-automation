/**
 * Content Generation Module
 * Main entry point for all content generation (email + LinkedIn)
 * Supports both OpenAI (GPT-4) and Anthropic (Claude) providers
 */

// Import both providers
const openaiEmail = require("./gpt-email-generator");
const openaiLinkedIn = require("./gpt-linkedin-generator");
const claudeEmail = require("./claude-email-generator");
const claudeLinkedIn = require("./claude-linkedin-generator");

// Default to OpenAI for backward compatibility
// To use Claude, set environment variable: CONTENT_PROVIDER=claude
const DEFAULT_PROVIDER = process.env.CONTENT_PROVIDER || 'openai';

// Select provider modules
function getEmailModule(provider = DEFAULT_PROVIDER) {
  return provider === 'claude' ? claudeEmail : openaiEmail;
}

function getLinkedInModule(provider = DEFAULT_PROVIDER) {
  return provider === 'claude' ? claudeLinkedIn : openaiLinkedIn;
}

// Legacy exports for backward compatibility
const { generateEmailContent, generateEmailSequence } = openaiEmail;
const { generateConnectionNote, generateLinkedInMessage } = openaiLinkedIn;

/**
 * Generate complete outreach content package
 *
 * @param {Object} businessData - Business data for personalization
 * @param {Object} config - Generation configuration
 * @param {string} config.provider - Content provider: 'openai' or 'claude' (default: env CONTENT_PROVIDER or 'openai')
 * @param {string} config.model - Model to use (provider-specific)
 * @param {boolean} config.generateEmail - Generate email content (default: true)
 * @param {boolean} config.generateLinkedIn - Generate LinkedIn content (default: false)
 * @param {boolean} config.emailSequence - Generate 4-email sequence (default: false)
 * @returns {Promise<Object>} Generated content { email, linkedIn, metadata }
 */
async function generateOutreachContent(businessData, config = {}) {
  const {
    provider = DEFAULT_PROVIDER,
    model,
    generateEmail = true,
    generateLinkedIn = false,
    emailSequence = false
  } = config;

  // Get provider-specific modules
  const emailModule = getEmailModule(provider);
  const linkedInModule = getLinkedInModule(provider);
  
  const content = {
    email: null,
    emailSequence: null,
    linkedIn: {
      connectionNote: null,
      firstMessage: null
    }
  };
  
  // Prepare barter info - only include if available
  const barterInfo = businessData.barterOpportunity && businessData.barterOpportunity.available
    ? businessData.barterOpportunity
    : null;
  
  // Generate email content
  if (generateEmail) {
    const emailData = {
      ...businessData,
      barterOpportunity: barterInfo,
      model // Pass model override if provided
    };

    if (emailSequence) {
      content.emailSequence = await emailModule.generateEmailSequence(emailData, config.sequenceConfig);
    } else {
      content.email = await emailModule.generateEmailContent(emailData);
    }
  }
  
  // Generate LinkedIn content
  if (generateLinkedIn && businessData.linkedInUrl) {
    content.linkedIn.connectionNote = await linkedInModule.generateConnectionNote({
      ownerFirstName: businessData.ownerFirstName,
      businessName: businessData.businessName || businessData.name,
      category: businessData.category,
      location: businessData.location || businessData.address,
      linkedInTitle: businessData.linkedInData?.title,
      model // Pass model override if provided
    });

    if (content.email) {
      content.linkedIn.firstMessage = await linkedInModule.generateLinkedInMessage({
        ownerFirstName: businessData.ownerFirstName,
        businessName: businessData.businessName || businessData.name,
        category: businessData.category,
        location: businessData.location || businessData.address,
        emailSubject: content.email.subject,
        emailBody: content.email.body,
        model // Pass model override if provided
      });
    }
  }

  // Add metadata about provider used
  content.metadata = {
    provider,
    model: model || 'default',
    generatedAt: new Date().toISOString()
  };

  return content;
}

module.exports = {
  generateOutreachContent,
  generateEmailContent,
  generateEmailSequence,
  generateConnectionNote,
  generateLinkedInMessage
};
