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
const REPLY_EXPIRY_DAYS = 30; // Expire processed replies after 30 days
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Load reply detector state
 */
function loadState() {
  try {
    if (fs.existsSync(REPLY_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(REPLY_STATE_FILE, "utf8"));
      // Migrate old state format if needed
      if (!state.processedRepliesWithTimestamp) {
        state.processedRepliesWithTimestamp = state.processedReplies.map(id => ({
          id,
          timestamp: new Date().toISOString()
        }));
      }
      return state;
    }
    return { 
      processedReplies: [], 
      processedRepliesWithTimestamp: [],
      lastCheck: null 
    };
  } catch (error) {
    logger.error('reply-detector', 'Failed to load state', { error: error.message });
    return { 
      processedReplies: [], 
      processedRepliesWithTimestamp: [],
      lastCheck: null 
    };
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
 * Lemlist uses 'status' field with value 'replied' to indicate replies
 * Also checks legacy boolean fields for backward compatibility
 */
function hasReplied(lead) {
  // Primary check: Lemlist status field
  if (lead.status && lead.status.toLowerCase() === 'replied') {
    return true;
  }
  
  // Debug logging to help diagnose reply detection issues
  logger.debug('reply-detector', 'Checking lead for reply', {
    email: lead.email,
    status: lead.status,
    isReplied: lead.isReplied,
    hasReplied: lead.hasReplied,
    replied: lead.replied
  });
  
  // Legacy boolean checks (for backward compatibility)
  return lead.isReplied === true || lead.hasReplied === true || lead.replied === true;
}

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {string} operation - Operation name for logging
 * @returns {Promise<any>}
 */
async function withRetry(fn, operation) {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('reply-detector', `${operation} failed, retrying`, {
          attempt,
          maxRetries: MAX_RETRIES,
          delay,
          error: error.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
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
      // Use retry logic for unsubscribe
      await withRetry(
        () => unsubscribeLead(campaignId, lead.email),
        `Unsubscribe lead ${lead.email}`
      );
      
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
      logger.error('reply-detector', 'Failed to stop lead after retries', {
        email: lead.email,
        error: error.message,
        attempts: MAX_RETRIES
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
 * Clean up old processed replies (time-based expiry)
 * @param {Object} state - Current state
 */
function cleanupOldReplies(state) {
  if (!state.processedRepliesWithTimestamp || state.processedRepliesWithTimestamp.length === 0) {
    return;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - REPLY_EXPIRY_DAYS);
  
  const beforeCount = state.processedRepliesWithTimestamp.length;
  
  state.processedRepliesWithTimestamp = state.processedRepliesWithTimestamp.filter(item => {
    const replyDate = new Date(item.timestamp);
    return replyDate >= cutoffDate;
  });
  
  // Keep backward compatibility with processedReplies array
  state.processedReplies = state.processedRepliesWithTimestamp.map(item => item.id);
  
  const afterCount = state.processedRepliesWithTimestamp.length;
  const removedCount = beforeCount - afterCount;
  
  if (removedCount > 0) {
    logger.info('reply-detector', 'Cleaned up old processed replies', {
      removed: removedCount,
      remaining: afterCount,
      expiryDays: REPLY_EXPIRY_DAYS
    });
  }
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

    // Clean up old replies before processing
    cleanupOldReplies(state);

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
      const alreadyProcessed = state.processedRepliesWithTimestamp.some(
        item => item.id === replyId
      );
      if (alreadyProcessed) {
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

      // Mark as processed with timestamp
      state.processedRepliesWithTimestamp.push({
        id: replyId,
        timestamp: new Date().toISOString()
      });
      state.processedReplies.push(replyId);
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
