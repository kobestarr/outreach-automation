/**
 * Prosp API Client
 * LinkedIn outreach automation via Prosp.ai platform
 *
 * API Documentation: https://prosp.ai/api
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");
const logger = require("../logger");

const PROSP_BASE_URL = "prosp.ai";
const PROSP_API_VERSION = "v1";

/**
 * Make authenticated request to Prosp API
 * @param {string} method - HTTP method
 * @param {string} path - API endpoint path
 * @param {Object} data - Request payload
 * @returns {Promise<Object>} API response
 */
function prospRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const apiKey = getCredential("prosp", "apiKey");

    if (!apiKey) {
      return reject(new Error("Prosp API key not configured"));
    }

    // Add API key to payload
    const payload = data ? { ...data, api_key: apiKey } : { api_key: apiKey };
    const postData = JSON.stringify(payload);

    const options = {
      hostname: PROSP_BASE_URL,
      path: `/api/${PROSP_API_VERSION}${path}`,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          // Handle empty responses
          if (!data || data.trim().length === 0) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ message: "success" });
            } else {
              reject(new Error(`Prosp API error (${res.statusCode}): Empty response`));
            }
            return;
          }

          const result = JSON.parse(data);

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            // Extract error message from response
            const errorMessage = result.message || result.error || data;
            reject(new Error(`Prosp API error (${res.statusCode}): ${errorMessage}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Prosp response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Prosp API request failed: ${error.message}`));
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Prosp API request timed out after 30s'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Add lead to Prosp contact list and campaign
 * @param {Object} lead - Lead information
 * @param {string} lead.linkedinUrl - LinkedIn profile URL
 * @param {string} lead.listId - Prosp contact list ID
 * @param {string} lead.campaignId - Prosp campaign ID
 * @param {Array<Object>} lead.customData - Custom properties [{property, value}]
 * @returns {Promise<Object>} API response
 */
