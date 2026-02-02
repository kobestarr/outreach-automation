/**
 * Lemlist Export Manager
 * Exports leads and email sequences to Lemlist
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");

const LEMLIST_BASE_URL = "api.lemlist.com";

/**
 * Add lead to Lemlist campaign
 * @param {string} campaignId - Campaign ID (e.g., "cam_9NsHPnykWESTncCW8")
 * @param {Object} leadData - Lead data
 * @returns {Promise<Object>} Created lead object
 */
async function addLeadToCampaign(campaignId, leadData) {
  const apiKey = getCredential("lemlist", "apiKey");
  
  // Lemlist uses Basic auth: base64(username:password)
  // API key format: username:password (or just the API key as username with empty password)
  const authString = Buffer.from(apiKey + ":").toString("base64");
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: leadData.email,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      companyName: leadData.companyName,
      jobTitle: leadData.jobTitle,
      linkedinUrl: leadData.linkedinUrl,
      phone: leadData.phone,
      companyDomain: leadData.companyDomain || (leadData.website ? new URL(leadData.website).hostname.replace("www.", "") : null),
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
  const authString = Buffer.from(apiKey + ":").toString("base64");
  
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
 * @param {Object} business - Business object
 * @param {string} campaignId - Campaign ID (optional, will search by name if not provided)
 * @param {Array} emailSequence - Email sequence (optional, for icebreaker)
 * @returns {Promise<Object>} Created lead object
 */
async function exportToLemlist(business, campaignId, emailSequence) {
  const leadData = {
    email: business.ownerEmail,
    firstName: business.ownerFirstName,
    lastName: business.ownerLastName,
    companyName: business.businessName || business.name,
    jobTitle: business.linkedInData?.title,
    linkedinUrl: business.linkedInUrl,
    phone: business.phone,
    website: business.website,
    companyDomain: business.website ? new URL(business.website).hostname.replace("www.", "") : null,
    icebreaker: emailSequence && emailSequence[0] ? emailSequence[0].body.substring(0, 200) : null,
    timezone: "Europe/London"
  };
  
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
  
  return addLeadToCampaign(campaignId, leadData);
}

module.exports = {
  exportToLemlist,
  addLeadToCampaign,
  getOrCreateCampaign,
  getCampaigns
};
