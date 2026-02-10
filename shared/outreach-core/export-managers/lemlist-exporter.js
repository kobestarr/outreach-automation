/**
 * Lemlist Export Manager
 * Exports leads and email sequences to Lemlist
 */

const https = require("https");
const crypto = require("crypto");
const { getCredential } = require("../credentials-loader");
const logger = require("../logger");

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
 * @param {Object} business - Business object
 * @returns {string} Unique business ID
 */
function generateBusinessId(business) {
  const identifier = `${business.businessName || business.name}-${business.location || business.address}`;
  return crypto.createHash("md5").update(identifier).digest("hex").substring(0, 12);
}

const LEMLIST_BASE_URL = "api.lemlist.com";

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
            const error = JSON.parse(data);
            reject(new Error(`Lemlist API error (${res.statusCode}): ${error.message || error.error || data}`));
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
        const lead = await addLeadToCampaign(campaignId, leadData);
        leads.push(lead);
        logger.info('lemlist-exporter', 'Created lead for owner', {
          owner: owner.fullName,
          email: owner.email,
          leadId: lead._id
        });

        // Small delay between lead creations to avoid rate limits
        if (i < ownersWithEmails.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        logger.error('lemlist-exporter', 'Failed to create lead for owner', {
          owner: owner.fullName,
          email: owner.email,
          error: error.message
        });
        errors.push({
          owner: owner.fullName,
          email: owner.email,
          error: error.message
        });
      }
    }

    if (errors.length > 0 && leads.length === 0) {
      throw new Error(`Failed to create any leads. Errors: ${errors.map(e => e.error).join(', ')}`);
    }

    return {
      multiOwner: true,
      leads: leads,
      errors: errors,
      successCount: leads.length,
      failureCount: errors.length
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

  return addLeadToCampaign(campaignId, leadData);
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

module.exports = {
  exportToLemlist,
  addLeadToCampaign,
  getOrCreateCampaign,
  getCampaigns,
  getLeadsFromCampaign,
  unsubscribeLead,
  generateBusinessId
};
