/**
 * Reply Detector
 * Monitors Lemlist campaigns for replies and auto-stops related sequences
 *
 * For multi-owner businesses:
 * - When one owner replies, automatically stops sequences for all other owners
 * - Prevents awkward situations where you keep emailing people after someone responded
 */

const { getLeadsFromCampaign, unsubscribeLead, getCampaigns } = require("./lemlist-exporter");
const logger = require("../logger");
const fs = require("fs");
const path = require("path");

const REPLY_STATE_FILE = path.join(__dirname, "../data/reply-detector-state.json");

/**
 * Load reply detector state
 */
function loadState() {
  try {
    if (fs.existsSync(REPLY_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(REPLY_STATE_FILE, "utf8"));
    }
    return { processedReplies: [], lastCheck: null };
  } catch (error) {
    logger.error('reply-detector', 'Failed to load state', { error: error.message });
    return { processedReplies: [], lastCheck: null };
  }
}

/**
 * Save reply detector state
 */
function saveState(state) {
  try {
    const dir = path.dirname(REPLY_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(REPLY_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.error('reply-detector', 'Failed to save state', { error: error.message });
  }
}

/**
 * Check if lead has replied
 * Lemlist marks leads with isReplied: true or hasReplied: true
 */
function hasReplied(lead) {
  return lead.isReplied === true || lead.hasReplied === true || lead.replied === true;
}

/**
 * Stop all related leads when one owner replies
 * @param {string} campaignId - Campaign ID
 * @param {string} businessId - Business ID linking the leads
 * @param {string} repliedEmail - Email of lead who replied
 * @param {Array} allLeads - All leads in campaign
 * @returns {Promise<Object>} Results
 */
async function stopRelatedLeads(campaignId, businessId, repliedEmail, allLeads) {
  // Find all leads with same businessId (excluding the one who replied)
  const relatedLeads = allLeads.filter(lead =>
    lead.businessId === businessId &&
    lead.email !== repliedEmail &&
    !hasReplied(lead)
  );

  if (relatedLeads.length === 0) {
    logger.info('reply-detector', 'No related leads to stop', {
      businessId,
      repliedEmail
    });
    return { stopped: [] };
  }

  logger.info('reply-detector', 'Stopping related leads', {
    businessId,
    repliedEmail,
    relatedCount: relatedLeads.length,
    relatedEmails: relatedLeads.map(l => l.email)
  });

  const stopped = [];
  const errors = [];

  for (const lead of relatedLeads) {
    try {
      await unsubscribeLead(campaignId, lead.email);
      stopped.push({
        email: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName
      });
      logger.info('reply-detector', 'Stopped lead sequence', {
        businessId,
        stoppedEmail: lead.email,
        reason: `${repliedEmail} replied`
      });

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      logger.error('reply-detector', 'Failed to stop lead', {
        email: lead.email,
        error: error.message
      });
      errors.push({
        email: lead.email,
        error: error.message
      });
    }
  }

  return { stopped, errors };
}

/**
 * Check a campaign for new replies and stop related sequences
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Object>} Detection results
 */
async function checkCampaignForReplies(campaignId) {
  const state = loadState();
  const results = {
    campaignId,
    newReplies: 0,
    stoppedSequences: 0,
    details: []
  };

  try {
    // Get all leads from campaign
    const leads = await getLeadsFromCampaign(campaignId);

    if (!leads || leads.length === 0) {
      logger.info('reply-detector', 'No leads in campaign', { campaignId });
      return results;
    }

    logger.info('reply-detector', 'Checking campaign for replies', {
      campaignId,
      totalLeads: leads.length
    });

    // Find leads that have replied
    const repliedLeads = leads.filter(hasReplied);

    if (repliedLeads.length === 0) {
      logger.info('reply-detector', 'No replies found', { campaignId });
      state.lastCheck = new Date().toISOString();
      saveState(state);
      return results;
    }

    logger.info('reply-detector', 'Found replies', {
      campaignId,
      replyCount: repliedLeads.length
    });

    // Process each reply
    for (const repliedLead of repliedLeads) {
      const replyId = `${campaignId}-${repliedLead.email}`;

      // Skip if already processed
      if (state.processedReplies.includes(replyId)) {
        continue;
      }

      results.newReplies++;

      // Check if this is part of a multi-owner group
      if (repliedLead.multiOwnerGroup === true || repliedLead.multiOwnerGroup === "true") {
        logger.info('reply-detector', 'Multi-owner reply detected', {
          businessId: repliedLead.businessId,
          repliedEmail: repliedLead.email,
          ownerName: `${repliedLead.firstName} ${repliedLead.lastName}`,
          companyName: repliedLead.companyName
        });

        // Stop related leads
        const stopResult = await stopRelatedLeads(
          campaignId,
          repliedLead.businessId,
          repliedLead.email,
          leads
        );

        results.stoppedSequences += stopResult.stopped.length;
        results.details.push({
          repliedLead: {
            email: repliedLead.email,
            name: `${repliedLead.firstName} ${repliedLead.lastName}`,
            companyName: repliedLead.companyName
          },
          stoppedLeads: stopResult.stopped,
          errors: stopResult.errors
        });
      } else {
        logger.info('reply-detector', 'Single-owner reply (no action needed)', {
          email: repliedLead.email,
          name: `${repliedLead.firstName} ${repliedLead.lastName}`
        });
      }

      // Mark as processed
      state.processedReplies.push(replyId);
    }

    // Clean up old processed replies (keep last 1000)
    if (state.processedReplies.length > 1000) {
      state.processedReplies = state.processedReplies.slice(-1000);
    }

    state.lastCheck = new Date().toISOString();
    saveState(state);

    return results;
  } catch (error) {
    logger.error('reply-detector', 'Error checking campaign', {
      campaignId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Check all active campaigns for replies
 * @returns {Promise<Array>} Results for all campaigns
 */
async function checkAllCampaigns() {
  try {
    const campaigns = await getCampaigns();
    const results = [];

    logger.info('reply-detector', 'Checking all campaigns', {
      campaignCount: campaigns.length
    });

    for (const campaign of campaigns) {
      try {
        const result = await checkCampaignForReplies(campaign._id);
        results.push(result);

        // Log summary if there were actions taken
        if (result.newReplies > 0 || result.stoppedSequences > 0) {
          logger.info('reply-detector', 'Campaign check complete', {
            campaignId: campaign._id,
            campaignName: campaign.name,
            newReplies: result.newReplies,
            stoppedSequences: result.stoppedSequences
          });
        }

        // Small delay between campaigns
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error('reply-detector', 'Failed to check campaign', {
          campaignId: campaign._id,
          campaignName: campaign.name,
          error: error.message
        });
      }
    }

    return results;
  } catch (error) {
    logger.error('reply-detector', 'Failed to get campaigns', {
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  checkCampaignForReplies,
  checkAllCampaigns,
  stopRelatedLeads
};
