/**
 * Prosp Integration Module
 * Main entry point for Prosp.ai LinkedIn automation
 */

const prospClient = require("./prosp-client");
const linkedinOutreach = require("./linkedin-outreach");
const webhookHandler = require("./webhook-handler");

module.exports = {
  // Client methods
  ...prospClient,

  // Outreach methods
  ...linkedinOutreach,

  // Webhook handling
  ...webhookHandler,
};
