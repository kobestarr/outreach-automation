/**
 * Icypeas LinkedIn Enrichment Module
 * Finds LinkedIn profiles using Icypeas Find People API
 */

const https = require("https");
const { getCredential, checkDailyLimit, recordUsage } = require("../credentials-loader");
const logger = require("../logger");

const ICYPEAS_BASE_URL = "app.icypeas.com";

/**
 * Find LinkedIn profile using name and company
 */
async function findLinkedInProfile({ firstName, lastName, companyName, location }) {
  const limitCheck = checkDailyLimit("icypeas");
  if (!limitCheck.canUse) {
    throw new Error(`Icypeas daily limit reached. Remaining: ${limitCheck.remaining}`);
  }
  
  const apiKey = getCredential("icypeas", "apiKey");
  
  // Build query for Find People API
  const query = companyName 
    ? `${firstName} ${lastName} ${companyName}`
    : `${firstName} ${lastName}`;
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      queries: [query],
      maxResults: 5,
      locationFilter: location || undefined
    });
    
    const options = {
      hostname: ICYPEAS_BASE_URL,
      path: "/api/find-people",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey,
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
          
          if (result.success && result.items && result.items.length > 0) {
            // Record usage (1 credit per result)
            recordUsage("icypeas", result.items.length);
            
            // Return best match
            const profile = result.items[0];
            resolve({
              linkedInUrl: profile.profileUrl || profile.linkedInUrl,
              firstName: profile.firstName || firstName,
              lastName: profile.lastName || lastName,
              title: profile.title,
              company: profile.company,
              location: profile.location,
              found: true
            });
          } else {
            resolve({
              linkedInUrl: null,
              found: false
            });
          }
        } catch (error) {
          reject(new Error(`Failed to parse Icypeas response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`Icypeas API error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

module.exports = {
  findLinkedInProfile
};
