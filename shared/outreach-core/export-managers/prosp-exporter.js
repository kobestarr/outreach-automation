/**
 * Prosp Export Manager
 * Exports LinkedIn leads and sequences to Prosp
 */

const https = require("https");
const { getCredential } = require("../credentials-loader");

const PROSP_BASE_URL = "api.prosp.ai";

/**
 * Add lead to Prosp campaign
 */
async function addLeadToCampaign(campaignId, leadData) {
  const apiKey = getCredential("prosp", "apiKey");
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email,
      linkedInUrl: leadData.linkedInUrl,
      company: leadData.companyName,
      title: leadData.title,
      customFields: leadData.customFields || {}
    });
    
    const options = {
      hostname: PROSP_BASE_URL,
      path: `/v1/leads`,
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
            reject(new Error(`Prosp API error: ${result.error || data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Prosp response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Prosp API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Send LinkedIn connection request via Prosp
 */
async function sendConnectionRequest(leadId, connectionNote) {
  const apiKey = getCredential("prosp", "apiKey");
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      leadId: leadId,
      note: connectionNote
    });
    
    const options = {
      hostname: PROSP_BASE_URL,
      path: `/v1/leads/${leadId}/connect`,
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
            reject(new Error(`Prosp API error: ${result.error || data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Prosp response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Prosp API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Send LinkedIn message via Prosp
 */
async function sendLinkedInMessage(leadId, message) {
  const apiKey = getCredential("prosp", "apiKey");
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      leadId: leadId,
      message: message
    });
    
    const options = {
      hostname: PROSP_BASE_URL,
      path: `/v1/leads/${leadId}/send-message`,
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
            reject(new Error(`Prosp API error: ${result.error || data}`));
          }
        } catch (error) {
          reject(new Error(`Failed to parse Prosp response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Prosp API request error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Export business to Prosp
 */
async function exportToProsp(business, linkedInContent) {
  if (!business.linkedInUrl) {
    throw new Error("Cannot export to Prosp without LinkedIn URL");
  }
  
  const leadData = {
    firstName: business.ownerFirstName,
    lastName: business.ownerLastName,
    email: business.ownerEmail,
    linkedInUrl: business.linkedInUrl,
    companyName: business.businessName || business.name,
    title: business.linkedInData?.title,
    customFields: {
      category: business.category,
      location: business.location || business.address,
      revenue: business.estimatedRevenue,
      tier: business.assignedOfferTier
    }
  };
  
  // Add lead
  const lead = await addLeadToCampaign(null, leadData);
  
  // Send connection request if note provided
  if (linkedInContent && linkedInContent.connectionNote && lead.id) {
    await sendConnectionRequest(lead.id, linkedInContent.connectionNote);
  }
  
  return lead;
}

module.exports = {
  exportToProsp,
  addLeadToCampaign,
  sendConnectionRequest,
  sendLinkedInMessage
};
