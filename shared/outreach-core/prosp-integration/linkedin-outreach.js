/**
 * LinkedIn Outreach via Prosp
 * Handles LinkedIn connection requests and messaging through Prosp.ai
 */

const {
  addLeadToCampaign,
  sendLinkedInMessage,
  getConversation,
} = require("./prosp-client");
const { getCredential } = require("../credentials-loader");
const logger = require("../logger");

/**
 * Send LinkedIn outreach to business owner(s)
 * @param {Object} business - Business object from database
 * @param {Object} options - Outreach options
 * @param {string} options.campaignId - Prosp campaign ID
 * @param {string} options.listId - Prosp contact list ID
 * @param {string} options.sender - Sender's LinkedIn URL
 * @param {string} options.message - LinkedIn message content
 * @param {boolean} options.sendImmediately - Send message immediately (default: false, campaign sends automatically)
 * @returns {Promise<Object>} Outreach results
 */
async function sendLinkedInOutreach(business, options = {}) {
  const {
    campaignId = process.env.PROSP_CAMPAIGN_ID || getCredential("prosp", "campaignId"),
    listId = process.env.PROSP_LIST_ID || getCredential("prosp", "listId"),
    sender = process.env.PROSP_SENDER_URL || getCredential("prosp", "senderUrl"),
    message = null,
    sendImmediately = false,
  } = options;

  // Validation
  if (!campaignId || !listId) {
    throw new Error("Prosp campaign ID and list ID are required");
  }

  if (sendImmediately && (!sender || !message)) {
    throw new Error("Sender LinkedIn URL and message content required for immediate send");
  }

  const results = {
    businessId: business.id || business.businessName,
    businessName: business.businessName || business.name,
    owners: [],
    addedToCampaign: 0,
    messagesSent: 0,
    errors: [],
  };

  // Handle multi-owner businesses
  const owners = business.owners || [
    {
      firstName: business.ownerFirstName,
      lastName: business.ownerLastName,
      linkedInUrl: business.linkedInUrl,
    },
  ];

  logger.info("linkedin-outreach", "Starting LinkedIn outreach", {
    business: results.businessName,
    ownerCount: owners.length,
    campaignId,
    sendImmediately,
  });

  for (const owner of owners) {
    const ownerResult = {
      name: `${owner.firstName} ${owner.lastName}`,
      linkedInUrl: owner.linkedInUrl,
      addedToCampaign: false,
      messageSent: false,
      error: null,
    };

    // Check if owner has LinkedIn URL
    if (!owner.linkedInUrl) {
      ownerResult.error = "No LinkedIn URL available";
      logger.warn("linkedin-outreach", "Owner missing LinkedIn URL", {
        business: results.businessName,
        owner: ownerResult.name,
      });

      results.owners.push(ownerResult);
      results.errors.push({
        owner: ownerResult.name,
        error: ownerResult.error,
      });
      continue;
    }

    try {
      // Step 1: Add lead to campaign
      const customData = [
        { property: "firstName", value: owner.firstName || "" },
        { property: "lastName", value: owner.lastName || "" },
        { property: "companyName", value: business.businessName || business.name || "" },
        { property: "category", value: business.category || "" },
        { property: "location", value: business.location || business.city || "" },
        { property: "website", value: business.website || "" },
        { property: "businessId", value: business.id || "" },
      ];

      // Add tier/pricing info if available
      if (business.assignedOfferTier) {
        customData.push({ property: "offerTier", value: business.assignedOfferTier });
      }
      if (business.setupFee) {
        customData.push({ property: "setupFee", value: business.setupFee.toString() });
      }
      if (business.monthlyPrice) {
        customData.push({ property: "monthlyPrice", value: business.monthlyPrice.toString() });
      }

      const addResult = await addLeadToCampaign({
        linkedinUrl: owner.linkedInUrl,
        listId: listId,
        campaignId: campaignId,
        customData: customData,
      });

      if (addResult.success) {
        ownerResult.addedToCampaign = true;
        results.addedToCampaign++;

        if (addResult.duplicate) {
          ownerResult.note = "Already in campaign";
        }

        logger.info("linkedin-outreach", "Lead added to campaign", {
          business: results.businessName,
          owner: ownerResult.name,
          linkedInUrl: owner.linkedInUrl,
          duplicate: addResult.duplicate || false,
        });
      }

      // Step 2: Send immediate message (optional)
      if (sendImmediately && sender && message) {
        // Add delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const messageResult = await sendLinkedInMessage({
          linkedinUrl: owner.linkedInUrl,
          sender: sender,
          message: message,
        });

        if (messageResult.success) {
          ownerResult.messageSent = true;
          results.messagesSent++;

          logger.info("linkedin-outreach", "Message sent successfully", {
            business: results.businessName,
            owner: ownerResult.name,
          });
        } else {
          ownerResult.note = messageResult.reason || "Message not sent";

          logger.warn("linkedin-outreach", "Message not sent", {
            business: results.businessName,
            owner: ownerResult.name,
            reason: messageResult.reason,
          });
        }
      }
    } catch (error) {
      ownerResult.error = error.message;

      logger.error("linkedin-outreach", "Failed to process owner", {
        business: results.businessName,
        owner: ownerResult.name,
        error: error.message,
      });

      results.errors.push({
        owner: ownerResult.name,
        error: error.message,
      });
    }

    results.owners.push(ownerResult);

    // Rate limiting delay between owners
    if (owners.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Summary
  logger.info("linkedin-outreach", "LinkedIn outreach complete", {
    business: results.businessName,
    addedToCampaign: results.addedToCampaign,
    messagesSent: results.messagesSent,
    errors: results.errors.length,
  });

  return results;
}

