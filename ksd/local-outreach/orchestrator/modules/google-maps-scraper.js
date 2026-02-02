/**
 * HasData Google Maps Scraper
 * Scrapes businesses from Google Maps using HasData API
 */

const https = require("https");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");

const HASDATA_BASE_URL = "api.hasdata.com";

/**
 * Scrape Google Maps for businesses in a location
 * @param {string} location - Location to search (e.g., "Bramhall" or "CUSTOM>Bramhall")
 * @param {Array<string>} businessTypes - Keywords to search for (e.g., ["restaurants", "cafes"])
 * @returns {Promise<Array>} Array of business objects
 */
async function scrapeGoogleMaps(location, businessTypes = []) {
  const apiKey = getCredential("hasdata", "apiKey");
  
  // Ensure location has CUSTOM> prefix as required by HasData
  const formattedLocation = location.startsWith("CUSTOM>") ? location : `CUSTOM>${location}`;
  
  // Default keywords if none provided
  const keywords = businessTypes.length > 0 ? businessTypes : ["businesses", "shops"];
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      keywords: keywords,
      locations: [formattedLocation],
      extractEmails: true
    });
    
    const options = {
      hostname: HASDATA_BASE_URL,
      path: "/scrapers/google-maps/jobs",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
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
          
          // HasData returns a jobId - we need to poll for results
          if (result.jobId || result.job_id) {
            const jobId = result.jobId || result.job_id;
            
            // Poll for results
            pollHasDataJob(jobId, apiKey)
              .then(resolve)
              .catch(reject);
          } else if (result.items || result.data) {
            // Direct results (if API returns them immediately)
            const businesses = result.items || result.data || [];
            resolve(parseBusinesses(businesses));
          } else {
            reject(new Error("Unexpected HasData response format"));
          }
        } catch (error) {
          reject(new Error(`Failed to parse HasData response: ${error.message}`));
        }
      });
    });
    
    req.on("error", (error) => {
      reject(new Error(`HasData API error: ${error.message}`));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Poll HasData job for results
 * @param {string} jobId - Job ID from initial request
 * @param {string} apiKey - API key
 * @returns {Promise<Array>} Array of business objects
 */
function pollHasDataJob(jobId, apiKey) {
  return new Promise((resolve, reject) => {
    const maxAttempts = 30;
    let attempts = 0;
    
    const poll = () => {
      attempts++;
      
      const options = {
        hostname: HASDATA_BASE_URL,
        path: `/scrapers/google-maps/jobs/${jobId}`,
        method: "GET",
        headers: {
          "x-api-key": apiKey,
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
            const result = JSON.parse(data);
            
            if (result.status === "completed" && result.data) {
              resolve(parseBusinesses(result.data));
            } else if (result.status === "running" || result.status === "pending") {
              if (attempts < maxAttempts) {
                setTimeout(poll, 2000); // Wait 2 seconds
              } else {
                reject(new Error("HasData job timeout - took too long"));
              }
            } else {
              reject(new Error(`HasData job failed: ${result.status}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse HasData poll response: ${error.message}`));
          }
        });
      });
      
      req.on("error", (error) => {
        reject(new Error(`HasData poll request error: ${error.message}`));
      });
      
      req.end();
    };
    
    poll();
  });
}

/**
 * Parse HasData business data into standard format
 */
function parseBusinesses(businesses) {
  return businesses.map(b => ({
    name: b.name || b.businessName,
    address: b.address || b.formattedAddress,
    phone: b.phone || b.phoneNumber,
    website: b.website || b.url,
    rating: b.rating || b.averageRating,
    reviewCount: b.reviewCount || b.userRatingsTotal || 0,
    category: b.category || (b.types && b.types[0]) || "unknown",
    location: {
      lat: (b.location && b.location.lat) || (b.geometry && b.geometry.location && b.geometry.location.lat),
      lng: (b.location && b.location.lng) || (b.geometry && b.geometry.location && b.geometry.location.lng)
    },
    placeId: b.placeId || b.place_id,
    emailsFromWebsite: b.emails || b.extractedEmails || []
  }));
}

module.exports = {
  scrapeGoogleMaps
};