async function addLeadToCampaign(lead) {
  const { linkedinUrl, listId, campaignId, customData = [] } = lead;

  if (!linkedinUrl || !listId || !campaignId) {
    throw new Error("Missing required fields: linkedinUrl, listId, campaignId");
  }

  logger.info("prosp-client", "Adding lead to campaign", {
    linkedinUrl,
    campaignId,
  });

  try {
    const response = await prospRequest("POST", "/leads", {
      linkedin_url: linkedinUrl,
      list_id: listId,
      campaign_id: campaignId,
      data: customData,
    });

    logger.info("prosp-client", "Lead added successfully", {
      linkedinUrl,
      campaignId,
    });

    return {
      success: true,
      message: response.message,
    };
  } catch (error) {
    // Handle duplicate lead errors gracefully
    if (error.message.includes("already in workspace") || error.message.includes("already exist")) {
      logger.warn("prosp-client", "Lead already exists in workspace", {
        linkedinUrl,
        campaignId,
      });

      return {
        success: true,
        duplicate: true,
        message: "Lead already exists in campaign",
      };
    }

    logger.error("prosp-client", "Failed to add lead", {
      linkedinUrl,
      campaignId,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Send LinkedIn message via Prosp
 * @param {Object} params - Message parameters
 * @param {string} params.linkedinUrl - Recipient's LinkedIn URL
 * @param {string} params.sender - Sender's LinkedIn URL
 * @param {string} params.message - Message content
 * @returns {Promise<Object>} API response
 */
async function sendLinkedInMessage(params) {
  const { linkedinUrl, sender, message } = params;

  if (!linkedinUrl || !sender || !message) {
    throw new Error("Missing required fields: linkedinUrl, sender, message");
  }

  logger.info("prosp-client", "Sending LinkedIn message", {
    linkedinUrl,
    sender,
    messageLength: message.length,
  });

  try {
    const response = await prospRequest("POST", "/leads/send-message", {
      linkedin_url: linkedinUrl,
      sender: sender,
      message: message,
    });

    logger.info("prosp-client", "Message sent successfully", {
      linkedinUrl,
      sender,
    });

    return {
      success: true,
      message: response.message,
    };
  } catch (error) {
    // Handle specific error cases
    if (error.message.includes("no permission to message")) {
      logger.warn("prosp-client", "Cannot message user (not connected)", {
        linkedinUrl,
      });

      return {
        success: false,
        reason: "not_connected",
        error: error.message,
      };
    }

    if (error.message.includes("authentication expired")) {
      logger.error("prosp-client", "Prosp authentication expired", {
        sender,
      });

      throw new Error("Prosp authentication expired - please reconnect LinkedIn account");
    }

    logger.error("prosp-client", "Failed to send message", {
      linkedinUrl,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Send voice message via Prosp
 * @param {Object} params - Voice message parameters
 * @param {string} params.linkedinUrl - Recipient's LinkedIn URL
 * @param {string} params.sender - Sender's LinkedIn URL
 * @param {string} params.message - Voice message text (will be converted to voice)
 * @returns {Promise<Object>} API response
 */
async function sendVoiceMessage(params) {
  const { linkedinUrl, sender, message } = params;

  if (!linkedinUrl || !sender || !message) {
    throw new Error("Missing required fields: linkedinUrl, sender, message");
  }

  logger.info("prosp-client", "Sending voice message", {
    linkedinUrl,
    sender,
    messageLength: message.length,
  });

  try {
    const response = await prospRequest("POST", "/leads/send-voice", {
      linkedin_url: linkedinUrl,
      sender: sender,
      message: message,
    });

    logger.info("prosp-client", "Voice message sent successfully", {
      linkedinUrl,
      sender,
    });

    return {
      success: true,
      message: response.message,
    };
  } catch (error) {
    // Handle voice-specific errors
    if (error.message.includes("voice not trained")) {
      logger.warn("prosp-client", "Voice not trained for this account", {
        sender,
      });

      return {
        success: false,
        reason: "voice_not_trained",
        error: "Voice not trained - please train voice in Prosp settings",
      };
    }

    logger.error("prosp-client", "Failed to send voice message", {
      linkedinUrl,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Get conversation history with lead
 * @param {Object} params - Conversation parameters
 * @param {string} params.linkedinUrl - Lead's LinkedIn URL
 * @param {string} params.sender - Sender's LinkedIn URL
 * @param {string} params.order - Sort order: "ascending" (latest first) or "descending" (oldest first)
 * @returns {Promise<Object>} Conversation data
 */
async function getConversation(params) {
  const { linkedinUrl, sender, order = "ascending" } = params;

  if (!linkedinUrl || !sender) {
    throw new Error("Missing required fields: linkedinUrl, sender");
  }

  logger.info("prosp-client", "Fetching conversation", {
    linkedinUrl,
    sender,
    order,
  });

  try {
    const response = await prospRequest("POST", "/leads/conversation", {
      linkedin_url: linkedinUrl,
      sender: sender,
      order: order,
    });

    logger.info("prosp-client", "Conversation fetched successfully", {
      linkedinUrl,
    });

    return {
      success: true,
      conversation: response,
    };
  } catch (error) {
    if (error.message.includes("not found")) {
      logger.warn("prosp-client", "Conversation not found", {
        linkedinUrl,
      });

      return {
        success: false,
        reason: "not_found",
        conversation: null,
      };
    }

    logger.error("prosp-client", "Failed to fetch conversation", {
      linkedinUrl,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Get all campaigns in workspace
 * @returns {Promise<Array>} List of campaigns
 */
async function getCampaigns() {
  logger.info("prosp-client", "Fetching campaigns");

  try {
    const response = await prospRequest("POST", "/campaigns/lists", {});

    logger.info("prosp-client", "Campaigns fetched successfully", {
      count: response.data?.length || 0,
    });

    return {
      success: true,
      campaigns: response.data || [],
      message: response.message,
    };
  } catch (error) {
    logger.error("prosp-client", "Failed to fetch campaigns", {
      error: error.message,
    });

    throw error;
  }
}

/**
 * Get all leads in a campaign
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Array>} List of leads
 */
async function getCampaignLeads(campaignId) {
  if (!campaignId) {
    throw new Error("Missing required field: campaignId");
  }

  logger.info("prosp-client", "Fetching campaign leads", {
    campaignId,
  });

  try {
    const response = await prospRequest("POST", "/campaigns/leads", {
      campaign_id: campaignId,
    });

    logger.info("prosp-client", "Campaign leads fetched successfully", {
      campaignId,
      count: response.data?.length || 0,
    });

    return {
      success: true,
      leads: response.data || [],
      message: response.message,
    };
  } catch (error) {
    logger.error("prosp-client", "Failed to fetch campaign leads", {
      campaignId,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Start a Prosp campaign
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Object>} Campaign status
 */
async function startCampaign(campaignId) {
  if (!campaignId) {
    throw new Error("Missing required field: campaignId");
  }

  logger.info("prosp-client", "Starting campaign", {
    campaignId,
  });

  try {
    const response = await prospRequest("POST", "/campaigns/start", {
      campaign_id: campaignId,
    });

    logger.info("prosp-client", "Campaign started successfully", {
      campaignId,
      campaignName: response.data?.campaign_name,
    });

    return {
      success: true,
      campaign: response.data,
      message: response.message,
    };
  } catch (error) {
    if (error.message.includes("already running")) {
      logger.warn("prosp-client", "Campaign already running", {
        campaignId,
      });

      return {
        success: true,
        alreadyRunning: true,
        message: "Campaign already running",
      };
    }

    logger.error("prosp-client", "Failed to start campaign", {
      campaignId,
      error: error.message,
    });

    throw error;
  }
}

/**
 * Stop a Prosp campaign
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Object>} Campaign status
 */
async function stopCampaign(campaignId) {
  if (!campaignId) {
    throw new Error("Missing required field: campaignId");
  }

  logger.info("prosp-client", "Stopping campaign", {
    campaignId,
  });

  try {
    const response = await prospRequest("POST", "/campaigns/stop", {
      campaign_id: campaignId,
    });

    logger.info("prosp-client", "Campaign stopped successfully", {
      campaignId,
      campaignName: response.data?.campaign_name,
    });

    return {
      success: true,
      campaign: response.data,
      message: response.message,
    };
  } catch (error) {
    if (error.message.includes("already stopped")) {
      logger.warn("prosp-client", "Campaign already stopped", {
        campaignId,
      });

      return {
        success: true,
        alreadyStopped: true,
        message: "Campaign already stopped",
      };
    }

    logger.error("prosp-client", "Failed to stop campaign", {
      campaignId,
      error: error.message,
    });

    throw error;
  }
}

module.exports = {
  addLeadToCampaign,
  sendLinkedInMessage,
  sendVoiceMessage,
  getConversation,
  getCampaigns,
  getCampaignLeads,
  startCampaign,
  stopCampaign,
};
