/**
 * Content Generation Module
 * Main entry point for all content generation (email + LinkedIn)
 */

const { generateEmailContent, generateEmailSequence } = require("./gpt-email-generator");
const { generateConnectionNote, generateLinkedInMessage } = require("./gpt-linkedin-generator");

/**
 * Generate complete outreach content package
 */
async function generateOutreachContent(businessData, config = {}) {
  const {
    generateEmail = true,
    generateLinkedIn = false,
    emailSequence = false
  } = config;
  
  const content = {
    email: null,
    emailSequence: null,
    linkedIn: {
      connectionNote: null,
      firstMessage: null
    }
  };
  
  // Generate email content
  if (generateEmail) {
    if (emailSequence) {
      content.emailSequence = await generateEmailSequence(businessData, config.sequenceConfig);
    } else {
      content.email = await generateEmailContent(businessData);
    }
  }
  
  // Generate LinkedIn content
  if (generateLinkedIn && businessData.linkedInUrl) {
    content.linkedIn.connectionNote = await generateConnectionNote({
      ownerFirstName: businessData.ownerFirstName,
      businessName: businessData.businessName || businessData.name,
      category: businessData.category,
      location: businessData.location || businessData.address,
      linkedInTitle: businessData.linkedInData?.title
    });
    
    if (content.email) {
      content.linkedIn.firstMessage = await generateLinkedInMessage({
        ownerFirstName: businessData.ownerFirstName,
        businessName: businessData.businessName || businessData.name,
        category: businessData.category,
        location: businessData.location || businessData.address,
        emailSubject: content.email.subject,
        emailBody: content.email.body
      });
    }
  }
  
  return content;
}

module.exports = {
  generateOutreachContent,
  generateEmailContent,
  generateEmailSequence,
  generateConnectionNote,
  generateLinkedInMessage
};
