/**
 * HasData Google Maps Scraper
 * Scrapes businesses from Google Maps using HasData API
 *
 * @module google-maps-scraper
 */

const https = require("https");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const logger = require("../../../../shared/outreach-core/logger");

const HASDATA_BASE_URL = "api.hasdata.com";
const REQUEST_TIMEOUT_MS = 30000;
const INITIAL_POLL_DELAY_MS = 2000;
const MAX_POLL_DELAY_MS = 16000;
const MAX_POLL_ATTEMPTS = 30;

/**
 * Calculate delay with exponential backoff
 * @param {number} attempt - Current attempt number (1-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = INITIAL_POLL_DELAY_MS * Math.pow(2, Math.min(attempt - 1, 3));
  return Math.min(delay, MAX_POLL_DELAY_MS);
}

/**
 * Scrape Google Maps for businesses in a location
 * @param {string} location - Location name (e.g., "Bramhall")
 * @param {string} postcode - Postcode to ensure correct location (e.g., "SK7")
 * @param {Array<string>} businessTypes - Keywords to search for (e.g., ["restaurants", "cafes"])
 * @returns {Promise<Array>} Array of business objects
 */
async function scrapeGoogleMaps(location, postcode, businessTypes = [], extractEmails = true) {
  const apiKey = getCredential("hasdata", "apiKey");
  
  // Format location with postcode for accuracy: "Location, Postcode" or "CUSTOM>Location, Postcode"
  // This ensures we get the right location (e.g., Bramhall SK7, not Bramhall elsewhere)
  let formattedLocation = location;
  if (postcode) {
    formattedLocation = `${location}, ${postcode}`;
  }
  
  // Ensure CUSTOM> prefix as required by HasData
  if (!formattedLocation.startsWith("CUSTOM>")) {
    formattedLocation = `CUSTOM>${formattedLocation}`;
  }
  
  // Default keywords if none provided
  const keywords = businessTypes.length > 0 ? businessTypes : ["businesses", "shops"];
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      keywords: keywords,
      locations: [formattedLocation],
      extractEmails: extractEmails
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

      // Check for HTTP errors
      if (res.statusCode >= 400) {
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          logger.error('google-maps-scraper', 'HasData HTTP error', { statusCode: res.statusCode, preview: data.substring(0, 200) });
          try {
            const errorData = JSON.parse(data);
            reject(new Error(`HasData API error (${res.statusCode}): ${errorData.message || errorData.status || "Unknown error"}`));
          } catch {
            reject(new Error(`HasData API error: HTTP ${res.statusCode}`));
          }
        });
        return;
      }

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(data);

          // Check for error status in response
          if (result.status === "error" || result.error) {
            logger.error('google-maps-scraper', 'HasData API error', { status: result.status, error: result.error });
            reject(new Error(`HasData API error: ${result.message || result.error || "Unknown error"}`));
            return;
          }

          // HasData returns a jobId - we need to poll for results
          if (result.id || result.jobId || result.job_id) {
            const jobId = result.id || result.jobId || result.job_id;

            // Poll for results
            pollHasDataJob(jobId, apiKey, postcode)
              .then(resolve)
              .catch(reject);
          } else if (result.items || result.data) {
            // Direct results (if API returns them immediately)
            const businesses = result.items || result.data || [];
            resolve(filterByPostcode(parseBusinesses(businesses), postcode));
          } else {
            logger.error('google-maps-scraper', 'Unexpected response format', { resultKeys: Object.keys(result) });
            reject(new Error("Unexpected HasData response format"));
          }
        } catch (error) {
          logger.error('google-maps-scraper', 'Failed to parse response', { error: error.message, preview: data.substring(0, 200) });
          reject(new Error(`Failed to parse HasData response: ${error.message}`));
        }
      });
    });

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`HasData API request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", (error) => {
      if (error.code === "ECONNRESET") {
        reject(new Error("HasData API connection reset - request may have timed out"));
      } else {
        reject(new Error(`HasData API error: ${error.message}`));
      }
    });

    req.write(postData);
    req.end();
  });
}


/**
 * Fetch JSON results from HasData download URL
 * @param {string} jsonUrl - The download URL for JSON results
 * @param {string} postcode - Postcode to filter results
 * @returns {Promise<Array>} Array of parsed business objects
 */
function fetchHasDataJson(jsonUrl, postcode) {
  return new Promise((resolve, reject) => {
    const url = new URL(jsonUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + (url.search || ""),
      method: "GET",
      headers: {
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
          const businesses = JSON.parse(data);
          const parsed = parseBusinesses(Array.isArray(businesses) ? businesses : [businesses]);
          resolve(filterByPostcode(parsed, postcode));
        } catch (error) {
          logger.error('google-maps-scraper', 'Failed to parse JSON results', { error: error.message, preview: data.substring(0, 200) });
          reject(new Error(`Failed to parse HasData JSON results: ${error.message}`));
        }
      });
    });

    // Set request timeout
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`HasData JSON fetch timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on("error", (error) => {
      reject(new Error(`Failed to fetch HasData JSON: ${error.message}`));
    });

    req.end();
  });
}

