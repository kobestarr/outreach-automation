/**
 * Lemlist Export Manager
 * Exports leads and email sequences to Lemlist
 */

const https = require("https");
const crypto = require("crypto");
const { getCredential } = require("../credentials-loader");
const logger = require("../logger");

// Configuration
const LEMLIST_BASE_URL = "api.lemlist.com";
const DEFAULT_DELAY_MS = parseInt(process.env.LEMLIST_LEAD_DELAY_MS, 10) || 500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Safely extract domain from website URL
 * @param {string} website - Website URL
 * @returns {string|null} Domain or null if invalid
 */
function extractDomainSafely(website) {
  if (!website || typeof website !== 'string') return null;
  try {
    const url = new URL(website);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Generate unique business ID for linking multi-owner leads
 * Uses SHA-256 for better collision resistance than MD5
 * @param {Object} business - Business object
 * @returns {string} Unique business ID
 */
function generateBusinessId(business) {
  const identifier = `${business.businessName || business.name}-${business.location || business.address}`;
  return crypto.createHash("sha256").update(identifier).digest("hex").substring(0, 12);
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
      
      // Check if it's a rate limit error (429)
      if (error.message && error.message.includes('429')) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn('lemlist-exporter', `${operation} rate limited, retrying`, {
          attempt,
          maxRetries: MAX_RETRIES,
          delay
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      } else if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('lemlist-exporter', `${operation} failed, retrying`, {
          attempt,
          maxRetries: MAX_RETRIES,
          delay,
          error: error.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        break;
      }
    }
  }
  
  throw lastError;
}

/**
 * Add lead to Lemlist campaign
 * @param {string} campaignId - Campaign ID (e.g., "cam_9NsHPnykWESTncCW8")
 * @param {Object} leadData - Lead data
 * @returns {Promise<Object>} Created lead object
 */
async function addLeadToCampaign(campaignId, leadData) {
  const apiKey = getCredential("lemlist", "apiKey");
  
  // Lemlist uses Basic auth: base64(":YourApiKey")
  // Username is empty, password is API key, colon BEFORE the key
  const authString = Buffer.from(":" + apiKey).toString("base64");
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: leadData.email,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      companyName: leadData.companyName,
      jobTitle: leadData.jobTitle,
      linkedinUrl: leadData.linkedinUrl,
      phone: leadData.phone,
      companyDomain: leadData.companyDomain || extractDomainSafely(leadData.website),
      icebreaker: leadData.icebreaker,
      timezone: leadData.timezone || "Europe/London"
    });
    
    const options = {
      hostname: LEMLIST_BASE_URL,
      path: `/api/campaigns/${campaignId}/leads/`,
      method: "POST",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const result = JSON.parse(data);
            resolve(result);
          } else {
            // Try to parse as JSON, but handle plain text errors (e.g., "Lead already exists")
            let errorMessage = data;
            try {
              const error = JSON.parse(data);
              errorMessage = error.message || error.error || data;
            } catch (e) {
              // Response is plain text, use as-is
              errorMessage = data;
            }

            // Special handling for duplicate lead errors
            if (data.includes("Lead already exists") || data.includes("already exist")) {
              reject(new Error(`DUPLICATE_LEAD: ${errorMessage}`));
            } else {
              reject(new Error(`Lemlist API error (${res.statusCode}): ${errorMessage}`));
            }
          }
        } catch (error) {
          reject(new Error(`Failed to parse Lemlist response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Lemlist API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Get campaigns list
 * @returns {Promise<Array>} List of campaigns
 */
async function getCampaigns() {
  const apiKey = getCredential("lemlist", "apiKey");
  const authString = Buffer.from(":" + apiKey).toString("base64");
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: LEMLIST_BASE_URL,
      path: "/api/campaigns",
      method: "GET",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Accept": "application/json"
      }
    };
    
    const req = https.request(options, (res) => {
      let data = "";
      
      res.on("data", (chunk) => {
        data += chunk;
      });
      
      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const result = JSON.parse(data);
            resolve(result);
          } else {
            reject(new Error(`Lemlist API error (${res.statusCode}): ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Lemlist response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Lemlist API request error: ${error.message}`));
    });
    
    req.end();
  });
}

/**
 * Create or get campaign
 * @param {string} campaignName - Campaign name
 * @returns {Promise<Object>} Campaign object with campaignId
 */
async function getOrCreateCampaign(campaignName) {
  try {
    // Try to find existing campaign
    const campaigns = await getCampaigns();
    const existing = campaigns.find(c => c.name === campaignName);
    
    if (existing) {
      return {
        campaignId: existing._id,
        campaignName: existing.name,
        exists: true
      };
    }
    
    // Campaign not found - user needs to create it manually
    return {
      campaignId: null,
      needsCreation: true,
      message: `Campaign "${campaignName}" not found. Please create it in Lemlist UI first, or use an existing campaign ID.`
    };
  } catch (error) {
    return {
      campaignId: null,
      needsCreation: true,
      message: `Failed to fetch campaigns: ${error.message}. Please create campaign manually.`
    };
  }
}

/**
 * Export business to Lemlist
 * Supports multi-owner: creates one lead per owner if business.owners array exists
 * @param {Object} business - Business object
 * @param {string} campaignId - Campaign ID (optional, will search by name if not provided)
 * @param {Array} emailSequence - Email sequence (optional, for icebreaker)
 * @returns {Promise<Object|Array>} Created lead object(s)
 */
async function exportToLemlist(business, campaignId, emailSequence) {
  if (!campaignId) {
    // Try to get or create campaign
    const campaign = await getOrCreateCampaign(
      `${business.category} Outreach`
    );

    if (campaign.needsCreation) {
      throw new Error(campaign.message);
    }

    campaignId = campaign.campaignId;
  }

  // Multi-owner support: Create one lead per owner
  if (business.owners && business.owners.length > 0) {
    const ownersWithEmails = business.owners.filter(owner => owner.email);

    if (ownersWithEmails.length === 0) {
      throw new Error('No owner emails found for multi-owner export');
    }

    logger.info('lemlist-exporter', 'Exporting multi-owner business', {
      businessName: business.businessName || business.name,
      ownerCount: ownersWithEmails.length,
      owners: ownersWithEmails.map(o => `${o.fullName} <${o.email}>`)
    });

    const leads = [];
    const errors = [];
    const businessId = generateBusinessId(business);

    for (let i = 0; i < ownersWithEmails.length; i++) {
      const owner = ownersWithEmails[i];

      const leadData = {
        email: owner.email,
        firstName: owner.firstName,
        lastName: owner.lastName,
        companyName: business.businessName || business.name,
        jobTitle: owner.title || business.linkedInData?.title,
        linkedinUrl: business.linkedInUrl, // Use business LinkedIn (first owner's)
        phone: business.phone,
        website: business.website,
        companyDomain: extractDomainSafely(business.website),
        icebreaker: emailSequence && emailSequence[0] ? emailSequence[0].body.substring(0, 200) : null,
        timezone: "Europe/London",
        // Multi-owner linking fields for reply detection
        businessId: businessId,
        multiOwnerGroup: true,
        ownerCount: ownersWithEmails.length,
        ownerIndex: i + 1
      };

      try {
        // Use retry logic for lead creation
        const lead = await withRetry(
          () => addLeadToCampaign(campaignId, leadData),
          `Create lead for ${owner.email}`
        );
        
        leads.push(lead);
        logger.info('lemlist-exporter', 'Created lead for owner', {
          owner: owner.fullName,
          email: owner.email,
          leadId: lead._id
        });

        // Configurable delay between lead creations to avoid rate limits
        if (i < ownersWithEmails.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DEFAULT_DELAY_MS));
        }
      } catch (error) {
        // Check if error is duplicate lead (not a real failure)
        const isDuplicate = error.message.includes('DUPLICATE_LEAD') ||
                           error.message.includes('already in the campaign') ||
                           error.message.includes('already exist');

        if (isDuplicate) {
          logger.warn('lemlist-exporter', 'Lead already exists in campaign', {
            owner: owner.fullName,
            email: owner.email,
            campaignId: campaignId
          });
          errors.push({
            owner: owner.fullName,
            email: owner.email,
            error: 'DUPLICATE_LEAD',
            isDuplicate: true
          });
        } else {
          logger.error('lemlist-exporter', 'Failed to create lead for owner after retries', {
            owner: owner.fullName,
            email: owner.email,
            error: error.message,
            attempts: MAX_RETRIES
          });
          errors.push({
            owner: owner.fullName,
            email: owner.email,
            error: error.message,
            isDuplicate: false
          });
        }
      }
    }

    // Only throw error if there are genuine (non-duplicate) failures
    const genuineErrors = errors.filter(e => !e.isDuplicate);
    const duplicateErrors = errors.filter(e => e.isDuplicate);

    if (genuineErrors.length > 0 && leads.length === 0) {
      throw new Error(`Failed to create any leads. Errors: ${genuineErrors.map(e => e.error).join(', ')}`);
    }

    // Log warning if all leads were duplicates
    if (duplicateErrors.length === ownersWithEmails.length && leads.length === 0) {
      logger.warn('lemlist-exporter', 'All leads already exist in campaign', {
        campaignId: campaignId,
        duplicateCount: duplicateErrors.length,
        owners: duplicateErrors.map(e => e.owner)
      });
    }

    return {
      multiOwner: true,
      leads: leads,
      errors: errors,
      successCount: leads.length,
      failureCount: genuineErrors.length,
      duplicateCount: duplicateErrors.length,
      allDuplicates: duplicateErrors.length === ownersWithEmails.length && leads.length === 0
    };
  }

  // Single-owner flow (backward compatibility)
  const businessId = generateBusinessId(business);

  const leadData = {
    email: business.ownerEmail,
    firstName: business.ownerFirstName,
    lastName: business.ownerLastName,
    companyName: business.businessName || business.name,
    jobTitle: business.linkedInData?.title,
    linkedinUrl: business.linkedInUrl,
    phone: business.phone,
    website: business.website,
    companyDomain: extractDomainSafely(business.website),
    icebreaker: emailSequence && emailSequence[0] ? emailSequence[0].body.substring(0, 200) : null,
    timezone: "Europe/London",
    businessId: businessId,
    multiOwnerGroup: false,
    ownerCount: 1,
    ownerIndex: 1
  };

  return withRetry(
    () => addLeadToCampaign(campaignId, leadData),
    `Create lead for ${leadData.email}`
  );
}

/**
 * Get all leads from a campaign
 * @param {string} campaignId - Campaign ID
 * @returns {Promise<Array>} List of leads
 */
async function getLeadsFromCampaign(campaignId) {
  const apiKey = getCredential("lemlist", "apiKey");
  const authString = Buffer.from(":" + apiKey).toString("base64");

  return new Promise((resolve, reject) => {
    const options = {
      hostname: LEMLIST_BASE_URL,
      path: `/api/campaigns/${campaignId}/leads`,
      method: "GET",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Accept": "application/json"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Handle empty response (Lemlist returns content-length: 0 for empty campaigns)
            if (!data || data.trim().length === 0) {
              resolve([]);
              return;
            }
            const result = JSON.parse(data);
            resolve(result);
          } else {
            reject(new Error(`Lemlist API error (${res.statusCode}): ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Lemlist response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Lemlist API request error: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Unsubscribe a lead from a campaign (stops their sequence)
 * @param {string} campaignId - Campaign ID
 * @param {string} email - Lead email address
 * @returns {Promise<Object>} Result
 */
async function unsubscribeLead(campaignId, email) {
  const apiKey = getCredential("lemlist", "apiKey");
  const authString = Buffer.from(":" + apiKey).toString("base64");

  return new Promise((resolve, reject) => {
    const options = {
      hostname: LEMLIST_BASE_URL,
      path: `/api/campaigns/${campaignId}/leads/${encodeURIComponent(email)}/unsubscribe`,
      method: "DELETE",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Accept": "application/json"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const result = data ? JSON.parse(data) : { success: true };
            resolve(result);
          } else {
            reject(new Error(`Lemlist API error (${res.statusCode}): ${data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Lemlist response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Lemlist API request error: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Configure campaign email sequence
 * Sets up the email steps (sequence) for a Lemlist campaign
 * @param {string} campaignId - Campaign ID
 * @param {Array<Object>} emailSequence - Array of email objects with subject, body, delayDays
 * @returns {Promise<Object>} Configuration result
 */
async function configureCampaignSequence(campaignId, emailSequence) {
  const apiKey = getCredential("lemlist", "apiKey");
  const authString = Buffer.from(":" + apiKey).toString("base64");

  if (!Array.isArray(emailSequence) || emailSequence.length === 0) {
    throw new Error('Email sequence must be a non-empty array');
  }

  logger.info('lemlist-exporter', 'Configuring campaign email sequence', {
    campaignId,
    emailCount: emailSequence.length
  });

  // Lemlist email steps configuration
  // Note: Lemlist API requires email steps to be added individually via POST to /emailSteps endpoint
  // We'll use the simpler approach of updating the entire campaign configuration
  const emailSteps = emailSequence.map((email, index) => {
    return {
      _id: `step-${index + 1}`, // Lemlist requires unique ID for each step
      type: "email",
      position: index + 1,
      delay: email.delayDays || 0,
      delayUnit: "days",
      subject: email.subject || `Follow-up ${index + 1}`,
      body: email.body || "",
      // Optional fields
      trackOpens: true,
      trackClicks: true,
      isDeleted: false
    };
  });

  return new Promise((resolve, reject) => {
    // Use campaign update endpoint with proper email steps structure
    const postData = JSON.stringify({
      emailSteps: emailSteps
    });

    const options = {
      hostname: LEMLIST_BASE_URL,
      path: `/api/campaigns/${campaignId}`,
      method: "PATCH",
      headers: {
        "Authorization": `Basic ${authString}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // Parse response (optional - campaign update returns campaign object)
            if (data) {
              JSON.parse(data); // Validate JSON
            }

            logger.info('lemlist-exporter', 'Campaign sequence configured successfully', {
              campaignId,
              emailSteps: emailSteps.length
            });

            resolve({
              success: true,
              campaignId: campaignId,
              emailStepsConfigured: emailSteps.length,
              emailSteps: emailSteps.map(step => ({
                position: step.position,
                subject: step.subject,
                delay: step.delay
              }))
            });
          } else {
            let errorMessage = data;
            try {
              const error = JSON.parse(data);
              errorMessage = error.message || error.error || data;
            } catch (e) {
              // Response is plain text, use as-is
              errorMessage = data;
            }

            logger.error('lemlist-exporter', 'Failed to configure campaign sequence', {
              campaignId,
              statusCode: res.statusCode,
              error: errorMessage
            });

            reject(new Error(`Lemlist API error (${res.statusCode}): ${errorMessage}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Lemlist response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Lemlist API request error: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  exportToLemlist,
  addLeadToCampaign,
  getOrCreateCampaign,
  getCampaigns,
  getLeadsFromCampaign,
  unsubscribeLead,
  generateBusinessId,
  configureCampaignSequence
};
