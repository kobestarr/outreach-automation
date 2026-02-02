/**
 * Lemlist Export Manager
 * Exports leads and email sequences to Lemlist
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");

const LEMLIST_BASE_URL = "api.lemlist.com";

/**
 * Add lead to Lemlist campaign
 */
async function addLeadToCampaign(campaignId, leadData) {
  const apiKey = getCredential("lemlist", "apiKey");
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      email: leadData.email,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      companyName: leadData.companyName,
      phone: leadData.phone,
      website: leadData.website,
      customFields: leadData.customFields || {}
    });
    
    const options = {
      hostname: LEMLIST_BASE_URL,
      path: `/v1/campaigns/${campaignId}/leads`,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
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
          const result = JSON.parse(data);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(result);
          } else {
            reject(new Error(`Lemlist API error: ${result.error || data}`));
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
 * Create or get campaign
 */
async function getOrCreateCampaign(campaignName, emailSequence) {
  const apiKey = getCredential("lemlist", "apiKey");
  
  // First, try to find existing campaign
  // TODO: Implement campaign search/list API call
  
  // For now, return campaign ID (user should create manually or we implement campaign creation)
  // This is a placeholder - Lemlist API may require campaign creation via UI or different endpoint
  
  return {
    campaignId: null,
    needsCreation: true,
    message: "Campaign creation not yet implemented. Please create campaign in Lemlist UI first."
  };
}

/**
 * Export business to Lemlist
 */
async function exportToLemlist(business, campaignId, emailSequence) {
  const leadData = {
    email: business.ownerEmail,
    firstName: business.ownerFirstName,
    lastName: business.ownerLastName,
    companyName: business.businessName || business.name,
    phone: business.phone,
    website: business.website,
    customFields: {
      category: business.category,
      location: business.location || business.address,
      revenue: business.estimatedRevenue,
      tier: business.assignedOfferTier,
      linkedInUrl: business.linkedInUrl
    }
  };
  
  if (!campaignId) {
    // Try to get or create campaign
    const campaign = await getOrCreateCampaign(
      `${business.category} Outreach`,
      emailSequence
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
  getOrCreateCampaign
};
