/**
 * Scrapula Google Maps Scraper (formerly Outscraper)
 * Scrapes businesses from Google Maps using Scrapula API
 *
 * @module google-maps-scraper-scrapula
 */

const https = require("https");
const { getCredential } = require("../../../../shared/outreach-core/credentials-loader");
const logger = require("../../../../shared/outreach-core/logger");

const SCRAPULA_BASE_URL = "api.datapipeplatform.com";
const REQUEST_TIMEOUT_MS = 60000;
const INITIAL_POLL_DELAY_MS = 5000;
const MAX_POLL_DELAY_MS = 30000;
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max

/**
 * Calculate delay with exponential backoff
 */
function getBackoffDelay(attempt) {
  const delay = INITIAL_POLL_DELAY_MS * Math.pow(2, Math.min(attempt - 1, 3));
  return Math.min(delay, MAX_POLL_DELAY_MS);
}

/**
 * Scrape Google Maps for businesses using Scrapula API
 */
async function scrapeGoogleMapsScrapula(location, postcode, businessTypes = [], extractEmails = true) {
  const apiKey = getCredential("scrapula", "apiKey");

  // Build queries for each business type
  const queries = businessTypes.length > 0 
    ? businessTypes.map(type => postcode ? `${type}, ${location}, ${postcode}` : `${type}, ${location}`)
    : [postcode ? `${location}, ${postcode}` : location];

  logger.info('google-maps-scraper-scrapula', 'Starting Scrapula scrape', {
    location,
    postcode,
    businessTypes,
    queries
  });

  try {
    // Create a task for Google Maps scraping
    const taskId = await createScrapulaTask(queries, apiKey, extractEmails);
    
    // Poll for task completion
    const results = await pollScrapulaTask(taskId, apiKey);
    
    // Transform results
    const transformed = results.map(transformScrapulaBusiness);
    
    // Deduplicate by place_id
    const uniqueBusinesses = deduplicateByPlaceId(transformed);

    logger.info('google-maps-scraper-scrapula', 'Scrapula scrape complete', {
      taskId,
      totalResults: results.length,
      uniqueResults: uniqueBusinesses.length
    });

    return uniqueBusinesses;
  } catch (error) {
    logger.error('google-maps-scraper-scrapula', 'Scrapula scrape failed', {
      error: error.message,
      location,
      postcode
    });
    throw error;
  }
}

/**
 * Create a Scrapula task for Google Maps scraping
 */
