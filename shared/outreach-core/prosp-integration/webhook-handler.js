/**
 * Prosp Webhook Handler
 * Handles incoming webhooks from Prosp for LinkedIn activity tracking
 *
 * Supported Events:
 * - has_msg_replied: Lead replied to LinkedIn message
 * - send_msg: Message sent to lead
 * - send_connection: Connection request sent
 * - accept_invite: Connection request accepted
 * - is_invite_accepted: Invite accepted confirmation
 */

const logger = require("../logger");

/**
 * Verify Prosp webhook signature (if implemented)
 * @param {Object} payload - Webhook payload
 * @param {string} signature - Webhook signature header
 * @returns {boolean} Signature valid
 */
function verifyWebhookSignature(payload, signature) {
  // Prosp doesn't currently use webhook signatures
  // Return true for now, implement if Prosp adds signature verification
  return true;
}

/**
 * Process Prosp webhook event
 * @param {Object} payload - Webhook payload from Prosp
 * @returns {Object} Processing result
 */
function processProspWebhook(payload) {
  const { eventType, eventData } = payload;

  if (!eventType || !eventData) {
    throw new Error("Invalid webhook payload: missing eventType or eventData");
  }

  logger.info("prosp-webhook", "Webhook received", {
    eventType,
    campaignId: eventData.campaignId,
    lead: eventData.lead,
  });

  switch (eventType) {
    case "has_msg_replied":
      return handleMessageReplied(eventData);

    case "send_msg":
      return handleMessageSent(eventData);

    case "send_voice":
      return handleVoiceSent(eventData);

    case "send_connection":
      return handleConnectionSent(eventData);

    case "accept_invite":
    case "is_invite_accepted":
      return handleInviteAccepted(eventData);

    case "like_last_post":
      return handlePostLiked(eventData);

    case "comment_last_post":
      return handlePostCommented(eventData);

    case "add_tag":
      return handleTagAdded(eventData);

    default:
      logger.warn("prosp-webhook", "Unknown event type", { eventType });
      return {
        success: true,
        message: `Unknown event type: ${eventType}`,
      };
  }
}

/**
 * Handle message replied event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handleMessageReplied(eventData) {
  const { campaignId, campaignName, lead, profileInfo, content, timestamp } = eventData;

  logger.info("prosp-webhook", "Lead replied to message", {
    campaignId,
    campaignName,
    lead,
    firstName: profileInfo?.firstName,
    lastName: profileInfo?.lastName,
    replyContent: content?.substring(0, 100),
  });

  // TODO: Update database with reply status
  // - Find business by LinkedIn URL
  // - Update status to "replied"
  // - Store reply content and timestamp
  // - Trigger notification (email, Slack, etc.)

  return {
    success: true,
    message: "Reply recorded",
    data: {
      lead,
      replied: true,
      timestamp,
    },
  };
}

/**
 * Handle message sent event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handleMessageSent(eventData) {
  const { campaignId, lead, sender, content, timestamp } = eventData;

  logger.info("prosp-webhook", "Message sent to lead", {
    campaignId,
    lead,
    sender,
    messageLength: content?.length,
  });

  return {
    success: true,
    message: "Message sent recorded",
    data: {
      lead,
      messageSent: true,
      timestamp,
    },
  };
}

/**
 * Handle voice message sent event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handleVoiceSent(eventData) {
  const { campaignId, lead, sender, content, timestamp } = eventData;

  logger.info("prosp-webhook", "Voice message sent to lead", {
    campaignId,
    lead,
    sender,
    voiceUrl: content,
  });

  return {
    success: true,
    message: "Voice message recorded",
    data: {
      lead,
      voiceSent: true,
      timestamp,
    },
  };
}

/**
 * Handle connection request sent event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handleConnectionSent(eventData) {
  const { campaignId, lead, sender, timestamp } = eventData;

  logger.info("prosp-webhook", "Connection request sent", {
    campaignId,
    lead,
    sender,
  });

  return {
    success: true,
    message: "Connection request recorded",
    data: {
      lead,
      connectionSent: true,
      timestamp,
    },
  };
}

/**
 * Handle invite accepted event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handleInviteAccepted(eventData) {
  const { campaignId, lead, sender, timestamp } = eventData;

  logger.info("prosp-webhook", "Connection invite accepted", {
    campaignId,
    lead,
    sender,
  });

  return {
    success: true,
    message: "Invite accepted recorded",
    data: {
      lead,
      connected: true,
      timestamp,
    },
  };
}

/**
 * Handle post liked event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handlePostLiked(eventData) {
  const { campaignId, lead, timestamp } = eventData;

  logger.info("prosp-webhook", "Post liked", {
    campaignId,
    lead,
  });

  return {
    success: true,
    message: "Post like recorded",
    data: {
      lead,
      postLiked: true,
      timestamp,
    },
  };
}

/**
 * Handle post commented event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handlePostCommented(eventData) {
  const { campaignId, lead, content, timestamp } = eventData;

  logger.info("prosp-webhook", "Post commented", {
    campaignId,
    lead,
    commentText: content?.text,
  });

  return {
    success: true,
    message: "Comment recorded",
    data: {
      lead,
      commented: true,
      timestamp,
    },
  };
}

/**
 * Handle tag added event
 * @param {Object} eventData - Event data from webhook
 * @returns {Object} Processing result
 */
function handleTagAdded(eventData) {
  const { campaignId, lead, content, timestamp } = eventData;
  const tagName = content?.tag?.name;

  logger.info("prosp-webhook", "Tag added to lead", {
    campaignId,
    lead,
    tagName,
  });

  return {
    success: true,
    message: "Tag recorded",
    data: {
      lead,
      tagAdded: tagName,
      timestamp,
    },
  };
}

/**
 * Express.js middleware for handling Prosp webhooks
 * Usage: app.post('/webhooks/prosp', handleProspWebhookMiddleware);
 */
function handleProspWebhookMiddleware(req, res) {
  try {
    const payload = req.body;

    // Verify signature (if implemented)
    const signature = req.headers["x-prosp-signature"];
    if (!verifyWebhookSignature(payload, signature)) {
      logger.warn("prosp-webhook", "Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Process webhook
    const result = processProspWebhook(payload);

    logger.info("prosp-webhook", "Webhook processed successfully", {
      eventType: payload.eventType,
    });

    // Prosp expects 200 OK response
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error("prosp-webhook", "Webhook processing failed", {
      error: error.message,
    });

    return res.status(500).json({
      error: "Webhook processing failed",
      message: error.message,
    });
  }
}

module.exports = {
  processProspWebhook,
  handleProspWebhookMiddleware,
  verifyWebhookSignature,
};