/**
 * Check for LinkedIn replies from leads
 * @param {Array<Object>} businesses - Array of business objects
 * @param {string} sender - Sender's LinkedIn URL
 * @returns {Promise<Array>} Businesses with reply status
 */
async function checkLinkedInReplies(businesses, sender) {
  if (!sender) {
    sender = process.env.PROSP_SENDER_URL || getCredential("prosp", "senderUrl");
  }

  if (!sender) {
    throw new Error("Sender LinkedIn URL is required");
  }

  logger.info("linkedin-outreach", "Checking LinkedIn replies", {
    businessCount: businesses.length,
    sender,
  });

  const results = [];

  for (const business of businesses) {
    const owners = business.owners || [
      {
        firstName: business.ownerFirstName,
        lastName: business.ownerLastName,
        linkedInUrl: business.linkedInUrl,
      },
    ];

    for (const owner of owners) {
      if (!owner.linkedInUrl) continue;

      try {
        const conversationResult = await getConversation({
          linkedinUrl: owner.linkedInUrl,
          sender: sender,
          order: "ascending", // Latest messages first
        });

        if (conversationResult.success && conversationResult.conversation) {
          // Parse conversation to check for replies
          // (Prosp API returns conversation data - structure depends on implementation)
          const hasReplied = conversationResult.conversation.data?.some(
            (msg) => msg.sender !== sender
          );

          results.push({
            businessId: business.id,
            businessName: business.businessName || business.name,
            ownerName: `${owner.firstName} ${owner.lastName}`,
            linkedInUrl: owner.linkedInUrl,
            hasReplied: hasReplied,
            conversation: conversationResult.conversation,
          });

          logger.info("linkedin-outreach", "Conversation checked", {
            business: business.businessName || business.name,
            owner: `${owner.firstName} ${owner.lastName}`,
            hasReplied,
          });
        }
      } catch (error) {
        logger.error("linkedin-outreach", "Failed to check conversation", {
          business: business.businessName || business.name,
          owner: `${owner.firstName} ${owner.lastName}`,
          error: error.message,
        });

        results.push({
          businessId: business.id,
          businessName: business.businessName || business.name,
          ownerName: `${owner.firstName} ${owner.lastName}`,
          linkedInUrl: owner.linkedInUrl,
          error: error.message,
        });
      }

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

module.exports = {
  sendLinkedInOutreach,
  checkLinkedInReplies,
};
