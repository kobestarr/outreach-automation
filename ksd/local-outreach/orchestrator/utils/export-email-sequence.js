#!/usr/bin/env node
/**
 * Email Sequence Export for Lemlist Manual Setup
 * Generates 4-email sequence with proper merge variables for copy-paste into Lemlist UI
 *
 * Usage:
 *   node export-email-sequence.js <business-name-or-id>
 *   node export-email-sequence.js "KissDental Bramhall"
 */

const { getBusiness } = require("../modules/database");
const { generateOutreachContent } = require("../../../../shared/outreach-core/content-generation");

/**
 * Convert email content to Lemlist merge variable format
 * Replaces business-specific values with {{variable}} syntax
 */
function formatForLemlist(emailContent, business) {
  let formatted = emailContent;

  // Replace first name with merge variable
  if (business.ownerFirstName) {
    const firstNameRegex = new RegExp(business.ownerFirstName, 'gi');
    formatted = formatted.replace(firstNameRegex, '{{firstName}}');
  }

  // Replace company name with merge variable (use humanized version)
  const companyNames = [
    business.businessName,
    business.name,
    business.businessName?.replace(/\s+(Limited|Ltd|Ltd\.|plc|PLC|Inc|Inc\.|LLC|Corp|Corporation|Company|Co\.|Co)$/gi, ''),
  ].filter(Boolean);

  companyNames.forEach(name => {
    if (name) {
      const nameRegex = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      formatted = formatted.replace(nameRegex, '{{companyName}}');
    }
  });

  // Replace location references
  if (business.location || business.city) {
    const location = business.location || business.city;
    const locationRegex = new RegExp(location, 'gi');
    formatted = formatted.replace(locationRegex, '{{location}}');
  }

  return formatted;
}

/**
 * Generate and format email sequence for Lemlist
 */
async function exportEmailSequence(businessNameOrId) {
  console.log(`\n=== EMAIL SEQUENCE EXPORT FOR LEMLIST ===\n`);

  // Find business
  let businessRecord = getBusiness(businessNameOrId);

  if (!businessRecord) {
    const { loadBusinesses } = require("../modules/database");
    const allBusinesses = loadBusinesses({ limit: 1000 });
    businessRecord = allBusinesses.find(b =>
      b.business.name?.toLowerCase().includes(businessNameOrId.toLowerCase()) ||
      b.business.businessName?.toLowerCase().includes(businessNameOrId.toLowerCase())
    );
  }

  if (!businessRecord) {
    throw new Error(`Business not found: ${businessNameOrId}`);
  }

  const business = businessRecord.business;

  console.log(`Business: ${business.name || business.businessName}`);
  console.log(`Owner: ${business.ownerFirstName} ${business.ownerLastName}`);
  console.log(`Category: ${business.category}\n`);

  // Generate email sequence
  console.log(`Generating email sequence...\n`);

  const emailContent = await generateOutreachContent(business, {
    provider: process.env.CONTENT_PROVIDER || 'claude',
    generateEmail: true,
    emailSequence: true
  });

  const sequence = emailContent.emailSequence || [emailContent.email];

  if (!sequence || sequence.length === 0) {
    throw new Error('No email sequence generated');
  }

  console.log(`✓ Generated ${sequence.length} emails\n`);
  console.log(`${'='.repeat(80)}\n`);

  // Output each email with Lemlist formatting
  sequence.forEach((email, index) => {
    const delayDays = email.delayDays || (index === 0 ? 0 : index === 1 ? 3 : index === 2 ? 7 : 14);

    console.log(`EMAIL ${index + 1} — Send ${delayDays} days after previous`);
    console.log(`${'─'.repeat(80)}\n`);

    // Format subject line
    const formattedSubject = formatForLemlist(email.subject, business);
    console.log(`SUBJECT:\n${formattedSubject}\n`);

    // Format body
    const formattedBody = formatForLemlist(email.body, business);
    console.log(`BODY:\n${formattedBody}\n`);

    console.log(`${'─'.repeat(80)}\n`);
    console.log(`LEMLIST SETUP INSTRUCTIONS:\n`);
    console.log(`1. In Lemlist campaign editor, add "Email" step`);
    console.log(`2. Set delay: ${delayDays} days after previous step`);
    console.log(`3. Copy SUBJECT above into subject field`);
    console.log(`4. Copy BODY above into email body field`);
    console.log(`5. Verify merge variables: {{firstName}}, {{companyName}}, {{location}}`);
    console.log(`6. Enable tracking: Opens ✓, Clicks ✓\n`);

    console.log(`${'='.repeat(80)}\n`);
  });

  // Summary with merge variable mapping
  console.log(`MERGE VARIABLE MAPPING:\n`);
  console.log(`{{firstName}}     → Lead's first name (e.g., "${business.ownerFirstName}")`);
  console.log(`{{companyName}}   → Company name (e.g., "${business.businessName || business.name}")`);
  console.log(`{{location}}      → Business location (e.g., "${business.location || business.city || 'N/A'}")`);
  console.log(`{{linkedinUrl}}   → LinkedIn profile URL (if available)\n`);

  console.log(`CUSTOM FIELDS TO ADD IN LEMLIST:\n`);
  console.log(`1. Go to Lemlist Campaign → Settings → Custom Fields`);
  console.log(`2. Add custom field: "companyName" (Text)`);
  console.log(`3. Add custom field: "location" (Text)`);
  console.log(`4. Add custom field: "linkedinUrl" (Text, optional)\n`);

  console.log(`When exporting leads, map these fields:\n`);
  console.log(`- firstName: business.ownerFirstName`);
  console.log(`- lastName: business.ownerLastName`);
  console.log(`- email: business.ownerEmail`);
  console.log(`- companyName: business.businessName (humanized)`);
  console.log(`- location: business.location or business.city`);
  console.log(`- linkedinUrl: business.linkedInUrl (if available)\n`);

  console.log(`NEXT STEPS:\n`);
  console.log(`1. Copy each email's SUBJECT and BODY into Lemlist campaign editor`);
  console.log(`2. Set up 4-step email sequence with delays: 0, 3, 7, 14 days`);
  console.log(`3. Enable tracking for all emails`);
  console.log(`4. Test with 1-2 test leads before launching campaign\n`);

  return {
    business: business.name || business.businessName,
    emailCount: sequence.length,
    sequence: sequence.map((email, index) => ({
      emailNumber: index + 1,
      delayDays: email.delayDays || (index === 0 ? 0 : index === 1 ? 3 : index === 2 ? 7 : 14),
      subject: formatForLemlist(email.subject, business),
      body: formatForLemlist(email.body, business)
    }))
  };
}

// CLI entry point
if (require.main === module) {
  const businessNameOrId = process.argv[2];

  if (!businessNameOrId || businessNameOrId === '--help' || businessNameOrId === '-h') {
    console.log(`
Usage: node export-email-sequence.js <business-name-or-id>

Arguments:
  business-name-or-id    Business name (partial match) or database ID

Examples:
  node export-email-sequence.js "KissDental Bramhall"
  node export-email-sequence.js kissdental-bramhall-sk71pa-c260c5f9

Environment Variables:
  CONTENT_PROVIDER      Email generator (claude|gpt, default: claude)
`);
    process.exit(0);
  }

  exportEmailSequence(businessNameOrId)
    .then(result => {
      process.exit(0);
    })
    .catch(error => {
      console.error(`\n✗ Error: ${error.message}\n`);
      process.exit(1);
    });
}

module.exports = { exportEmailSequence, formatForLemlist };