function createScrapulaTask(queries, apiKey, extractEmails) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      service_name: "google_maps_service_v2",
      queries: queries,
      language: "en",
      region: "GB",
      limit: 500,
      dropDuplicates: true,
      enrichments: extractEmails ? ["domains_service"] : []
    });

    const options = {
      hostname: SCRAPULA_BASE_URL,
      path: "/tasks",
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
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
          if (res.statusCode >= 400) {
            logger.error('google-maps-scraper-scrapula', 'Task creation failed', {
              statusCode: res.statusCode,
              response: data.substring(0, 500)
            });
            reject(new Error(`Scrapula API error (${res.statusCode}): ${data}`));
            return;
          }

          const result = JSON.parse(data);
          
          if (result.id) {
            logger.info('google-maps-scraper-scrapula', 'Task created', {
              taskId: result.id
            });
            resolve(result.id);
          } else {
            logger.error('google-maps-scraper-scrapula', 'No task ID in response', {
              responseKeys: Object.keys(result)
            });
            reject(new Error("Scrapula response missing task ID"));
          }
        } catch (error) {
          logger.error('google-maps-scraper-scrapula', 'Failed to parse task creation response', {
            error: error.message,
            dataPreview: data.substring(0, 500)
          });
          reject(new Error(`Failed to parse Scrapula response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      logger.error('google-maps-scraper-scrapula', 'Task creation request error', { error: error.message });
      reject(new Error(`Scrapula task creation failed: ${error.message}`));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Scrapula task creation timeout"));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Poll Scrapula task until complete
 */
function pollScrapulaTask(taskId, apiKey) {
  return new Promise((resolve, reject) => {
    let attempts = 0;

    const poll = () => {
      attempts++;

      if (attempts > MAX_POLL_ATTEMPTS) {
        reject(new Error(`Scrapula task polling timeout after ${MAX_POLL_ATTEMPTS} attempts`));
        return;
      }

      const options = {
        hostname: SCRAPULA_BASE_URL,
        path: `/tasks/${taskId}`,
        method: "GET",
        headers: {
          "X-API-KEY": apiKey
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

            logger.info('google-maps-scraper-scrapula', 'Poll response', {
              taskId,
              status: result.status,
              attempt: attempts
            });

            if (result.status === "SUCCESS" || result.status === "success") {
              // Task complete - extract results from file_url or results
              let businesses = [];
              
              if (result.results && result.results.length > 0) {
                // Find the Google Maps Data result
                const gmResult = result.results.find(r => 
                  r.product_name === "Google Maps Data" || 
                  r.product_name === "Google Maps"
                );
                
                if (gmResult && gmResult.file_url) {
                  // Need to fetch results from file URL
                  fetchResultsFromUrl(gmResult.file_url, apiKey)
                    .then(resolve)
                    .catch(reject);
                  return;
                } else if (gmResult && gmResult.quantity) {
                  // Results might be embedded
                  businesses = gmResult.data || [];
                }
              }

              logger.info('google-maps-scraper-scrapula', 'Task completed', {
                taskId,
                count: businesses.length
              });

              resolve(businesses);

            } else if (result.status === "PENDING" || result.status === "RUNNING" || result.status === "pending" || result.status === "running") {
              // Still processing - poll again after delay
              const delay = getBackoffDelay(attempts);
              logger.info('google-maps-scraper-scrapula', 'Task pending, retrying', {
                taskId,
                attempt: attempts,
                delayMs: delay
              });
              setTimeout(poll, delay);

            } else if (result.status === "FAILURE" || result.status === "failure" || result.status === "error") {
              reject(new Error(`Scrapula task failed: ${result.error || "Unknown error"}`));

            } else {
              logger.warn('google-maps-scraper-scrapula', 'Unknown task status', {
                taskId,
                status: result.status
              });
              // Retry anyway
              const delay = getBackoffDelay(attempts);
              setTimeout(poll, delay);
            }

          } catch (error) {
            logger.error('google-maps-scraper-scrapula', 'Failed to parse poll response', {
              error: error.message,
              dataPreview: data.substring(0, 500)
            });
            reject(new Error(`Failed to parse Scrapula poll response: ${error.message}`));
          }
        });
      });

      req.on("error", (error) => {
        logger.error('google-maps-scraper-scrapula', 'Poll request error', { error: error.message });
        reject(new Error(`Scrapula poll request failed: ${error.message}`));
      });

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error("Scrapula poll request timeout"));
      });

      req.end();
    };

    // Start polling after initial delay
    setTimeout(poll, INITIAL_POLL_DELAY_MS);
  });
}

/**
 * Fetch results from file URL
 */
function fetchResultsFromUrl(fileUrl, apiKey) {
  return new Promise((resolve, reject) => {
    const url = new URL(fileUrl);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        "X-API-KEY": apiKey
      }
    };

    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          // Results might be JSON or CSV
          const contentType = res.headers['content-type'] || '';
          
          if (contentType.includes('json')) {
            const results = JSON.parse(data);
            resolve(Array.isArray(results) ? results : []);
          } else if (contentType.includes('csv')) {
            // Parse CSV (simplified - you might want a proper CSV parser)
            const lines = data.split('\n').filter(l => l.trim());
            const headers = lines[0].split(',').map(h => h.trim());
            const results = lines.slice(1).map(line => {
              const values = line.split(',');
              const obj = {};
              headers.forEach((h, i) => {
                obj[h] = values[i] || '';
              });
              return obj;
            });
            resolve(results);
          } else {
            // Try JSON first, then return raw
            try {
              const results = JSON.parse(data);
              resolve(Array.isArray(results) ? results : []);
            } catch {
              resolve([]);
            }
          }
        } catch (error) {
          logger.error('google-maps-scraper-scrapula', 'Failed to parse results file', {
            error: error.message,
            url: fileUrl
          });
          reject(new Error(`Failed to parse results file: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Failed to fetch results file: ${error.message}`));
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error("Results file fetch timeout"));
    });

    req.end();
  });
}

/**
 * Transform Scrapula business data to our standard format
 */
function transformScrapulaBusiness(business) {
  return {
    name: business.name || business.business_name || "Unknown Business",
    category: business.category || business.type || "General",
    address: business.address || business.full_address || "",
    city: business.city || "",
    postcode: business.postal_code || business.postcode || "",
    phone: business.phone || business.phone_number || null,
    website: business.website || business.site || null,
    email: business.email || (business.emails && business.emails[0]) || null,
    emailsFromWebsite: business.emails || [],
    rating: business.rating || business.stars || null,
    reviewCount: business.reviews_count || business.review_count || business.reviews || 0,
    latitude: business.latitude || business.lat || null,
    longitude: business.longitude || business.lng || business.lon || null,
    placeId: business.place_id || business.placeId || business.google_id || null,
    
    // Additional fields
    openingHours: business.working_hours || business.opening_hours || null,
    description: business.description || business.about || null,
    
    // Social media
    instagramUrl: business.instagram || business.instagram_url || null,
    facebookUrl: business.facebook || business.facebook_url || null,
    linkedInUrl: business.linkedin || business.linkedin_url || null,
    
    // Metadata
    scrapedAt: new Date().toISOString(),
    source: "scrapula"
  };
}

/**
 * Deduplicate businesses by place_id
 */
function deduplicateByPlaceId(businesses) {
  const seen = new Set();
  return businesses.filter(business => {
    if (!business.placeId) return true;
    
    if (seen.has(business.placeId)) {
      return false;
    }
    
    seen.add(business.placeId);
    return true;
  });
}

module.exports = {
  scrapeGoogleMapsScrapula
};