/**
 * Poll HasData job for results with exponential backoff
 * @param {string} jobId - Job ID from initial request
 * @param {string} apiKey - API key for authentication
 * @param {string} postcode - Postcode to filter results
 * @returns {Promise<Array>} Array of business objects
 * @throws {Error} If job fails or times out
 */
function pollHasDataJob(jobId, apiKey, postcode) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const poll = () => {
      attempts++;

      const options = {
        hostname: HASDATA_BASE_URL,
        path: `/scrapers/jobs/${jobId}`,
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

            if ((result.status === "finished" || result.status === "completed") && result.data) {
              // HasData returns download URLs when finished
              if (typeof result.data === "object" && result.data.json) {
                // Fetch JSON data from download URL
                fetchHasDataJson(result.data.json, postcode)
                  .then(resolve)
                  .catch(reject);
              } else if (Array.isArray(result.data)) {
                // Direct data array (fallback)
                const businesses = parseBusinesses(result.data);
                resolve(filterByPostcode(businesses, postcode));
              } else {
                logger.error('google-maps-scraper', 'Unexpected data format', { dataType: typeof result.data });
                reject(new Error("Unexpected data format from HasData"));
              }
            } else if (result.status === "in_progress" || result.status === "running" || result.status === "pending" || result.status === "exporting_data") {
              if (attempts < MAX_POLL_ATTEMPTS) {
                const delay = getBackoffDelay(attempts);
                setTimeout(poll, delay);
              } else {
                reject(new Error(`HasData job timeout after ${MAX_POLL_ATTEMPTS} attempts (jobId: ${jobId})`));
              }
            } else if (result.status === "failed" || result.status === "error") {
              logger.error('google-maps-scraper', 'Job failed', { status: result.status, message: result.message, error: result.error });
              reject(new Error(`HasData job failed: ${result.message || result.error || result.status}`));
            } else {
              logger.error('google-maps-scraper', 'Unknown job status', { status: result.status });
              reject(new Error(`HasData job failed with unknown status: ${result.status}`));
            }
          } catch (error) {
            logger.error('google-maps-scraper', 'Failed to parse poll response', { error: error.message, preview: data.substring(0, 200) });
            reject(new Error(`Failed to parse HasData poll response: ${error.message}`));
          }
        });
      });

      // Set request timeout
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`HasData poll request timeout after ${REQUEST_TIMEOUT_MS}ms`));
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
 * Filter businesses by postcode area
 * @param {Array} businesses - Array of business objects
 * @param {string} postcode - Postcode prefix to match (e.g., "SK7")
 * @returns {Array} Filtered businesses
 */
function filterByPostcode(businesses, postcode) {
  if (!postcode) {
    return businesses; // No postcode filter, return all
  }
  
  // Extract postcode prefix (first part before space, e.g., "SK7" from "SK7 1AA")
  const postcodePrefix = postcode.toUpperCase().split(" ")[0].trim();
  
  return businesses.filter(business => {
    const businessPostcode = business.postcode || extractPostcodeFromAddress(business.address);
    
    if (!businessPostcode) {
      // If no postcode found, include it (might be valid but missing data)
      return true;
    }
    
    // Check if postcode starts with the prefix
    const businessPrefix = businessPostcode.toUpperCase().split(" ")[0].trim();
    return businessPrefix === postcodePrefix;
  });
}

/**
 * Extract postcode from address string
 * @param {string} address - Full address string
 * @returns {string|null} Postcode if found
 */
function extractPostcodeFromAddress(address) {
  if (!address) return null;
  
  // UK postcode pattern: e.g., "SK7 1AA", "M1 1AA", "SW1A 1AA"
  const postcodePattern = /\b([A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2})\b/i;
  const match = address.match(postcodePattern);
  
  return match ? match[1].toUpperCase() : null;
}

/**
 * Parse HasData business data into standard format
 */
function parseBusinesses(businesses) {
  return businesses.map(b => {
    const address = b.address || b.formattedAddress || "";
    const postcode = extractPostcodeFromAddress(address);
    
    return {
      name: b.name || b.businessName || b.title || (b.address ? b.address.split(',')[0].trim() : "Unknown Business"),
      address: address,
      postcode: postcode,
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
    };
  });
}

module.exports = {
  scrapeGoogleMaps
};
